import { describe, expect, it } from 'vitest'
import {
  createNeutralColorSettings,
  type ColorProfile,
  type ColorSettings
} from '@chromashift/core'
import { rewriteProfile } from '@main/physical-display-profile-rewrite.js'

function profile(
  displays: Array<{ displayId: string; color: Partial<ColorSettings> }>
): ColorProfile {
  return {
    id: 'profile',
    name: 'Profile',
    enabled: true,
    applications: [],
    displays: displays.map((target) => ({
      displayId: target.displayId,
      color: { ...createNeutralColorSettings(), ...target.color }
    }))
  }
}

describe('physical display profile rewrite', () => {
  it('rewrites connector endpoint targets to one physical target', () => {
    const result = rewriteProfile(
      profile([{ displayId: 'display:dp', color: { saturation: 75 } }]),
      new Map([['display:dp', 'display:physical']])
    )

    expect(result).toEqual({
      profile: profile([{ displayId: 'display:physical', color: { saturation: 75 } }]),
      remappedTargets: 1,
      discardedConflicts: 0
    })
  })

  it('deduplicates DP and HDMI targets and prefers an existing physical target', () => {
    const result = rewriteProfile(
      profile([
        { displayId: 'display:dp', color: { saturation: 60 } },
        { displayId: 'display:physical', color: { saturation: 80 } },
        { displayId: 'display:hdmi', color: { saturation: 70 } }
      ]),
      new Map([
        ['display:dp', 'display:physical'],
        ['display:hdmi', 'display:physical']
      ])
    )

    expect(result.profile.displays).toEqual(
      profile([{ displayId: 'display:physical', color: { saturation: 80 } }]).displays
    )
    expect(result.remappedTargets).toBe(2)
    expect(result.discardedConflicts).toBe(2)
  })

  it('leaves disconnected unknown targets persisted', () => {
    const source = profile([{ displayId: 'display:gone', color: { gamma: 1.1 } }])

    expect(rewriteProfile(source, new Map()).profile).toEqual(source)
  })
})
