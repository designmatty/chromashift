import { describe, expect, it } from 'vitest'
import {
  ConfigurationValidationError,
  UnsupportedConfigurationVersionError,
  createEmptyConfiguration,
  parseProfileConfiguration,
  parseProfileConfigurationJson,
  serializeProfileConfiguration
} from './configuration.js'

const validProfile = {
  id: 'default',
  name: 'Default',
  enabled: true,
  applications: [],
  displays: []
}

describe('profile configuration', () => {
  it('validates and serializes the current configuration', () => {
    const configuration = parseProfileConfiguration({
      schemaVersion: 2,
      profiles: [validProfile],
      settings: { defaultProfileId: 'default' }
    })

    expect(parseProfileConfigurationJson(serializeProfileConfiguration(configuration))).toEqual(
      configuration
    )
  })

  it('creates an empty configuration at the current version', () => {
    expect(createEmptyConfiguration()).toEqual({
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

  it('rejects invalid JSON and invalid per-display data', () => {
    expect(() => parseProfileConfigurationJson('{')).toThrow(ConfigurationValidationError)
    expect(() =>
      parseProfileConfiguration({
        schemaVersion: 2,
        profiles: [
          {
            ...validProfile,
            displays: [{ displayId: 'display:a', color: { saturation: 120 } }]
          }
        ],
        settings: { defaultProfileId: null }
      })
    ).toThrow(ConfigurationValidationError)
  })

  it('rejects duplicate profile IDs case-insensitively', () => {
    expect(() =>
      parseProfileConfiguration({
        schemaVersion: 2,
        profiles: [validProfile, { ...validProfile, id: 'DEFAULT' }],
        settings: { defaultProfileId: null }
      })
    ).toThrow(/not unique/)
  })

  it('rejects a default profile reference that does not exist', () => {
    expect(() =>
      parseProfileConfiguration({
        schemaVersion: 2,
        profiles: [],
        settings: { defaultProfileId: 'missing' }
      })
    ).toThrow(/does not exist/)
  })

  it('rejects unknown schema versions explicitly', () => {
    expect(() => parseProfileConfiguration({ schemaVersion: 99 })).toThrow(
      UnsupportedConfigurationVersionError
    )
  })
})
