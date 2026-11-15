import { win32 } from 'node:path'
import type { ForegroundApplication } from '@chromashift/native-client'

const shellExecutables = [
  'SystemApps/ShellExperienceHost_cw5n1h2txyewy/ShellExperienceHost.exe',
  'SystemApps/Microsoft.Windows.StartMenuExperienceHost_cw5n1h2txyewy/StartMenuExperienceHost.exe',
  'SystemApps/MicrosoftWindows.Client.CBS_cw5n1h2txyewy/SearchHost.exe',
  'System32/ShellHost.exe'
]

const explorerShellClasses = new Set([
  'shell_traywnd',
  'shell_secondarytraywnd',
  'notifyiconoverflowwindow',
  'toplevelwindowforoverflowxamlisland'
])

// Require the known Windows installation path, never a filename fallback.
export function isShellSurface(
  application: ForegroundApplication,
  systemRoot: string | undefined
): boolean {
  if (!systemRoot || !win32.isAbsolute(systemRoot) || !application.path) return false
  const path = win32.normalize(application.path).toLowerCase()
  const atSystemPath = (relative: string): boolean =>
    path === win32.join(systemRoot, relative).toLowerCase()
  if (shellExecutables.some(atSystemPath)) return true
  return (
    atSystemPath('explorer.exe') &&
    explorerShellClasses.has(application.windowClass?.toLowerCase() ?? '')
  )
}
