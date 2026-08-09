import { join } from 'node:path'

const STABLE_APPLICATION_DIRECTORY = 'ChromaShift'
const LEGACY_APPLICATION_DIRECTORY = join('@chromashift', 'desktop')

export interface ApplicationDataPaths {
  userDataDirectory: string
  profileConfigurationPath: string
  settingsPath: string
  legacyProfileConfigurationPaths: string[]
}

export function resolveApplicationDataPaths(
  appDataDirectory: string,
  userDataOverride?: string
): ApplicationDataPaths {
  if (userDataOverride !== undefined) {
    return {
      userDataDirectory: userDataOverride,
      profileConfigurationPath: join(userDataOverride, 'profiles.json'),
      settingsPath: join(userDataOverride, 'settings.json'),
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
