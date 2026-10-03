import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)

export async function extractInstallerUninstaller(installerPath, uninstallerPath) {
  // Builder's standalone 7za omits the NSIS format. Its Windows tooling also
  // includes full 7z through electron-winstaller, which supports NSIS extraction.
  const sevenZip = require.resolve('electron-winstaller/vendor/7z.exe')
  const bytes = execFileSync(
    sevenZip,
    ['e', '-so', '-bd', installerPath, '$R0\\Uninstall ChromaShift.exe'],
    { maxBuffer: 8 * 1024 * 1024, windowsHide: true }
  )
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error('The installer does not contain the expected ChromaShift uninstaller.')
  }
  await mkdir(dirname(uninstallerPath), { recursive: true })
  await writeFile(uninstallerPath, bytes)
  return uninstallerPath
}
