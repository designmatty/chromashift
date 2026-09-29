import { describe, expect, it } from 'vitest'
import { createNeutralColorSettings, type ColorProfile } from './model.js'
import {
  activeColorTargets,
  findDisplayTarget,
  removeDisplayTarget,
  resolveDisplayColor,
  setDisplayTarget
} from './targets.js'

const color = (overrides = {}) => ({ ...createNeutralColorSettings(), ...overrides })

function profile(): ColorProfile {
  return {
    id: 'gaming',
    name: 'Gaming',
    enabled: true,
    applications: [],
    displays: [
      { displayId: 'display:a', color: color({ saturation: 75 }) },
      { displayId: 'display:b', color: color() }
    ]
  }
}

describe('display targets', () => {
  it('finds and resolves a target case-insensitively', () => {
    expect(findDisplayTarget(profile(), 'DISPLAY:A')?.color.saturation).toBe(75)
    expect(resolveDisplayColor(profile(), 'DISPLAY:A')?.saturation).toBe(75)
    expect(resolveDisplayColor(profile(), 'display:missing')).toBeNull()
  })

  it('returns a detached resolved value', () => {
    const source = profile()
    const resolved = resolveDisplayColor(source, 'display:a')!
    resolved.saturation = 10
    expect(source.displays[0]?.color.saturation).toBe(75)
  })

  it('lists every assigned display in persisted order', () => {
    expect(activeColorTargets(profile()).map((target) => target.displayId)).toEqual([
      'display:a',
      'display:b'
    ])
  })

  it('replaces, appends, and removes targets without mutating the source', () => {
    const source = profile()
    const replaced = setDisplayTarget(source, {
      displayId: 'DISPLAY:A',
      color: color({ brightness: 20 })
    })
    expect(replaced.displays.map((target) => target.displayId)).toEqual(['DISPLAY:A', 'display:b'])
    expect(
      setDisplayTarget(source, { displayId: 'display:c', color: color() }).displays
    ).toHaveLength(3)
    expect(
      removeDisplayTarget(source, 'DISPLAY:B').displays.map((target) => target.displayId)
    ).toEqual(['display:a'])
    expect(source.displays).toHaveLength(2)
  })
})
