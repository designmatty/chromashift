import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const credentialPatterns = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['GitHub personal access token', /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Slack token', /xox[baprs]-[0-9A-Za-z-]{20,}/],
  ['Azure storage account key', /AccountKey=[A-Za-z0-9+/]{40,}={0,2}/i]
]

function parseArguments(arguments_) {
  let repository = globalThis.process.cwd()
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--repository') repository = arguments_[++index]
    else throw new Error(`Unknown public-source audit argument: ${argument}`)
  }
  if (repository === undefined) throw new Error('--repository requires a path.')
  return { repository: resolve(repository) }
}

function git(repository, arguments_, options = {}) {
  const result = spawnSync('git', ['-C', repository, ...arguments_], {
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    maxBuffer: 256 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `git ${arguments_.join(' ')} failed`))
  }
  return result.stdout
}

function hasCredentialBearingName(path) {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  if (name === '.env.example') return false
  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    /\.(?:pfx|p12|jks|keystore|key)$/.test(name) ||
    /^(?:id_rsa|id_ed25519|credentials\.json|service-account\.json|secrets?\.(?:json|ya?ml))$/.test(
      name
    )
  )
}

function historicalObjects(repository) {
  const lines = git(repository, [
    'rev-list',
    '--objects',
    'HEAD',
    '--branches',
    '--remotes',
    '--tags'
  ])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
  const pathsByObject = new Map()
  for (const line of lines) {
    const separator = line.indexOf(' ')
    const objectId = separator === -1 ? line : line.slice(0, separator)
    const path = separator === -1 ? undefined : line.slice(separator + 1)
    if (path === undefined) continue
    const paths = pathsByObject.get(objectId) ?? new Set()
    paths.add(path)
    pathsByObject.set(objectId, paths)
  }
  return pathsByObject
}

function readableBlobs(repository, objectIds) {
  if (objectIds.length === 0) return []
  const input = `${objectIds.join('\n')}\n`
  const checks = String(
    git(repository, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
      input
    })
  )
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [objectId, type, size] = line.split(' ')
      return { objectId, type, size: Number(size) }
    })
    .filter(({ type }) => type === 'blob')

  const blobInput = `${checks.map(({ objectId }) => objectId).join('\n')}\n`
  const output = git(repository, ['cat-file', '--batch'], {
    encoding: 'buffer',
    input: globalThis.Buffer.from(blobInput)
  })
  const blobs = []
  let offset = 0
  for (const check of checks) {
    const headerEnd = output.indexOf(10, offset)
    if (headerEnd === -1) throw new Error(`Missing Git object header for ${check.objectId}.`)
    const header = output.subarray(offset, headerEnd).toString('utf8')
    const [, type, sizeText] = header.split(' ')
    const size = Number(sizeText)
    if (type !== 'blob' || !Number.isFinite(size)) {
      throw new Error(`Unexpected Git object header: ${header}`)
    }
    const contentStart = headerEnd + 1
    const contentEnd = contentStart + size
    blobs.push({ objectId: check.objectId, content: output.subarray(contentStart, contentEnd) })
    offset = contentEnd + 1
  }
  return blobs
}

export function auditRepository(repository) {
  git(repository, ['rev-parse', '--git-dir'])
  const pathsByObject = historicalObjects(repository)
  const findings = []

  for (const [objectId, paths] of pathsByObject) {
    for (const path of paths) {
      if (hasCredentialBearingName(path)) {
        findings.push({ kind: 'credential-bearing filename', objectId, path })
      }
    }
  }

  let scannedBlobs = 0
  for (const { objectId, content } of readableBlobs(repository, [...pathsByObject.keys()])) {
    scannedBlobs += 1
    const text = content.toString('utf8')
    for (const [kind, pattern] of credentialPatterns) {
      if (!pattern.test(text)) continue
      for (const path of pathsByObject.get(objectId) ?? []) {
        findings.push({ kind, objectId, path })
      }
    }
  }

  return { findings, scannedBlobs, historicalPaths: pathsByObject.size }
}

const options = parseArguments(globalThis.process.argv.slice(2))
const result = auditRepository(options.repository)
if (result.findings.length > 0) {
  globalThis.console.error('Public-source audit failed. Potential private material was found:')
  for (const finding of result.findings) {
    globalThis.console.error(
      `- ${finding.kind}: ${finding.path} (${finding.objectId.slice(0, 12)})`
    )
  }
  globalThis.process.exitCode = 1
} else {
  globalThis.console.log(
    `Public-source audit passed: ${result.scannedBlobs} historical blobs scanned, ${result.historicalPaths} named objects checked, author metadata unchanged.`
  )
}
