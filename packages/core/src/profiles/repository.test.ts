import { describe, expect, it } from 'vitest'
import { ConfigurationValidationError, parseProfileConfigurationJson } from './configuration.js'
import type { ColorProfile } from './model.js'
import {
  JsonProfileRepository,
  type ProfileConfigurationStorage
} from './repository.js'

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
    color: { saturation: 75 },
    applications: [{ executableName: `${id}.exe` }],
    displays: [{ displayId: 'display:primary' }]
  }
}

describe('JSON profile repository', () => {
  it('starts with an empty valid configuration when storage does not exist', async () => {
    const repository = new JsonProfileRepository(new MemoryStorage())
    await expect(repository.getConfiguration()).resolves.toEqual({
      schemaVersion: 1,
      profiles: [],
      settings: { defaultProfileId: null }
    })
  })

  it('creates, updates, lists, and finds profiles', async () => {
    const storage = new MemoryStorage()
    const repository = new JsonProfileRepository(storage)
    await repository.save(profile('gaming'))
    await repository.save({ ...profile('gaming'), name: 'Gaming updated' })

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: 'gaming', name: 'Gaming updated' })
    ])
    await expect(repository.findById('GAMING')).resolves.toMatchObject({ id: 'gaming' })
    expect(parseProfileConfigurationJson(storage.contents!)).toMatchObject({ schemaVersion: 1 })
  })

  it('duplicates a profile with independent nested data', async () => {
    const repository = new JsonProfileRepository(new MemoryStorage())
    await repository.save(profile('gaming'))
    const duplicate = await repository.duplicate('gaming', {
      id: 'gaming-copy',
      name: 'Gaming copy'
    })
    duplicate.color.saturation = 10

    await expect(repository.findById('gaming')).resolves.toMatchObject({
      color: { saturation: 75 }
    })
    await expect(repository.findById('gaming-copy')).resolves.toMatchObject({
      name: 'Gaming copy',
      color: { saturation: 75 }
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
      schemaVersion: 1,
      profiles: [profile('default')],
      settings: { defaultProfileId: 'default' }
    })
    const repository = new JsonProfileRepository(new MemoryStorage(persisted))

    await expect(repository.list()).resolves.toHaveLength(1)
  })

  it('rejects invalid persisted configuration', async () => {
    const repository = new JsonProfileRepository(new MemoryStorage('{'))
    await expect(repository.getConfiguration()).rejects.toBeInstanceOf(
      ConfigurationValidationError
    )
  })

  it('migrates and rewrites a version 0 configuration on load', async () => {
    const storage = new MemoryStorage(
      JSON.stringify({
        schemaVersion: 0,
        profiles: [profile('default')],
        defaultProfileId: 'default'
      })
    )
    const repository = new JsonProfileRepository(storage)

    await expect(repository.getConfiguration()).resolves.toMatchObject({
      schemaVersion: 1,
      settings: { defaultProfileId: 'default' }
    })
    expect(storage.writes).toHaveLength(1)
    expect(parseProfileConfigurationJson(storage.writes[0]!)).toMatchObject({ schemaVersion: 1 })
  })
})
