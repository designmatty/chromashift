import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { setTimeout, clearTimeout } from 'node:timers'
import { build } from 'vite'
import electronPath from 'electron'
import { nodeAliases } from '../import-aliases.ts'

const desktopDirectory = resolve(import.meta.dirname, '..')
const outputDirectory = join(desktopDirectory, 'out')
await mkdir(outputDirectory, { recursive: true })
const temporaryRoot = await mkdtemp(join(outputDirectory, 'update-download-smoke-'))
const signedApplication = resolve(
  globalThis.process.argv[2] ?? join(desktopDirectory, 'release/win-unpacked/ChromaShift.exe')
)
const fromVersion = globalThis.process.argv[3] ?? '0.1.0-preview.9'
const toVersion = globalThis.process.argv[4] ?? '0.1.0-preview.10'

async function removeSmokeDirectory(path) {
  if (
    !resolve(path)
      .toLowerCase()
      .startsWith(`${resolve(outputDirectory)}${sep}`.toLowerCase())
  ) {
    throw new Error('Refusing to remove a smoke directory outside desktop output.')
  }
  await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}

try {
  const source = join(temporaryRoot, 'entry.mjs')
  await writeFile(
    join(temporaryRoot, 'package.json'),
    JSON.stringify({
      name: 'chromashift-update-download-smoke',
      version: fromVersion,
      main: 'built/main.cjs'
    })
  )
  // This harness starts no display helper, never launches NSIS, and owns its cache.
  await writeFile(
    source,
    `
    import { app, net } from 'electron'
    import { join } from 'node:path'
    import electronUpdater from 'electron-updater'
    import { NsisUpdateInstaller } from '@main/nsis-update-installer.js'
    import { UpdateChecker } from '@main/update-checker.js'
    const root = ${JSON.stringify(temporaryRoot)}
    app.setPath('userData', join(root, 'user-data'))
    void app.whenReady().then(async () => {
    try {
      const installer = new NsisUpdateInstaller({
        executablePath: ${JSON.stringify(signedApplication)},
        logger: { write: event => console.log(JSON.stringify(event)) },
        createUpdater: options => {
          const updater = new electronUpdater.NsisUpdater(options)
          updater.forceDevUpdateConfig = true
          // Exercise the shipped configuration instead of supplying a test-only file.
          updater.updateConfigPath = ${JSON.stringify(join(dirname(signedApplication), 'resources/app-update.yml'))}
          updater.setFeedURL(options)
          Object.defineProperty(updater.app, 'baseCachePath', { value: join(root, 'cache') })
          return updater
        }
      })
      const version = ${JSON.stringify(toVersion)}
      const checker = new UpdateChecker({ currentVersion: ${JSON.stringify(fromVersion)}, fetch: (input, init) => net.fetch(input, init) })
      const check = await checker.check()
      if (check.release?.version !== version) throw new Error('The update feed did not select the expected release.')
      await installer.download(check.release, () => {})
      await installer.prepareInstall()
      console.log('Signed update download passed: release manifest, SHA-512, publisher trust, and cached installer revalidation. NSIS was not launched.')
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    })
  `
  )
  await build({
    configFile: false,
    root: desktopDirectory,
    logLevel: 'warn',
    resolve: { alias: nodeAliases },
    build: {
      ssr: source,
      outDir: join(temporaryRoot, 'built'),
      emptyOutDir: true,
      rollupOptions: {
        external: ['electron', 'electron-updater'],
        output: { format: 'cjs', entryFileNames: 'main.cjs' }
      }
    }
  })
  const environment = { ...globalThis.process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, [temporaryRoot], {
    cwd: desktopDirectory,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.pipe(globalThis.process.stdout)
  child.stderr.pipe(globalThis.process.stderr)
  const timeout = setTimeout(() => child.kill(), 120_000)
  const code = await new Promise((resolveExit, reject) => {
    child.once('exit', resolveExit)
    child.once('error', reject)
  }).finally(() => clearTimeout(timeout))
  if (code !== 0) throw new Error(`Update download smoke exited with code ${code}.`)
} finally {
  await removeSmokeDirectory(temporaryRoot)
}
