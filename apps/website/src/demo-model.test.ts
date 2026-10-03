import { describe, expect, it } from 'vitest'
import {
  clampPosition,
  createDemoProfiles,
  demoScenes,
  formatValue,
  neutralColor,
  rampTable,
  rampValue,
  resolveProfile,
  sameColor,
  sceneFor,
  screenshotFilter,
  setControl,
  type ActivationMode
} from './demo-model'

const ramp = 'url(#ramp)'

describe('demo color controls', () => {
  it('leaves the screenshot untouched at neutral values', () => {
    expect(screenshotFilter({ ...neutralColor }, ramp)).toBe('none')
    expect(rampTable({ ...neutralColor }, 5)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('follows the display helper ramp: endpoints fixed, midtones moved', () => {
    const brighter = { ...neutralColor, brightness: 100 }
    expect(rampValue(0, brighter)).toBe(0)
    expect(rampValue(1, brighter)).toBe(1)
    expect(rampValue(0.25, brighter)).toBeCloseTo(0.5)
    expect(rampValue(0.25, { ...neutralColor, gamma: 2 })).toBeCloseTo(0.5)
    expect(rampValue(0.25, { ...neutralColor, contrast: 100 })).toBeCloseTo(0.0625)
  })

  it('builds the filter from only the changed controls', () => {
    expect(screenshotFilter({ ...neutralColor, saturation: 75 }, ramp)).toBe('saturate(1.5)')
    expect(screenshotFilter({ ...neutralColor, hue: 50, gamma: 1.2 }, ramp)).toBe(
      'hue-rotate(179.5deg) url(#ramp)'
    )
  })

  it('applies the brightness-dependent gamma envelope', () => {
    const color = setControl({ ...neutralColor, gamma: 2.8 }, 'brightness', 100)
    expect(color).toMatchObject({ brightness: 100, gamma: 2.3 })
    expect(setControl(color, 'gamma', 2.8).gamma).toBe(2.3)
    expect(setControl({ ...neutralColor, gamma: 0.3 }, 'brightness', 0).gamma).toBe(0.5)
    expect(setControl({ ...neutralColor }, 'hue', Number.NaN).hue).toBe(0)
  })

  it('formats values like the mini panel', () => {
    expect(formatValue('brightness', 56.4)).toBe('56%')
    expect(formatValue('gamma', 1)).toBe('1')
    expect(formatValue('gamma', 1.45)).toBe('1.45')
    expect(formatValue('gamma', 1.5)).toBe('1.5')
  })
})

describe('demo activation', () => {
  const profiles = createDemoProfiles()

  const automatic = { kind: 'automatic' } as const
  const resolve = (scene: string, mode: ActivationMode = automatic) =>
    resolveProfile(
      profiles,
      mode,
      demoScenes.find((candidate) => candidate.id === scene)!
    ).id

  it('uses the foreground app profile, then Default', () => {
    expect(resolve('rust-day')).toBe('rust')
    expect(resolve('tarkov-day')).toBe('tarkov')
    expect(resolve('blender')).toBe('blender')
    expect(resolve('figma')).toBe('default')
  })

  it('matches executables case-insensitively', () => {
    const scene = {
      app: { id: 'x', name: 'X', shortName: 'X', executable: 'BLENDER.EXE' },
      variant: null
    }
    expect(resolveProfile(profiles, automatic, scene).id).toBe('blender')
  })

  it('switches to the night profile for night scenes', () => {
    expect(resolve('tarkov-night')).toBe('tarkov-night')
    expect(resolve('rust-night')).toBe('rust-night')
  })

  it('lets a manual selection override the foreground app', () => {
    expect(resolve('rust-night', { kind: 'manual', profileId: 'tarkov' })).toBe('tarkov')
  })

  it('keeps every profile inside the gamma envelope', () => {
    for (const profile of profiles) {
      expect(setControl(profile.color, 'gamma', profile.color.gamma)).toEqual(profile.color)
    }
  })

  it('compares every visible control', () => {
    expect(sameColor(profiles[0]!.color, { ...neutralColor })).toBe(true)
    expect(sameColor(profiles[0]!.color, { ...neutralColor, hue: 1 })).toBe(false)
  })

  it('keeps the time of day when switching apps', () => {
    expect(sceneFor('rust', 'night').id).toBe('rust-night')
    expect(sceneFor('blender', 'night').id).toBe('blender')
    expect(sceneFor('tarkov', null).id).toBe('tarkov-day')
  })
})

describe('mini panel position', () => {
  it('stays inside the stage', () => {
    expect(
      clampPosition({ x: 1000, y: -100 }, { width: 800, height: 600 }, { width: 400, height: 500 })
    ).toEqual({ x: 392, y: 8 })
  })

  it('pins to the top-left when the stage is smaller than the panel', () => {
    expect(
      clampPosition({ x: 100, y: 100 }, { width: 300, height: 400 }, { width: 400, height: 500 })
    ).toEqual({ x: 8, y: 8 })
  })
})
