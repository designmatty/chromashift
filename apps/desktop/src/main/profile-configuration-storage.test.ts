import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDataProfileConfigurationStorage } from './profile-configuration-storage.js'

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-storage-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('AppDataProfileConfigurationStorage', () => {
  it('returns null when the configuration file does not exist', async () => {
    const directory = await createTemporaryDirectory()
    const storage = new AppDataProfileConfigurationStorage(
      join(directory, 'nested', 'profiles.json')
    )

    await expect(storage.read()).resolves.toBeNull()
  })

  it('creates the app-data directory and persists UTF-8 JSON', async () => {
    const directory = await createTemporaryDirectory()
    const filePath = join(directory, 'nested', 'profiles.json')
    const storage = new AppDataProfileConfigurationStorage(filePath)

    await storage.write('{"schemaVersion":1}\n')

    await expect(storage.read()).resolves.toBe('{"schemaVersion":1}\n')
    await expect(readFile(filePath, 'utf8')).resolves.toBe('{"schemaVersion":1}\n')
  })

  it('atomically replaces an existing configuration', async () => {
    const directory = await createTemporaryDirectory()
    const storage = new AppDataProfileConfigurationStorage(join(directory, 'profiles.json'))
    await storage.write('first')

    await storage.write('second')

    await expect(storage.read()).resolves.toBe('second')
  })
})
