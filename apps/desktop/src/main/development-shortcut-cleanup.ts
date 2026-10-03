import { existsSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ShortcutDetails } from 'electron'
import type { StructuredLogger } from '@main/structured-logger.js'

interface DevelopmentShortcutCleanupOptions {
  platform: NodeJS.Platform
  isPackaged: boolean
  appDataDirectory: string
  executablePath: string
  readShortcutLink: (path: string) => Pick<ShortcutDetails, 'target' | 'args' | 'appUserModelId'>
  logger: StructuredLogger
}

export function createDevelopmentShortcutCleanup(
  options: DevelopmentShortcutCleanupOptions
): () => void {
  if (options.platform !== 'win32' || options.isPackaged) return () => {}

  const shortcutPath = join(
    options.appDataDirectory,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Electron.lnk'
  )
  const executablePath = resolve(options.executablePath).toLowerCase()
  return () => {
    if (!existsSync(shortcutPath)) return
    try {
      const shortcut = options.readShortcutLink(shortcutPath)
      if (
        resolve(shortcut.target).toLowerCase() !== executablePath ||
        (shortcut.args ?? '') !== '' ||
        !['com.chromashift.desktop', 'com.chromashift.desktop.development'].includes(
          shortcut.appUserModelId ?? ''
        )
      ) {
        return
      }
      unlinkSync(shortcutPath)
      options.logger.write({
        level: 'information',
        eventName: 'DevelopmentNotificationShortcutRemoved'
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      options.logger.write({
        level: 'warning',
        eventName: 'DevelopmentNotificationShortcutCleanupFailed',
        message: String(error)
      })
    }
  }
}
