import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AppSettingsRepository, defaultAppSettings } from './app-settings.js'

const directories: string[] = []

async function settingsPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-settings-'))
  directories.push(directory)
  return join(directory, 'settings.json')
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('AppSettingsRepository', () => {
  it('uses the product defaults when no settings file exists', async () => {
    const repository = new AppSettingsRepository(await settingsPath())
    await expect(repository.get()).resolves.toEqual(defaultAppSettings)
  })

  it('migrates unversioned settings without losing existing preferences or geometry', async () => {
    const path = await settingsPath()
    const legacy = {
      launchAtStartup: true,
      launchBehavior: 'app',
      closeBehavior: 'shutdown',
      theme: 'dark',
      miniPanelPosition: { x: 420, y: 240 },
      windowBounds: { x: 100, y: 80, width: 1180, height: 760 },
      windowMaximized: true
    }
    await writeFile(path, JSON.stringify(legacy))

    const migrated = {
      schemaVersion: 1,
      ...legacy,
      profileChangeNotifications: false,
      shortcutBindings: [],
      chromaShiftStatus: 'active',
      pendingControlOperation: null,
      intendedActivationMode: { kind: 'automatic' },
      intendedTarget: null
    }
    await expect(new AppSettingsRepository(path).get()).resolves.toEqual(migrated)
    await expect(readFile(path, 'utf8')).resolves.toBe(`${JSON.stringify(migrated, null, 2)}\n`)
  })

  it('validates and atomically persists settings', async () => {
    const path = await settingsPath()
    const repository = new AppSettingsRepository(path)
    const settings = {
      schemaVersion: 1 as const,
      launchAtStartup: true,
      launchBehavior: 'app' as const,
      closeBehavior: 'shutdown' as const,
      theme: 'dark' as const,
      miniPanelPosition: { x: 420, y: 240 },
      profileChangeNotifications: false,
      shortcutBindings: [],
      chromaShiftStatus: 'active' as const,
      pendingControlOperation: null,
      intendedActivationMode: { kind: 'automatic' as const },
      intendedTarget: null
    }

    await expect(repository.save(settings)).resolves.toEqual(settings)
    await expect(readFile(path, 'utf8')).resolves.toBe(`${JSON.stringify(settings, null, 2)}\n`)
    await expect(new AppSettingsRepository(path).get()).resolves.toEqual(settings)
  })

  it('rejects malformed persisted settings rather than silently changing behavior', async () => {
    const path = await settingsPath()
    await writeFile(path, JSON.stringify({ ...defaultAppSettings, theme: 'purple' }))
    const repository = new AppSettingsRepository(path)

    await expect(repository.get()).rejects.toThrow()
  })

  it('ignores the removed sidebar width in existing settings', async () => {
    const path = await settingsPath()
    const legacy = {
      launchAtStartup: defaultAppSettings.launchAtStartup,
      launchBehavior: defaultAppSettings.launchBehavior,
      closeBehavior: defaultAppSettings.closeBehavior,
      theme: defaultAppSettings.theme,
      miniPanelPosition: defaultAppSettings.miniPanelPosition,
      windowBounds: defaultAppSettings.windowBounds,
      windowMaximized: defaultAppSettings.windowMaximized
    }
    await writeFile(path, JSON.stringify({ ...legacy, sidebarWidth: 300 }))

    await expect(new AppSettingsRepository(path).get()).resolves.toEqual(defaultAppSettings)
  })

  it('serializes concurrent saves so the newest settings win on disk', async () => {
    const path = await settingsPath()
    const repository = new AppSettingsRepository(path)
    const first = { ...defaultAppSettings, theme: 'light' as const }
    const second = { ...defaultAppSettings, theme: 'dark' as const }

    await Promise.all([repository.save(first), repository.save(second)])

    await expect(readFile(path, 'utf8')).resolves.toBe(`${JSON.stringify(second, null, 2)}\n`)
    await expect(repository.get()).resolves.toEqual(second)
  })
})
