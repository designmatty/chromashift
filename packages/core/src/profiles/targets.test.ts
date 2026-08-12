import { describe, expect, it } from 'vitest'
import type { ColorProfile } from './model.js'
import {
  activeColorTargets,
  findDisplayTarget,
  hasColorOverrides,
  removeDisplayTarget,
  resolveDisplayColor,
  setDisplayTarget
} from './targets.js'

function profile(): ColorProfile {
  return {
    id: 'gaming',
    name: 'Gaming',
    enabled: true,
    applications: [],
    displays: [
      { displayId: 'display:a', color: { saturation: 75 } },
      { displayId: 'display:b', color: {}, lastColorValues: { brightness: 60 } }
    ]
  }
}

describe('display targets', () => {
  it('finds a target case-insensitively', () => {
    expect(findDisplayTarget(profile(), 'DISPLAY:A')?.color).toEqual({ saturation: 75 })
    expect(findDisplayTarget(profile(), 'display:missing')).toBeNull()
  })

  it('resolves an absent or empty target to baseline', () => {
    expect(resolveDisplayColor(profile(), 'display:b')).toEqual({})
    expect(resolveDisplayColor(profile(), 'display:missing')).toEqual({})
  })

  it('returns a detached copy of the resolved settings', () => {
    const source = profile()
    const resolved = resolveDisplayColor(source, 'display:a')
    resolved.saturation = 10

    expect(source.displays[0]?.color.saturation).toBe(75)
  })

  it('lists only displays with active overrides, in persisted order', () => {
    expect(activeColorTargets(profile())).toEqual([
      { displayId: 'display:a', color: { saturation: 75 } }
    ])
  })

  it('reports whether a settings object overrides anything', () => {
    expect(hasColorOverrides({})).toBe(false)
    expect(hasColorOverrides({ hue: 0 })).toBe(true)
  })

  it('replaces an existing target in place and appends a new one', () => {
    const replaced = setDisplayTarget(profile(), {
      displayId: 'DISPLAY:A',
      color: { brightness: 20 }
    })
    expect(replaced.displays.map((target) => target.displayId)).toEqual([
      'DISPLAY:A',
      'display:b'
    ])

    const appended = setDisplayTarget(profile(), { displayId: 'display:c', color: {} })
    expect(appended.displays).toHaveLength(3)
  })

  it('removes a target case-insensitively without mutating the source', () => {
    const source = profile()
    const removed = removeDisplayTarget(source, 'DISPLAY:B')

    expect(removed.displays.map((target) => target.displayId)).toEqual(['display:a'])
    expect(source.displays).toHaveLength(2)
  })
})
