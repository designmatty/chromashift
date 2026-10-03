import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDevelopmentShortcutCleanup } from '@main/development-shortcut-cleanup.js'

const directories: string[] = []

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-development-shortcut-'))
  directories.push(directory)
  const shortcutPath = join(
    directory,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Electron.lnk'
  )
  await mkdir(dirname(shortcutPath), { recursive: true })
  await writeFile(shortcutPath, 'shortcut fixture')
  const executablePath = join(directory, 'checkout', 'electron.exe')
  const options = {
    platform: 'win32' as const,
    isPackaged: false,
    appDataDirectory: directory,
    executablePath,
    readShortcutLink: vi.fn(() => ({
      target: executablePath,
      args: '',
      appUserModelId: 'com.chromashift.desktop'
    })),
    logger: { write: vi.fn() }
  }
  return { options, shortcutPath }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('development notification shortcut cleanup', () => {
  it('removes our existing bare shortcut and later recreations', async () => {
    const { options, shortcutPath } = await fixture()
    const cleanup = createDevelopmentShortcutCleanup(options)
    cleanup()
    expect(existsSync(shortcutPath)).toBe(false)
    await writeFile(shortcutPath, 'recreated by Electron')
    cleanup()
    expect(existsSync(shortcutPath)).toBe(false)
    cleanup()
    expect(options.logger.write).toHaveBeenCalledTimes(2)
  })

  it.each([
    { target: 'C:/another-checkout/electron.exe' },
    { args: 'path-to-another-app' },
    { appUserModelId: 'another.application' }
  ])('preserves shortcuts owned by other apps: %j', async (differentDetails) => {
    const { options, shortcutPath } = await fixture()
    options.readShortcutLink.mockReturnValue({
      target: options.executablePath,
      args: '',
      appUserModelId: 'com.chromashift.desktop',
      ...differentDetails
    })
    createDevelopmentShortcutCleanup(options)()
    expect(existsSync(shortcutPath)).toBe(true)
  })

  it.each([{ isPackaged: true }, { platform: 'linux' as const }, { platform: 'darwin' as const }])(
    'does not inspect shortcuts outside Windows development: %j',
    async (context) => {
      const { options, shortcutPath } = await fixture()
      createDevelopmentShortcutCleanup({ ...options, ...context })()
      expect(options.readShortcutLink).not.toHaveBeenCalled()
      expect(existsSync(shortcutPath)).toBe(true)
    }
  )

  it('preserves unreadable shortcuts without interrupting notifications or exit', async () => {
    const { options, shortcutPath } = await fixture()
    options.readShortcutLink.mockImplementation(() => {
      throw new Error('Invalid shortcut')
    })
    expect(createDevelopmentShortcutCleanup(options)).not.toThrow()
    expect(existsSync(shortcutPath)).toBe(true)
    expect(options.logger.write).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'DevelopmentNotificationShortcutCleanupFailed' })
    )
  })
})
