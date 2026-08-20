import { describe, expect, it } from 'vitest'
import {
  diagnosticLogEntriesResultSchema,
  openAppPanelRequestSchema,
  previewUpdateRequestSchema,
  productStateResultSchema,
  reorderProfilesRequestSchema,
  setMiniPanelViewRequestSchema,
  saveProfileRequestSchema
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
    expect(setMiniPanelViewRequestSchema.safeParse({ view: 'override' }).success).toBe(true)
    expect(setMiniPanelViewRequestSchema.safeParse({ view: 'large' }).success).toBe(false)
    expect(
      reorderProfilesRequestSchema.safeParse({ profileIds: ['default', 'gaming'] }).success
    ).toBe(true)
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
