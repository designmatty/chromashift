import { describe, expect, it } from 'vitest'
import type { ColorProfile } from '@chromashift/core'
import { rewriteProfile } from './physical-display-profile-rewrite.js'

function profile(displays: ColorProfile['displays']): ColorProfile {
  return {
    id: 'profile',
    name: 'Profile',
    enabled: true,
    applications: [],
    displays
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

    expect(result.profile.displays).toEqual([
      { displayId: 'display:physical', color: { saturation: 80 } }
    ])
    expect(result.remappedTargets).toBe(2)
    expect(result.discardedConflicts).toBe(2)
  })

  it('leaves disconnected unknown targets persisted', () => {
    const source = profile([{ displayId: 'display:gone', color: { gamma: 1.1 } }])

    expect(rewriteProfile(source, new Map()).profile).toEqual(source)
  })
})
