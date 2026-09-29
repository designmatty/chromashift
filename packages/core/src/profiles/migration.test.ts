import { describe, expect, it } from 'vitest'
import { parseProfileConfiguration, parseProfileConfigurationJson } from './configuration.js'
import { versionOneConfigurationFixture } from './__fixtures__/version-one-configuration.js'
import { createNeutralColorSettings } from './model.js'
import type { ConfigurationMigrationNotice } from './migration.js'

describe('profile configuration migration', () => {
  it('migrates version 2 targets to complete neutral-backed values', () => {
    const notices: ConfigurationMigrationNotice[] = []
    const migrated = parseProfileConfiguration(
      {
        schemaVersion: 2,
        profiles: [
          {
            id: 'gaming',
            name: 'Gaming',
            enabled: true,
            applications: [],
            displays: [
              {
                displayId: 'display:a',
                color: { brightness: 100, gamma: 2.8, saturation: 75 },
                lastColorValues: { hue: 40 }
              }
            ]
          }
        ],
        settings: { defaultProfileId: null }
      },
      { onMigrationNotice: (notice) => notices.push(notice) }
    )

    expect(migrated).toEqual({
      schemaVersion: 3,
      profiles: [
        {
          id: 'gaming',
          name: 'Gaming',
          enabled: true,
          applications: [],
          displays: [
            {
              displayId: 'display:a',
              color: {
                ...createNeutralColorSettings(),
                brightness: 100,
                gamma: 2.3,
                saturation: 75
              }
            }
          ]
        }
      ],
      settings: { defaultProfileId: null }
    })
    expect(notices).toEqual([
      {
        code: 'completedDisplayColorSettings',
        profileId: 'gaming',
        displayId: 'display:a',
        addedSettings: ['contrast', 'hue', 'colorTemperature'],
        discardedRememberedSettings: ['hue'],
        gammaAdjustment: { from: 2.8, to: 2.3, brightness: 100 }
      }
    ])
  })

  it('migrates disconnected targets identically because migration is topology-independent', () => {
    const migrated = parseProfileConfiguration({
      schemaVersion: 2,
      profiles: [
        {
          id: 'offline',
          name: 'Offline',
          enabled: true,
          applications: [],
          displays: [{ displayId: 'display:not-connected', color: {} }]
        }
      ],
      settings: { defaultProfileId: null }
    })
    expect(migrated.profiles[0]?.displays[0]?.color).toEqual(createNeutralColorSettings())
  })

  it('migrates versions 0 and 1 through the complete-value path', () => {
    const versionOne = parseProfileConfigurationJson(JSON.stringify(versionOneConfigurationFixture))
    expect(versionOne.schemaVersion).toBe(3)
    expect(versionOne.profiles[0]?.displays[0]?.color).toMatchObject({
      brightness: 50,
      contrast: 50,
      gamma: 1,
      saturation: 69,
      hue: 0,
      colorTemperature: 50
    })

    const versionZero = parseProfileConfiguration({
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
    expect(versionZero.schemaVersion).toBe(3)
    expect(versionZero.profiles[0]?.displays[0]?.color).toEqual({
      ...createNeutralColorSettings(),
      gamma: 1.2
    })
  })

  it('does not invent a target and reports unassigned legacy values', () => {
    const notices: ConfigurationMigrationNotice[] = []
    const migrated = parseProfileConfiguration(
      {
        schemaVersion: 1,
        profiles: [
          {
            id: 'draft',
            name: 'Draft',
            enabled: true,
            color: { brightness: 30 },
            lastColorValues: { hue: 20 },
            applications: [],
            displays: []
          }
        ],
        settings: { defaultProfileId: null }
      },
      { onMigrationNotice: (notice) => notices.push(notice) }
    )
    expect(migrated.profiles[0]?.displays).toEqual([])
    expect(notices).toEqual([
      {
        code: 'discardedUnassignedColorSettings',
        profileId: 'draft',
        settings: ['brightness', 'hue']
      }
    ])
  })

  it('rejects duplicate legacy targets case-insensitively', () => {
    expect(() =>
      parseProfileConfiguration({
        schemaVersion: 2,
        profiles: [
          {
            id: 'gaming',
            name: 'Gaming',
            enabled: true,
            applications: [],
            displays: [
              { displayId: 'display:a', color: {} },
              { displayId: 'DISPLAY:A', color: {} }
            ]
          }
        ],
        settings: { defaultProfileId: null }
      })
    ).toThrow(/assigned more than once/)
  })
})
