import { constants } from 'node:fs'
import { access, copyFile, link, mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export async function migrateLegacyProfileConfiguration(
  destinationPath: string,
  legacyPaths: readonly string[]
): Promise<string | null> {
  if (await exists(destinationPath)) return null

  await mkdir(dirname(destinationPath), { recursive: true })
  for (const legacyPath of legacyPaths) {
    if (resolve(legacyPath).toLowerCase() === resolve(destinationPath).toLowerCase()) continue
    const temporaryPath = `${destinationPath}.${randomUUID()}.migration`
    try {
      await copyFile(legacyPath, temporaryPath, constants.COPYFILE_EXCL)
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue
      }
      throw error
    }

    try {
      await link(temporaryPath, destinationPath)
      return legacyPath
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        return null
      }
      throw error
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
  return null
}
