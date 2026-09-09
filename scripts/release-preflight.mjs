import { access, readFile, readdir, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDirectory = join(repositoryRoot, 'apps', 'desktop', 'release')

function parseArguments(arguments_) {
  const options = {
    artifacts: false,
    signatures: false,
    expectedPublisher: undefined,
    allowDevelopmentVersion: false,
    tag:
      globalThis.process.env['GITHUB_REF_TYPE'] === 'tag'
        ? globalThis.process.env['GITHUB_REF_NAME']
        : undefined
  }
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--artifacts') options.artifacts = true
    else if (argument === '--signatures') options.signatures = true
    else if (argument === '--expected-publisher') options.expectedPublisher = arguments_[++index]
    else if (argument === '--allow-development-version') options.allowDevelopmentVersion = true
    else if (argument === '--tag') options.tag = arguments_[++index]
    else throw new Error(`Unknown release preflight argument: ${argument}`)
  }
  return options
}

function verifySignatures(version, expectedPublisher) {
  if (!expectedPublisher) {
    throw new Error('--signatures requires --expected-publisher.')
  }
  const installerName = `ChromaShift-${version}-x64-setup.exe`
  const paths = [
    join(releaseDirectory, installerName),
    join(releaseDirectory, 'win-unpacked', 'ChromaShift.exe'),
    join(
      releaseDirectory,
      'win-unpacked',
      'resources',
      'display-service',
      'ChromaShift.DisplayService.exe'
    )
  ]
  const result = spawnSync(
    'pwsh.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(repositoryRoot, 'scripts', 'verify-authenticode.ps1'),
      '-ExpectedPublisher',
      expectedPublisher,
      '-PathsJson',
      JSON.stringify(paths)
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || 'Authenticode verification failed.'
    )
  }
  globalThis.console.log(result.stdout.trim())
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function requireMatch(value, pattern, description) {
  if (!pattern.test(value)) throw new Error(`${description} is invalid: ${value}`)
}

function requireIncludes(value, expected, description) {
  if (!value.includes(expected)) throw new Error(`${description} must include: ${expected}`)
}

async function sha512(path) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('base64')
}

async function verifyArtifacts(version) {
  const installerName = `ChromaShift-${version}-x64-setup.exe`
  const required = [installerName, `${installerName}.blockmap`, 'latest.yml']
  await Promise.all(required.map((name) => access(join(releaseDirectory, name))))

  const artifacts = await readdir(releaseDirectory)
  const conflicting = artifacts.filter((name) =>
    /^ChromaShift-.*-(?:ia32|arm64)-setup\.exe$/i.test(name)
  )
  if (conflicting.length > 0) {
    throw new Error(`Unexpected release architectures: ${conflicting.join(', ')}`)
  }

  const manifest = await readFile(join(releaseDirectory, 'latest.yml'), 'utf8')
  requireIncludes(manifest, `version: ${version}`, 'Update manifest')
  requireIncludes(manifest, `url: ${installerName}`, 'Update manifest')
  requireIncludes(manifest, `path: ${installerName}`, 'Update manifest')

  const installerPath = join(releaseDirectory, installerName)
  const installerSize = (await stat(installerPath)).size
  const expectedHash = await sha512(installerPath)
  const manifestHashes = [...manifest.matchAll(/^\s*sha512:\s*(\S+)\s*$/gm)].map(
    (match) => match[1]
  )
  if (manifestHashes.length !== 2 || manifestHashes.some((hash) => hash !== expectedHash)) {
    throw new Error('Update manifest SHA-512 does not match the installer.')
  }
  const manifestSize = /^\s*size:\s*(\d+)\s*$/m.exec(manifest)?.[1]
  if (Number(manifestSize) !== installerSize) {
    throw new Error('Update manifest size does not match the installer.')
  }

  const blockMap = JSON.parse(
    gunzipSync(await readFile(join(releaseDirectory, `${installerName}.blockmap`))).toString('utf8')
  )
  const mappedSize = blockMap.files?.[0]?.sizes?.reduce((total, size) => total + size, 0)
  if (blockMap.version !== '2' || mappedSize !== installerSize) {
    throw new Error('Update block map does not match the installer.')
  }
}

const options = parseArguments(globalThis.process.argv.slice(2))
const [rootPackage, desktopPackage, lockfile, builderConfiguration] = await Promise.all([
  json(join(repositoryRoot, 'package.json')),
  json(join(repositoryRoot, 'apps', 'desktop', 'package.json')),
  json(join(repositoryRoot, 'package-lock.json')),
  readFile(join(repositoryRoot, 'apps', 'desktop', 'electron-builder.yml'), 'utf8')
])
const version = rootPackage.version
requireMatch(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Application version')

const versions = new Map([
  ['desktop package', desktopPackage.version],
  ['lockfile root', lockfile.packages?.['']?.version],
  ['lockfile desktop', lockfile.packages?.['apps/desktop']?.version]
])
for (const [source, candidate] of versions) {
  if (candidate !== version) {
    throw new Error(`Release version mismatch: root=${version}, ${source}=${String(candidate)}`)
  }
}

requireIncludes(
  builderConfiguration,
  'artifactName: ChromaShift-${version}-${arch}-setup.${ext}',
  'Electron Builder configuration'
)
requireIncludes(builderConfiguration, '- x64', 'Electron Builder architecture list')
requireIncludes(builderConfiguration, 'provider: github', 'Electron Builder publish metadata')
requireIncludes(builderConfiguration, 'owner: designmatty', 'Electron Builder repository owner')
requireIncludes(builderConfiguration, 'repo: chromashift', 'Electron Builder repository name')

if (options.tag !== undefined) {
  if (version === '0.0.0' && !options.allowDevelopmentVersion) {
    throw new Error('Release version 0.0.0 is reserved for development builds.')
  }
  if (options.tag !== `v${version}`) {
    throw new Error(`Release tag mismatch: expected v${version}, received ${options.tag}`)
  }
}
if (options.signatures && !options.artifacts) {
  throw new Error('--signatures requires --artifacts.')
}
if (options.artifacts) await verifyArtifacts(version)
if (options.signatures) verifySignatures(version, options.expectedPublisher)

globalThis.console.log(
  `Release preflight passed: version=${version}, tag=${options.tag ?? 'not-required'}, architecture=x64, artifacts=${options.artifacts ? 'verified' : 'not-requested'}, signatures=${options.signatures ? 'verified' : 'not-requested'}`
)
