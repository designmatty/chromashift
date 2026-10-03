import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

// NSIS calls this before embedding its generated uninstaller, and again for
// the finished installer. Reuse the module installed by the Azure action.
export default function sign(configuration) {
  execFileSync(
    'pwsh.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(import.meta.dirname, '../../..', 'scripts/sign-release-executable.ps1'),
      '-Path',
      configuration.path
    ],
    { stdio: 'inherit', windowsHide: true }
  )
}
