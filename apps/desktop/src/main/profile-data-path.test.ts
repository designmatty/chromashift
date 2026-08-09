import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveApplicationDataPaths } from './application-data-path.js'
import { migrateLegacyProfileConfiguration } from './profile-configuration-migration.js'

const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-profile-migration-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('profile application-data path', () => {
  it('uses an explicit branded path and retains the pre-packaging location as legacy', () => {
    const paths = resolveApplicationDataPaths('C:\\Users\\test\\AppData\\Roaming')

    expect(paths).toEqual({
      userDataDirectory: 'C:\\Users\\test\\AppData\\Roaming\\ChromaShift',
      profileConfigurationPath: 'C:\\Users\\test\\AppData\\Roaming\\ChromaShift\\profiles.json',
      settingsPath: 'C:\\Users\\test\\AppData\\Roaming\\ChromaShift\\settings.json',
      legacyProfileConfigurationPaths: [
        'C:\\Users\\test\\AppData\\Roaming\\@chromashift\\desktop\\profiles.json'
      ]
    })
  })

  it('honors an explicit isolated user-data directory without importing legacy data', () => {
    const paths = resolveApplicationDataPaths(
      'C:\\Users\\test\\AppData\\Roaming',
      'D:\\isolated-smoke-data'
    )

    expect(paths).toEqual({
      userDataDirectory: 'D:\\isolated-smoke-data',
      profileConfigurationPath: 'D:\\isolated-smoke-data\\profiles.json',
      settingsPath: 'D:\\isolated-smoke-data\\settings.json',
      legacyProfileConfigurationPaths: []
    })
  })
})

describe('migrateLegacyProfileConfiguration', () => {
  it('copies the legacy profile exactly when the stable destination is absent', async () => {
    const root = await temporaryDirectory()
    const legacyPath = join(root, 'legacy', 'profiles.json')
    const destinationPath = join(root, 'stable', 'profiles.json')
    const contents = '{"schemaVersion":1,"profiles":[],"settings":{"defaultProfileId":null}}\n'
    await mkdir(join(root, 'legacy'), { recursive: true })
    await writeFile(legacyPath, contents)

    await expect(
      migrateLegacyProfileConfiguration(destinationPath, [legacyPath])
    ).resolves.toBe(legacyPath)
    await expect(readFile(destinationPath, 'utf8')).resolves.toBe(contents)
    await expect(readFile(legacyPath, 'utf8')).resolves.toBe(contents)
  })

  it('never overwrites an existing stable profile', async () => {
    const root = await temporaryDirectory()
    const legacyPath = join(root, 'legacy.json')
    const destinationPath = join(root, 'stable', 'profiles.json')
    await mkdir(join(root, 'stable'), { recursive: true })
    await writeFile(legacyPath, 'legacy')
    await writeFile(destinationPath, 'current')

    await expect(
      migrateLegacyProfileConfiguration(destinationPath, [legacyPath])
    ).resolves.toBeNull()
    await expect(readFile(destinationPath, 'utf8')).resolves.toBe('current')
  })

  it('is race-safe when two application instances attempt migration', async () => {
    const root = await temporaryDirectory()
    const legacyPath = join(root, 'legacy.json')
    const destinationPath = join(root, 'stable', 'profiles.json')
    await writeFile(legacyPath, 'legacy')

    const results = await Promise.all([
      migrateLegacyProfileConfiguration(destinationPath, [legacyPath]),
      migrateLegacyProfileConfiguration(destinationPath, [legacyPath])
    ])

    expect(results.filter((result) => result === legacyPath)).toHaveLength(1)
    await expect(readFile(destinationPath, 'utf8')).resolves.toBe('legacy')
  })
})
