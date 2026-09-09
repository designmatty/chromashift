import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBlockMap } from 'app-builder-lib/out/targets/blockmap/blockmap.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArguments(arguments_) {
  const options = {
    releaseDirectory: join(repositoryRoot, 'apps', 'desktop', 'release'),
    version: undefined
  }
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--release-directory') options.releaseDirectory = resolve(arguments_[++index])
    else if (argument === '--version') options.version = arguments_[++index]
    else throw new Error(`Unknown metadata finalization argument: ${argument}`)
  }
  return options
}

async function packageVersion() {
  return JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')).version
}

function replaceExact(manifest, pattern, replacement, description, expectedCount) {
  const matches = manifest.match(pattern)
  if (matches?.length !== expectedCount) {
    throw new Error(`Update manifest must contain ${expectedCount} ${description} entries.`)
  }
  return manifest.replace(pattern, replacement)
}

const options = parseArguments(globalThis.process.argv.slice(2))
const version = options.version ?? (await packageVersion())
const installerName = `ChromaShift-${version}-x64-setup.exe`
const installerPath = join(options.releaseDirectory, installerName)
const blockMapPath = `${installerPath}.blockmap`
const manifestPath = join(options.releaseDirectory, 'latest.yml')
let manifest = await readFile(manifestPath, 'utf8')

if (!manifest.includes(`version: ${version}`)) {
  throw new Error(`Update manifest does not contain release version ${version}.`)
}
if (!manifest.includes(`url: ${installerName}`) || !manifest.includes(`path: ${installerName}`)) {
  throw new Error(`Update manifest does not reference ${installerName}.`)
}

const updateInfo = await buildBlockMap(installerPath, 'gzip', blockMapPath)
manifest = replaceExact(
  manifest,
  /^\s*sha512:\s*\S+\s*$/gm,
  (line) => line.replace(/\S+\s*$/, updateInfo.sha512),
  'sha512',
  2
)
manifest = replaceExact(
  manifest,
  /^\s*size:\s*\d+\s*$/gm,
  (line) => line.replace(/\d+\s*$/, String(updateInfo.size)),
  'size',
  1
)
await writeFile(manifestPath, manifest)

globalThis.console.log(
  `Finalized signed release metadata: installer=${installerName}, size=${updateInfo.size}`
)
