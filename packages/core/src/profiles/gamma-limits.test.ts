import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { clampProfileGamma, displayLimitsSchema, effectiveGammaRange } from './gamma-limits.js'
import { createNeutralColorSettings } from './model.js'

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../../fixtures/display-limits/${name}.json`, import.meta.url),
      'utf8'
    )
  )
}

describe('versioned learned gamma limits', () => {
  it('uses the unchanged starting envelope when the new file is absent or empty', () => {
    const empty = displayLimitsSchema.parse(fixture('empty-v1'))
    expect(effectiveGammaRange(empty.displays['display:one'], 100)).toEqual({ min: 0.3, max: 2.3 })
  })

  it('narrows only the matching display, brightness and color mode', () => {
    const limits = displayLimitsSchema.parse(fixture('learned-v1'))
    expect(effectiveGammaRange(limits.displays['display:one'], 50)).toEqual({
      min: 0.65,
      max: 1.85
    })
    expect(effectiveGammaRange(limits.displays['display:one'], 51)).toEqual({ min: 0.3, max: 2.8 })
    expect(effectiveGammaRange(limits.displays['display:one'], 50, 'hdr')).toEqual({
      min: 0.3,
      max: 2.8
    })
    const profile = {
      id: 'test',
      name: 'Unsaved name',
      enabled: true,
      applications: [],
      displays: [
        {
          displayId: 'DISPLAY:ONE',
          color: { ...createNeutralColorSettings(), gamma: 2.5, hue: 30 }
        },
        { displayId: 'display:two', color: { ...createNeutralColorSettings(), gamma: 0.3 } }
      ]
    }
    const result = clampProfileGamma(profile, limits)
    expect(result.displays[0]!.color).toEqual({ ...profile.displays[0]!.color, gamma: 1.85 })
    expect(result.displays[1]).toEqual(profile.displays[1])
    expect(result.name).toBe('Unsaved name')
    expect(profile.displays[0]!.color.gamma).toBe(2.5)
  })

  it('rejects corrupt, future and widened envelopes instead of resetting them', () => {
    expect(displayLimitsSchema.safeParse(fixture('invalid-v1')).success).toBe(false)
    expect(displayLimitsSchema.safeParse({ schemaVersion: 2, displays: {} }).success).toBe(false)
    const limits = displayLimitsSchema.parse(fixture('learned-v1'))
    limits.displays['display:one']!.sdr!.brightness['50'] = { min: 1.1 }
    expect(displayLimitsSchema.safeParse(limits).success).toBe(false)
  })
})
