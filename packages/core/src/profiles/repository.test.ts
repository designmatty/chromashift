import { describe, expect, it } from 'vitest'
import { ConfigurationValidationError, parseProfileConfigurationJson } from './configuration.js'
import type { ConfigurationMigrationNotice, VersionOneProfile } from './migration.js'
import type { ColorProfile } from './model.js'
import { JsonProfileRepository, type ProfileConfigurationStorage } from './repository.js'

class MemoryStorage implements ProfileConfigurationStorage {
  public writes: string[] = []

  public constructor(public contents: string | null = null) {}

  public async read(): Promise<string | null> {
    return this.contents
  }

  public async write(contents: string): Promise<void> {
    this.contents = contents
    this.writes.push(contents)
  }
}

function profile(id: string): ColorProfile {
  return {
    id,
    name: id,
    enabled: true,
    applications: [{ executableName: `${id}.exe` }],
    displays: [
      {
        displayId: 'display:primary',
        color: { saturation: 75 },
        lastColorValues: { saturation: 75, hue: 20 }
      }
    ]
  }
}

function versionOneProfile(id: string): VersionOneProfile {
  return {
    id,
    name: id,
    enabled: true,
    color: { saturation: 75 },
    applications: [{ executableName: `${id}.exe` }],
    displays: [{ displayId: 'display:primary' }]
  }
}

describe('JSON profile repository', () => {
  it('starts with the permanent default profile when storage does not exist', async () => {
    const repository = new JsonProfileRepository(new MemoryStorage())
    await expect(repository.getConfiguration()).resolves.toEqual({
      schemaVersion: 2,
      profiles: [
        {
          id: 'default',
          name: 'Default profile',
          enabled: true,
          applications: [],
          displays: []
        }
      ],
      settings: { defaultProfileId: 'default' }
    })
  })

  it('creates, updates, lists, and finds profiles', async () => {
    const storage = new MemoryStorage()
    const repository = new JsonProfileRepository(storage)
    await repository.save(profile('gaming'))
    await repository.save({ ...profile('gaming'), name: 'Gaming updated' })

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: 'default', name: 'Default profile' }),
      expect.objectContaining({ id: 'gaming', name: 'Gaming updated' })
    ])
    await expect(repository.findById('GAMING')).resolves.toMatchObject({ id: 'gaming' })
    expect(parseProfileConfigurationJson(storage.contents!)).toMatchObject({ schemaVersion: 2 })
  })

  it('persists the profile order used by the draggable sidebar', async () => {
    const repository = new JsonProfileRepository(new MemoryStorage())
    await repository.save(profile('gaming'))
    await repository.save(profile('designing'))

    await repository.reorder(['default', 'designing', 'gaming'])

    await expect(repository.list()).resolves.toMatchObject([
      { id: 'default' },
      { id: 'designing' },
      { id: 'gaming' }
    ])
    await expect(repository.reorder(['default', 'gaming'])).rejects.toThrow(
      /every profile exactly once/
    )
  })

  it('persists different color settings for two displays in one profile', async () => {
    const storage = new MemoryStorage()
    const repository = new JsonProfileRepository(storage)
    await repository.save({
      ...profile('gaming'),
      displays: [
        { displayId: 'display:primary', color: { saturation: 75 } },
        { displayId: 'display:secondary', color: { brightness: 40 } }
      ]
    })

    await expect(repository.findById('gaming')).resolves.toMatchObject({
      displays: [
        { displayId: 'display:primary', color: { saturation: 75 } },
        { displayId: 'display:secondary', color: { brightness: 40 } }
      ]
    })
  })

  it('duplicates a profile with independent per-display settings', async () => {
    const repository = new JsonProfileRepository(new MemoryStorage())
    await repository.save({
      ...profile('gaming'),
      displays: [
        {
          displayId: 'display:primary',
          color: { saturation: 75 },
          lastColorValues: { saturation: 75, hue: 20 }
        },
        { displayId: 'display:secondary', color: { brightness: 40 } }
      ]
    })
    const duplicate = await repository.duplicate('gaming', {
      id: 'gaming-copy',
      name: 'Gaming copy'
    })
    duplicate.displays[0]!.color.saturation = 10
    duplicate.displays[0]!.lastColorValues!.hue = 90
    duplicate.displays[1]!.color.brightness = 5

    await expect(repository.findById('gaming')).resolves.toMatchObject({
      displays: [
        { color: { saturation: 75 }, lastColorValues: { saturation: 75, hue: 20 } },
        { color: { brightness: 40 } }
      ]
    })
    await expect(repository.findById('gaming-copy')).resolves.toMatchObject({
      name: 'Gaming copy',
      displays: [
        { color: { saturation: 75 }, lastColorValues: { saturation: 75, hue: 20 } },
        { color: { brightness: 40 } }
      ]
    })
  })

  it('maintains and clears the default profile reference', async () => {
    const repository = new JsonProfileRepository(new MemoryStorage())
    await repository.save(profile('default'))
    await repository.setDefaultProfileId('DEFAULT')
    await expect(repository.getConfiguration()).resolves.toMatchObject({
      settings: { defaultProfileId: 'default' }
    })

    await expect(repository.delete('default')).resolves.toBe(true)
    await expect(repository.getConfiguration()).resolves.toMatchObject({
      profiles: [],
      settings: { defaultProfileId: null }
    })
  })

  it('rejects a missing default profile', async () => {
    const repository = new JsonProfileRepository(new MemoryStorage())
    await expect(repository.setDefaultProfileId('missing')).rejects.toThrow(/does not exist/)
  })

  it('loads valid persisted configuration', async () => {
    const persisted = JSON.stringify({
      schemaVersion: 2,
      profiles: [profile('default')],
      settings: { defaultProfileId: 'default' }
    })
    const repository = new JsonProfileRepository(new MemoryStorage(persisted))

    await expect(repository.list()).resolves.toHaveLength(1)
  })

  it('rejects invalid persisted configuration', async () => {
    const repository = new JsonProfileRepository(new MemoryStorage('{'))
    await expect(repository.getConfiguration()).rejects.toBeInstanceOf(ConfigurationValidationError)
  })

  it('does not rewrite storage when the configuration is already current', async () => {
    const storage = new MemoryStorage(
      JSON.stringify({
        schemaVersion: 2,
        profiles: [profile('default')],
        settings: { defaultProfileId: 'default' }
      })
    )
    const repository = new JsonProfileRepository(storage)
    await repository.getConfiguration()

    expect(storage.writes).toEqual([])
  })

  it('migrates and rewrites a version 1 configuration on load', async () => {
    const storage = new MemoryStorage(
      JSON.stringify({
        schemaVersion: 1,
        profiles: [versionOneProfile('default')],
        settings: { defaultProfileId: 'default' }
      })
    )
    const repository = new JsonProfileRepository(storage)

    await expect(repository.getConfiguration()).resolves.toMatchObject({
      schemaVersion: 2,
      profiles: [
        {
          id: 'default',
          displays: [{ displayId: 'display:primary', color: { saturation: 75 } }]
        }
      ],
      settings: { defaultProfileId: 'default' }
    })
    expect(storage.writes).toHaveLength(1)
    expect(parseProfileConfigurationJson(storage.writes[0]!)).toMatchObject({ schemaVersion: 2 })
  })

  it('reports migration notices raised while loading', async () => {
    const notices: ConfigurationMigrationNotice[] = []
    const repository = new JsonProfileRepository(
      new MemoryStorage(
        JSON.stringify({
          schemaVersion: 1,
          profiles: [{ ...versionOneProfile('draft'), displays: [] }],
          settings: { defaultProfileId: null }
        })
      ),
      { onMigrationNotice: (notice) => notices.push(notice) }
    )
    await repository.getConfiguration()

    expect(notices).toEqual([
      {
        code: 'discardedUnassignedColorSettings',
        profileId: 'draft',
        settings: ['saturation']
      }
    ])
  })

  it('migrates and rewrites a version 0 configuration on load', async () => {
    const storage = new MemoryStorage(
      JSON.stringify({
        schemaVersion: 0,
        profiles: [versionOneProfile('default')],
        defaultProfileId: 'default'
      })
    )
    const repository = new JsonProfileRepository(storage)

    await expect(repository.getConfiguration()).resolves.toMatchObject({
      schemaVersion: 2,
      settings: { defaultProfileId: 'default' }
    })
    expect(storage.writes).toHaveLength(1)
    expect(parseProfileConfigurationJson(storage.writes[0]!)).toMatchObject({ schemaVersion: 2 })
  })
})
