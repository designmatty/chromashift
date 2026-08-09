import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProfileConfigurationStorage } from '@chromashift/core'

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export class AppDataProfileConfigurationStorage implements ProfileConfigurationStorage {
  public constructor(public readonly filePath: string) {}

  public async read(): Promise<string | null> {
    try {
      return await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isMissingFileError(error)) return null
      throw error
    }
  }

  public async write(contents: string): Promise<void> {
    const directory = dirname(this.filePath)
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(directory, { recursive: true })

    try {
      await writeFile(temporaryPath, contents, 'utf8')
      await rename(temporaryPath, this.filePath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
}
