import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function cleanupDevelopmentShortcut(electronExecutablePath) {
  if (globalThis.process.platform !== 'win32') return
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(dirname(fileURLToPath(import.meta.url)), 'cleanup-development-shortcut.ps1'),
      '-ElectronExecutablePath',
      electronExecutablePath
    ],
    // PowerShell start-up, the shell COM objects and the CIM process query can
    // exceed 10 seconds on a cold hosted Windows runner.
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 }
  ).trim()
  if (output !== '') globalThis.console.log(output)
}
