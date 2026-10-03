import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { cleanupDevelopmentShortcut } from './development-shortcut-cleanup.mjs'

const require = createRequire(import.meta.url)
const viteDirectory = dirname(require.resolve('electron-vite/package.json'))
const environment = { ...globalThis.process.env }
delete environment.ELECTRON_RUN_AS_NODE
cleanupDevelopmentShortcut(electronPath)

const child = spawn(
  globalThis.process.execPath,
  [join(viteDirectory, 'bin', 'electron-vite.js'), 'dev', ...globalThis.process.argv.slice(2)],
  { env: environment, stdio: 'inherit', windowsHide: true }
)
let interrupted = false
// Ctrl+C reaches Vite through the inherited console too. Let Vite close its
// Electron child before this launcher removes the development shortcut.
const onInterrupt = () => {
  interrupted = true
}
globalThis.process.on('SIGINT', onInterrupt)

try {
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', resolveExit)
  })
  globalThis.process.exitCode = interrupted ? 130 : (code ?? 1)
} finally {
  globalThis.process.off('SIGINT', onInterrupt)
  cleanupDevelopmentShortcut(electronPath)
}
