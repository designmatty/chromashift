import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSettingsStores,
  defaultChromaShiftIntent,
  defaultUserPreferences,
  defaultWindowState
} from '@main/app-settings.js'
import { SettingsSliceStore } from '@main/settings-slice-store.js'
import { userPreferencesSchema } from '@shared/product-api.js'

const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-settings-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('settings slice stores', () => {
  it.each([1, 2])('migrates the v%s fixture without adding an End preview binding', async (version) => {
    const directory = await temporaryDirectory()
    const original = await readFile(new URL(`../../../../fixtures/preferences/v${version}.json`, import.meta.url), 'utf8')
    const expected = JSON.parse(await readFile(new URL('../../../../fixtures/preferences/v3.json', import.meta.url), 'utf8'))
    const path = join(directory, 'preferences.json')
    await writeFile(path, original)
    const stores = createSettingsStores(directory)
    await expect(stores.preferences.load()).resolves.toEqual(expected)
    // Loading never rewrites a legacy file. The next authorized preferences update does.
    expect(await readFile(path, 'utf8')).toBe(original)
    await stores.preferences.update((preferences) => preferences)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(expected)
    await expect(createSettingsStores(directory).preferences.load()).resolves.toEqual(expected)
  })

  it.each([999, 2])('preserves invalid preferences version %s on load and update failure', async (schemaVersion) => {
    const directory = await temporaryDirectory()
    const path = join(directory, 'preferences.json')
    const original = JSON.stringify({ ...defaultUserPreferences, schemaVersion, shortcutBindings: [{ action: { kind: 'endPreview' }, accelerator: 'Ctrl+E' }] })
    await writeFile(path, original)
    const stores = createSettingsStores(directory)
    await expect(stores.preferences.load()).rejects.toThrow()
    await expect(stores.preferences.update(() => defaultUserPreferences)).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('persists a new End preview binding at version 3', async () => {
    const directory = await temporaryDirectory()
    const expected = { ...defaultUserPreferences, shortcutBindings: [{ action: { kind: 'endPreview' as const }, accelerator: 'Ctrl+E' }] }
    await createSettingsStores(directory).preferences.update(() => expected)
    await expect(createSettingsStores(directory).preferences.load()).resolves.toEqual(expected)
  })
  it('uses the slice defaults when no file exists', async () => {
    const stores = createSettingsStores(await temporaryDirectory())
    await expect(stores.preferences.load()).resolves.toEqual(defaultUserPreferences)
    await expect(stores.windowState.load()).resolves.toEqual(defaultWindowState)
    await expect(stores.chromaShiftIntent.load()).resolves.toEqual(defaultChromaShiftIntent)
  })

  it('persists each slice to its own file', async () => {
    const directory = await temporaryDirectory()
    const stores = createSettingsStores(directory)
    await stores.preferences.update((preferences) => ({ ...preferences, theme: 'dark' }))
    await stores.windowState.update((state) => ({
      ...state,
      miniPanelPosition: { x: 420, y: 240 }
    }))
    await stores.chromaShiftIntent.update((intent) => ({ ...intent, chromaShiftStatus: 'paused' }))

    const preferences: unknown = JSON.parse(
      await readFile(join(directory, 'preferences.json'), 'utf8')
    )
    const windowState: unknown = JSON.parse(
      await readFile(join(directory, 'window-state.json'), 'utf8')
    )
    const intent: unknown = JSON.parse(await readFile(join(directory, 'chroma-shift.json'), 'utf8'))
    expect(preferences).toEqual({ ...defaultUserPreferences, theme: 'dark' })
    expect(windowState).toEqual({ ...defaultWindowState, miniPanelPosition: { x: 420, y: 240 } })
    expect(intent).toEqual({ ...defaultChromaShiftIntent, chromaShiftStatus: 'paused' })
  })

  it('reloads persisted slices in a fresh process', async () => {
    const directory = await temporaryDirectory()
    await createSettingsStores(directory).preferences.update((preferences) => ({
      ...preferences,
      launchAtStartup: true,
      theme: 'light'
    }))

    const reloaded = createSettingsStores(directory)
    await expect(reloaded.preferences.load()).resolves.toEqual({
      ...defaultUserPreferences,
      launchAtStartup: true,
      theme: 'light'
    })
  })

  it('persists and reloads pending restoration as v1 resume recovery', async () => {
    const directory = await temporaryDirectory()
    const blocked = {
      schemaVersion: 1 as const,
      chromaShiftStatus: 'safetyBlocked' as const,
      pendingControlOperation: 'resume' as const,
      intendedActivationMode: { kind: 'manual' as const, profileId: 'gaming' },
      intendedTarget: { kind: 'profile' as const, profileId: 'gaming' }
    }
    await createSettingsStores(directory).chromaShiftIntent.update(() => blocked)
    expect(JSON.parse(await readFile(join(directory, 'chroma-shift.json'), 'utf8'))).toEqual(
      blocked
    )
    await expect(createSettingsStores(directory).chromaShiftIntent.load()).resolves.toEqual(blocked)
  })

  it('migrates the profile notification preference into the global notification switch', async () => {
    const directory = await temporaryDirectory()
    await writeFile(
      join(directory, 'preferences.json'),
      JSON.stringify({
        schemaVersion: 1,
        launchAtStartup: false,
        launchBehavior: 'tray',
        closeBehavior: 'tray',
        theme: 'system',
        profileChangeNotifications: true,
        shortcutBindings: []
      })
    )

    await expect(createSettingsStores(directory).preferences.load()).resolves.toEqual({
      ...defaultUserPreferences,
      notificationsEnabled: true
    })
  })

  it('rejects malformed persisted slices rather than silently changing behavior', async () => {
    const directory = await temporaryDirectory()
    await writeFile(
      join(directory, 'preferences.json'),
      JSON.stringify({ ...defaultUserPreferences, theme: 'purple' })
    )
    const stores = createSettingsStores(directory)
    await expect(stores.preferences.load()).rejects.toThrow()
  })

  it('rejects unknown fields so foreign slices cannot leak in', async () => {
    const directory = await temporaryDirectory()
    await writeFile(
      join(directory, 'preferences.json'),
      JSON.stringify({ ...defaultUserPreferences, windowMaximized: true })
    )
    await expect(createSettingsStores(directory).preferences.load()).rejects.toThrow()
  })

  it('serializes concurrent updates so both writers land', async () => {
    const directory = await temporaryDirectory()
    const store = new SettingsSliceStore(
      join(directory, 'preferences.json'),
      userPreferencesSchema,
      defaultUserPreferences
    )
    await Promise.all([
      store.update((preferences) => ({ ...preferences, theme: 'dark' })),
      store.update((preferences) => ({ ...preferences, launchAtStartup: true }))
    ])

    const expected = { ...defaultUserPreferences, theme: 'dark', launchAtStartup: true }
    expect(store.current).toEqual(expected)
    const persisted: unknown = JSON.parse(
      await readFile(join(directory, 'preferences.json'), 'utf8')
    )
    expect(persisted).toEqual(expected)
  })

  it('exposes defaults synchronously before load and the loaded value after', async () => {
    const directory = await temporaryDirectory()
    await writeFile(
      join(directory, 'preferences.json'),
      JSON.stringify({ ...defaultUserPreferences, theme: 'dark' })
    )
    const store = new SettingsSliceStore(
      join(directory, 'preferences.json'),
      userPreferencesSchema,
      defaultUserPreferences
    )
    expect(store.current).toEqual(defaultUserPreferences)
    await store.load()
    expect(store.current).toEqual({ ...defaultUserPreferences, theme: 'dark' })
  })
})
