import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, parse } from 'node:path'

const STABLE_APPLICATION_DIRECTORY = 'ChromaShift'
const DEVELOPMENT_APPLICATION_DIRECTORY = 'ChromaShift-development'
const LEGACY_APPLICATION_DIRECTORY = join('@chromashift', 'desktop')

export interface ApplicationDataPaths {
  userDataDirectory: string
  profileConfigurationPath: string
  settingsPath: string
  legacyProfileConfigurationPaths: string[]
}

export function resolveApplicationDataPaths(
  appDataDirectory: string,
  userDataOverride?: string,
  developmentWorktreeRoot?: string
): ApplicationDataPaths {
  if (userDataOverride !== undefined) {
    return {
      userDataDirectory: userDataOverride,
      profileConfigurationPath: join(userDataOverride, 'profiles.json'),
      settingsPath: join(userDataOverride, 'settings.json'),
      legacyProfileConfigurationPaths: []
    }
  }

  if (developmentWorktreeRoot !== undefined) {
    const canonicalRoot = realpathSync.native(developmentWorktreeRoot)
    const rootName = basename(canonicalRoot).replaceAll(/[^a-zA-Z0-9._-]/g, '-') || 'worktree'
    const rootHash = createHash('sha256')
      .update(canonicalRoot.toLocaleLowerCase('en-US'))
      .digest('hex')
      .slice(0, 12)
    const userDataDirectory = join(
      appDataDirectory,
      DEVELOPMENT_APPLICATION_DIRECTORY,
      `${rootName}-${rootHash}`
    )
    return {
      userDataDirectory,
      profileConfigurationPath: join(userDataDirectory, 'profiles.json'),
      settingsPath: join(userDataDirectory, 'settings.json'),
      legacyProfileConfigurationPaths: []
    }
  }

  const userDataDirectory = join(appDataDirectory, STABLE_APPLICATION_DIRECTORY)
  return {
    userDataDirectory,
    profileConfigurationPath: join(userDataDirectory, 'profiles.json'),
    settingsPath: join(userDataDirectory, 'settings.json'),
    legacyProfileConfigurationPaths: [
      join(appDataDirectory, LEGACY_APPLICATION_DIRECTORY, 'profiles.json')
    ]
  }
}

export function findGitWorktreeRoot(startPaths: readonly string[]): string | undefined {
  for (const startPath of startPaths) {
    let current = startPath
    while (true) {
      if (existsSync(join(current, '.git'))) return current
      const parent = dirname(current)
      if (parent === current || current === parse(current).root) break
      current = parent
    }
  }
  return undefined
}
