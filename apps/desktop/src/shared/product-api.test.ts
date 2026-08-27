import { describe, expect, it } from 'vitest'
import {
  controlChromaShiftRequestSchema,
  diagnosticLogEntriesResultSchema,
  openAppPanelRequestSchema,
  previewUpdateRequestSchema,
  productStateResultSchema,
  reorderProfilesRequestSchema,
  setMiniPanelViewRequestSchema,
  saveProfileRequestSchema,
  userPreferencesSchema
} from './product-api.js'

describe('product API contracts', () => {
  it('rejects malformed renderer profile writes and preview display IDs', () => {
    expect(saveProfileRequestSchema.safeParse({ profile: { id: 'bad' } }).success).toBe(false)
    expect(
      previewUpdateRequestSchema.safeParse({
        profileId: 'gaming',
        targets: [{ displayId: 'Display 0', color: { saturation: 75 } }]
      }).success
    ).toBe(false)
    expect(openAppPanelRequestSchema.safeParse({ view: 'logs' }).success).toBe(false)
    expect(openAppPanelRequestSchema.safeParse({ view: 'diagnostics' }).success).toBe(true)
    expect(openAppPanelRequestSchema.safeParse({ view: 'settings' }).success).toBe(true)
    expect(
      setMiniPanelViewRequestSchema.safeParse({ view: 'override', showColorTemperature: true })
        .success
    ).toBe(true)
    expect(
      setMiniPanelViewRequestSchema.safeParse({ view: 'large', showColorTemperature: false })
        .success
    ).toBe(false)
    expect(setMiniPanelViewRequestSchema.safeParse({ view: 'controls' }).success).toBe(false)
    expect(controlChromaShiftRequestSchema.safeParse({ action: 'stop' }).success).toBe(false)
    expect(controlChromaShiftRequestSchema.safeParse({ action: 'retry' }).success).toBe(true)
    expect(
      reorderProfilesRequestSchema.safeParse({ profileIds: ['default', 'gaming'] }).success
    ).toBe(true)
  })

  it('rejects malformed shortcut bindings and main-owned fields in preferences', () => {
    expect(
      userPreferencesSchema.safeParse({
        ...validSettings(),
        shortcutBindings: [{ action: { kind: 'profile' }, accelerator: 'Control+G' }]
      }).success
    ).toBe(false)
    // ChromaShift intent and window geometry are main-owned slices; the strict
    // preferences schema must reject them at the renderer seam.
    expect(
      userPreferencesSchema.safeParse({ ...validSettings(), chromaShiftStatus: 'active' }).success
    ).toBe(false)
    expect(
      userPreferencesSchema.safeParse({
        ...validSettings(),
        windowBounds: { x: 0, y: 0, width: 800, height: 600 }
      }).success
    ).toBe(false)
    expect(userPreferencesSchema.safeParse(validSettings()).success).toBe(true)
  })

  it('accepts independent per-display preview targets', () => {
    expect(
      previewUpdateRequestSchema.safeParse({
        profileId: 'gaming',
        targets: [
          { displayId: 'display:one', color: { saturation: 75 } },
          { displayId: 'display:two', color: {} }
        ]
      }).success
    ).toBe(true)
  })

  it('rejects the retired shared preview color payload', () => {
    expect(
      previewUpdateRequestSchema.safeParse({
        profileId: 'gaming',
        color: { saturation: 75 },
        displayIds: ['display:one']
      }).success
    ).toBe(false)
  })

  it('rejects duplicate preview targets case-insensitively', () => {
    expect(
      previewUpdateRequestSchema.safeParse({
        profileId: 'gaming',
        targets: [
          { displayId: 'display:one', color: { saturation: 75 } },
          { displayId: 'DISPLAY:ONE', color: { brightness: 30 } }
        ]
      }).success
    ).toBe(false)
  })

  it('rejects vendor-specific values inside a preview target', () => {
    expect(
      previewUpdateRequestSchema.safeParse({
        profileId: 'gaming',
        targets: [{ displayId: 'display:one', color: { digitalVibrance: 47 } }]
      }).success
    ).toBe(false)
  })

  it('rejects malformed main-process responses', () => {
    expect(productStateResultSchema.safeParse({ ok: true, value: { displays: [] } }).success).toBe(
      false
    )
    expect(
      productStateResultSchema.safeParse({
        ok: false,
        error: { code: 'INTERNAL', message: 'untyped failure' }
      }).success
    ).toBe(false)
    expect(
      diagnosticLogEntriesResultSchema.safeParse({
        ok: true,
        value: [
          {
            timestamp: '2026-08-20T12:00:00.000Z',
            level: 'debug',
            eventName: 'Unexpected',
            details: ''
          }
        ]
      }).success
    ).toBe(false)
  })
})

function validSettings() {
  return {
    schemaVersion: 2,
    launchAtStartup: false,
    launchBehavior: 'tray',
    closeBehavior: 'tray',
    theme: 'system',
    notificationsEnabled: false,
    shortcutBindings: []
  }
}
