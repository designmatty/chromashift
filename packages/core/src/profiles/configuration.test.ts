import { describe, expect, it } from 'vitest'
import {
  ConfigurationValidationError,
  UnsupportedConfigurationVersionError,
  parseProfileConfiguration,
  parseProfileConfigurationJson,
  serializeProfileConfiguration
} from './configuration.js'

const validProfile = {
  id: 'default',
  name: 'Default',
  enabled: true,
  color: {},
  applications: [],
  displays: []
}

describe('profile configuration', () => {
  it('validates and serializes the current configuration', () => {
    const configuration = parseProfileConfiguration({
      schemaVersion: 1,
      profiles: [validProfile],
      settings: { defaultProfileId: 'default' }
    })

    expect(parseProfileConfigurationJson(serializeProfileConfiguration(configuration))).toEqual(
      configuration
    )
  })

  it('rejects invalid JSON and invalid profile data', () => {
    expect(() => parseProfileConfigurationJson('{')).toThrow(ConfigurationValidationError)
    expect(() =>
      parseProfileConfiguration({
        schemaVersion: 1,
        profiles: [{ ...validProfile, color: { saturation: 120 } }],
        settings: { defaultProfileId: null }
      })
    ).toThrow(ConfigurationValidationError)
  })

  it('rejects duplicate profile IDs case-insensitively', () => {
    expect(() =>
      parseProfileConfiguration({
        schemaVersion: 1,
        profiles: [validProfile, { ...validProfile, id: 'DEFAULT' }],
        settings: { defaultProfileId: null }
      })
    ).toThrow(/not unique/)
  })

  it('rejects a default profile reference that does not exist', () => {
    expect(() =>
      parseProfileConfiguration({
        schemaVersion: 1,
        profiles: [],
        settings: { defaultProfileId: 'missing' }
      })
    ).toThrow(/does not exist/)
  })

  it('migrates the version 0 top-level default profile setting', () => {
    expect(
      parseProfileConfiguration({
        schemaVersion: 0,
        profiles: [validProfile],
        defaultProfileId: 'default'
      })
    ).toEqual({
      schemaVersion: 1,
      profiles: [validProfile],
      settings: { defaultProfileId: 'default' }
    })
  })

  it('rejects unknown schema versions explicitly', () => {
    expect(() => parseProfileConfiguration({ schemaVersion: 99 })).toThrow(
      UnsupportedConfigurationVersionError
    )
  })
})
