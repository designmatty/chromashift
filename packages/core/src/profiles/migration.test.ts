import { describe, expect, it } from 'vitest'
import { parseProfileConfiguration, parseProfileConfigurationJson } from './configuration.js'
import { versionOneConfigurationFixture } from './__fixtures__/version-one-configuration.js'
import {
  migrateVersionOneProfile,
  type ConfigurationMigrationNotice,
  type VersionOneProfile
} from './migration.js'
import type { ColorProfile } from './model.js'
import { activeColorTargets } from './targets.js'

const fixtureJson = JSON.stringify(versionOneConfigurationFixture)

/**
 * The apply requests version 1 would have issued: every assigned display received
 * the profile's single shared color object.
 */
function versionOneApplyRequests(profile: VersionOneProfile): Array<[string, unknown]> {
  if (Object.keys(profile.color).length === 0) return []
  return profile.displays.map((display) => [display.displayId, profile.color])
}

function versionTwoApplyRequests(profile: ColorProfile): Array<[string, unknown]> {
  return activeColorTargets(profile).map((target) => [target.displayId, target.color])
}

describe('version 1 to version 2 migration', () => {
  it('copies the shared color into every existing display target', () => {
    const migrated = migrateVersionOneProfile({
      id: 'gaming',
      name: 'Gaming',
      enabled: true,
      color: { saturation: 75 },
      applications: [],
      displays: [{ displayId: 'display:a' }, { displayId: 'display:b' }]
    })

    expect(migrated.displays).toEqual([
      { displayId: 'display:a', color: { saturation: 75 } },
      { displayId: 'display:b', color: { saturation: 75 } }
    ])
    expect(Object.hasOwn(migrated, 'color')).toBe(false)
  })

  it('copies remembered values into every target when present', () => {
    const migrated = migrateVersionOneProfile({
      id: 'gaming',
      name: 'Gaming',
      enabled: true,
      color: {},
      lastColorValues: { brightness: 60 },
      applications: [],
      displays: [{ displayId: 'display:a' }, { displayId: 'display:b' }]
    })

    expect(migrated.displays.map((target) => target.lastColorValues)).toEqual([
      { brightness: 60 },
      { brightness: 60 }
    ])
  })

  it('gives each migrated target an independently editable settings object', () => {
    const migrated = migrateVersionOneProfile({
      id: 'gaming',
      name: 'Gaming',
      enabled: true,
      color: { saturation: 75 },
      applications: [],
      displays: [{ displayId: 'display:a' }, { displayId: 'display:b' }]
    })

    migrated.displays[0]!.color.saturation = 10

    expect(migrated.displays[1]?.color.saturation).toBe(75)
  })

  it('preserves profile identity, order, rules and display order', () => {
    const configuration = parseProfileConfigurationJson(fixtureJson)

    expect(configuration.schemaVersion).toBe(2)
    expect(configuration.settings.defaultProfileId).toBe('default')
    expect(configuration.profiles.map((profile) => profile.id)).toEqual([
      'default',
      '39f1eca3-6fc7-4022-be23-088176604eed',
      '16111f4f-c9ea-4b2a-a25a-367f0e97af74',
      '5b0a41f2-1f0c-42f7-9d4a-2f1f7d9b6c31'
    ])
    expect(configuration.profiles[0]?.displays.map((target) => target.displayId)).toEqual([
      'display:355f1efb6477b78b6c7a15fa935aaccc',
      'display:551e7e413a7461154c7fce64df890e63'
    ])
    expect(configuration.profiles[1]?.applications).toEqual([
      {
        executableName: 'EscapeFromTarkov.exe',
        executablePath: 'C:\\Battlestate Games\\Escape from Tarkov\\EscapeFromTarkov.exe'
      }
    ])
    expect(configuration.profiles.map((profile) => profile.enabled)).toEqual([
      true,
      true,
      true,
      true
    ])
  })

  it('produces the same per-display apply requests as version 1', () => {
    const versionOne = JSON.parse(fixtureJson) as { profiles: VersionOneProfile[] }
    const migrated = parseProfileConfigurationJson(fixtureJson)

    for (const [index, legacyProfile] of versionOne.profiles.entries()) {
      const migratedProfile = migrated.profiles[index]!
      expect(versionTwoApplyRequests(migratedProfile)).toEqual(
        versionOneApplyRequests(legacyProfile)
      )
    }
  })

  it('discards inert color values with an explicit diagnostic', () => {
    const notices: ConfigurationMigrationNotice[] = []
    const migrated = parseProfileConfigurationJson(fixtureJson, {
      onMigrationNotice: (notice) => notices.push(notice)
    })

    expect(notices).toEqual([
      {
        code: 'discardedUnassignedColorSettings',
        profileId: '5b0a41f2-1f0c-42f7-9d4a-2f1f7d9b6c31',
        settings: ['brightness', 'hue']
      }
    ])
    expect(migrated.profiles[3]?.displays).toEqual([])
  })

  it('does not invent a display target for an unassigned profile', () => {
    const migrated = migrateVersionOneProfile({
      id: 'draft',
      name: 'Draft',
      enabled: true,
      color: { brightness: 30 },
      applications: [],
      displays: []
    })

    expect(migrated.displays).toEqual([])
  })

  it('rejects duplicate version 1 display targets case-insensitively', () => {
    expect(() =>
      parseProfileConfiguration({
        schemaVersion: 1,
        profiles: [
          {
            id: 'gaming',
            name: 'Gaming',
            enabled: true,
            color: { saturation: 75 },
            applications: [],
            displays: [{ displayId: 'display:a' }, { displayId: 'DISPLAY:A' }]
          }
        ],
        settings: { defaultProfileId: null }
      })
    ).toThrow(/assigned more than once/)
  })

  it('migrates version 0 through the same per-display path', () => {
    const migrated = parseProfileConfiguration({
      schemaVersion: 0,
      profiles: [
        {
          id: 'default',
          name: 'Default profile',
          enabled: true,
          color: { gamma: 1.2 },
          applications: [],
          displays: [{ displayId: 'display:a' }]
        }
      ],
      defaultProfileId: 'default'
    })

    expect(migrated).toEqual({
      schemaVersion: 2,
      profiles: [
        {
          id: 'default',
          name: 'Default profile',
          enabled: true,
          applications: [],
          displays: [{ displayId: 'display:a', color: { gamma: 1.2 } }]
        }
      ],
      settings: { defaultProfileId: 'default' }
    })
  })
})
