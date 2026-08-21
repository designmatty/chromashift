import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const releaseDirectory = fileURLToPath(new globalThis.URL('../release/', import.meta.url))
const unpackedDirectory = fileURLToPath(
  new globalThis.URL('../release/win-unpacked/', import.meta.url)
)
const check = process.argv.includes('--check')
const requireInstaller = process.argv.includes('--installer')

const limits = {
  unpacked: 355 * 1024 * 1024,
  asar: 8 * 1024 * 1024,
  displayService: 80 * 1024 * 1024,
  locales: 2 * 1024 * 1024,
  installer: 110 * 1024 * 1024
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function bytesUnder(path) {
  const metadata = await stat(path)
  if (!metadata.isDirectory()) return metadata.size

  const entries = await readdir(path, { withFileTypes: true })
  const sizes = await Promise.all(entries.map((entry) => bytesUnder(join(path, entry.name))))
  return sizes.reduce((total, size) => total + size, 0)
}

async function newestInstaller() {
  const entries = await readdir(releaseDirectory, { withFileTypes: true })
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('-x64-setup.exe'))
      .map(async (entry) => {
        const path = join(releaseDirectory, entry.name)
        return { path, metadata: await stat(path) }
      })
  )
  return candidates.sort((left, right) => right.metadata.mtimeMs - left.metadata.mtimeMs)[0]
}

if (!(await exists(unpackedDirectory))) {
  throw new Error(`Packaged directory is missing: ${unpackedDirectory}`)
}

const paths = {
  unpacked: unpackedDirectory,
  asar: fileURLToPath(
    new globalThis.URL('../release/win-unpacked/resources/app.asar', import.meta.url)
  ),
  displayService: fileURLToPath(
    new globalThis.URL('../release/win-unpacked/resources/display-service/', import.meta.url)
  ),
  locales: fileURLToPath(new globalThis.URL('../release/win-unpacked/locales/', import.meta.url))
}

const measurements = []
for (const [name, path] of Object.entries(paths)) {
  measurements.push({ name, path, bytes: await bytesUnder(path), limit: limits[name] })
}

const installer = requireInstaller ? await newestInstaller() : undefined
if (installer !== undefined) {
  measurements.push({
    name: 'installer',
    path: installer.path,
    bytes: installer.metadata.size,
    limit: limits.installer
  })
} else if (requireInstaller) {
  throw new Error('The x64 NSIS installer is missing.')
}

const toMiB = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`
globalThis.console.table(
  measurements.map(({ name, path, bytes, limit }) => ({
    item: name,
    file: basename(path),
    size: toMiB(bytes),
    budget: toMiB(limit)
  }))
)

if (check) {
  const failures = measurements.filter(({ bytes, limit }) => bytes > limit)
  if (failures.length > 0) {
    throw new Error(
      `Package footprint budget exceeded: ${failures
        .map(({ name, bytes, limit }) => `${name} ${toMiB(bytes)} > ${toMiB(limit)}`)
        .join(', ')}`
    )
  }
}
