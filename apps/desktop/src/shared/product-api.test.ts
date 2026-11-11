import { describe, expect, it } from 'vitest'
import { createNeutralColorSettings } from '@chromashift/core'
import {
  controlChromaShiftRequestSchema,
  previewStateSchema,
  activationStateSchema,
  diagnosticLogEntriesResultSchema,
  openAppPanelRequestSchema,
  previewUpdateRequestSchema,
  productStateResultSchema,
  reorderProfilesRequestSchema,
  setMiniPanelViewRequestSchema,
  saveProfileRequestSchema,
  userPreferencesSchema
} from '@shared/product-api.js'

describe('product API contracts', () => {
  it('validates pending restoration display IDs without exposing an editable draft', () => {
    expect(
      previewStateSchema.parse({ state: 'restorePending', displayIds: ['display:one'] })
    ).toEqual({
      state: 'restorePending',
      displayIds: ['display:one']
    })
    expect(
      previewStateSchema.safeParse({ state: 'restorePending', displayIds: ['Display 0'] }).success
    ).toBe(false)
    expect(previewStateSchema.safeParse({ state: 'restorePending' }).success).toBe(false)
  })
  it('validates queued switches and binds the full draft to its preview targets', () => {
    const activation = { enabled: true, mode: { kind: 'automatic' }, currentTarget: null }
    expect(
      activationStateSchema.safeParse({
        ...activation,
        queuedTarget: { kind: 'profile', profileId: 'game' }
      }).success
    ).toBe(true)
    expect(
      activationStateSchema.safeParse({ ...activation, queuedTarget: { kind: 'profile' } }).success
    ).toBe(false)
    expect(
      activationStateSchema.safeParse({
        ...activation,
        queuedTarget: { kind: 'shell', command: 'anything' }
      }).success
    ).toBe(false)
    const draft = { id: 'game', name: 'Draft name', enabled: true, applications: [], displays: [] }
    expect(
      previewUpdateRequestSchema.safeParse({ profileId: 'game', targets: [], draft }).success
    ).toBe(true)
    expect(
      previewUpdateRequestSchema.safeParse({ profileId: 'other', targets: [], draft }).success
    ).toBe(false)
    expect(
      previewUpdateRequestSchema.safeParse({
        profileId: 'game',
        targets: [{ displayId: 'display:one', color: createNeutralColorSettings() }],
        draft
      }).success
    ).toBe(false)
  })
  it('rejects malformed renderer profile writes and preview display IDs', () => {
    expect(saveProfileRequestSchema.safeParse({ profile: { id: 'bad' } }).success).toBe(false)
    expect(
      previewUpdateRequestSchema.safeParse({
        profileId: 'gaming',
        targets: [
          {
            displayId: 'Display 0',
            color: { ...createNeutralColorSettings(), saturation: 75 }
          }
        ]
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
          {
            displayId: 'display:one',
            color: { ...createNeutralColorSettings(), saturation: 75 }
          },
          { displayId: 'display:two', color: createNeutralColorSettings() }
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
          {
            displayId: 'display:one',
            color: { ...createNeutralColorSettings(), saturation: 75 }
          },
          {
            displayId: 'DISPLAY:ONE',
            color: { ...createNeutralColorSettings(), brightness: 30 }
          }
        ]
      }).success
    ).toBe(false)
  })

  it('rejects vendor-specific values inside a preview target', () => {
    expect(
      previewUpdateRequestSchema.safeParse({
        profileId: 'gaming',
        targets: [
          {
            displayId: 'display:one',
            color: { ...createNeutralColorSettings(), digitalVibrance: 47 }
          }
        ]
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
    schemaVersion: 3,
    launchAtStartup: false,
    launchBehavior: 'tray',
    closeBehavior: 'tray',
    theme: 'system',
    notificationsEnabled: false,
    shortcutBindings: []
  }
}
