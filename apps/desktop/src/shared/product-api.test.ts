import { describe, expect, it } from 'vitest'
import {
  openAppPanelRequestSchema,
  previewUpdateRequestSchema,
  productStateResultSchema,
  saveProfileRequestSchema
} from './product-api.js'

describe('product API contracts', () => {
  it('rejects malformed renderer profile writes and preview display IDs', () => {
    expect(saveProfileRequestSchema.safeParse({ profile: { id: 'bad' } }).success).toBe(false)
    expect(previewUpdateRequestSchema.safeParse({
      profileId: 'gaming',
      color: { saturation: 75 },
      displayIds: ['Display 0']
    }).success).toBe(false)
    expect(openAppPanelRequestSchema.safeParse({ view: 'logs' }).success).toBe(false)
    expect(openAppPanelRequestSchema.safeParse({ view: 'settings' }).success).toBe(true)
  })

  it('rejects malformed main-process responses', () => {
    expect(productStateResultSchema.safeParse({ ok: true, value: { displays: [] } }).success).toBe(false)
    expect(productStateResultSchema.safeParse({
      ok: false,
      error: { code: 'INTERNAL', message: 'untyped failure' }
    }).success).toBe(false)
  })
})
