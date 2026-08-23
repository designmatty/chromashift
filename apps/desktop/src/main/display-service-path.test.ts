import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDisplayServicePath } from './display-service-path.js'

const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-service-path-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('resolveDisplayServicePath', () => {
  it('uses only the external resources directory in packaged builds', async () => {
    const root = await temporaryDirectory()
    const executable = join(root, 'resources', 'display-service', 'DisplayService.exe')
    await mkdir(join(root, 'resources', 'display-service'), { recursive: true })
    await writeFile(executable, '')

    expect(
      resolveDisplayServicePath({
        isPackaged: true,
        resourcesPath: join(root, 'resources'),
        appPath: join(root, 'resources', 'app.asar'),
        cwd: root,
        configuredPath: join(root, 'wrong.exe')
      })
    ).toBe(executable)
  })

  it('honors an explicit development helper path', async () => {
    const root = await temporaryDirectory()
    const executable = join(root, 'DisplayService.exe')
    await writeFile(executable, '')

    expect(
      resolveDisplayServicePath({
        isPackaged: false,
        resourcesPath: root,
        appPath: root,
        cwd: root,
        configuredPath: executable
      })
    ).toBe(executable)
  })
})
