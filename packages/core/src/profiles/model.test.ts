import { describe, expect, it } from 'vitest'
import {
  clampGammaForBrightness,
  colorProfileSchema,
  colorSettingsSchema,
  createNeutralColorSettings,
  gammaRangeForBrightness
} from './model.js'

function color(overrides: Partial<ReturnType<typeof createNeutralColorSettings>> = {}) {
  return { ...createNeutralColorSettings(), ...overrides }
}

function validProfile() {
  return {
    id: 'gaming',
    name: 'Gaming',
    enabled: true,
    applications: [{ executableName: 'Game.exe', executablePath: 'C:\\Games\\Game.exe' }],
    displays: [{ displayId: 'display:primary', color: color({ saturation: 75, gamma: 2.8 }) }]
  }
}

describe('profile model', () => {
  it('requires complete vendor-neutral color settings', () => {
    expect(colorProfileSchema.parse(validProfile())).toEqual(validProfile())
    expect(() => colorSettingsSchema.parse({ saturation: 75 })).toThrow()
    expect(() =>
      colorProfileSchema.parse({
        ...validProfile(),
        displays: [{ displayId: 'display:primary', color: {}, lastColorValues: { gamma: 1.2 } }]
      })
    ).toThrow()
  })

  it('stores independent complete values for each display', () => {
    const profile = colorProfileSchema.parse({
      ...validProfile(),
      displays: [
        { displayId: 'display:primary', color: color({ saturation: 75 }) },
        { displayId: 'display:secondary', color: color({ brightness: 40, gamma: 1.2 }) }
      ]
    })
    expect(profile.displays[0]?.color.saturation).toBe(75)
    expect(profile.displays[1]?.color).toEqual(color({ brightness: 40, gamma: 1.2 }))
  })

  it.each([
    [0, 0.5, 2.8],
    [7, 0.4, 2.8],
    [30, 0.3, 2.8],
    [87, 0.3, 2.7],
    [90, 0.3, 2.6],
    [92, 0.3, 2.5],
    [97, 0.3, 2.4],
    [100, 0.3, 2.3]
  ])('uses the gamma range for %s%% brightness', (brightness, min, max) => {
    expect(gammaRangeForBrightness(brightness)).toEqual({ min, max })
    expect(clampGammaForBrightness(0.3, brightness)).toBe(min)
    expect(clampGammaForBrightness(2.8, brightness)).toBe(max)
  })

  it('rejects gamma outside the brightness-dependent range', () => {
    expect(() => colorSettingsSchema.parse(color({ brightness: 100, gamma: 2.31 }))).toThrow(
      /between 0.3 and 2.3/
    )
    expect(colorSettingsSchema.parse(color({ brightness: 100, gamma: 2.3 }))).toEqual(
      color({ brightness: 100, gamma: 2.3 })
    )
  })

  it('rejects vendor-specific fields and duplicate display targets', () => {
    expect(() => colorSettingsSchema.parse({ ...color(), digitalVibrance: 47 })).toThrow()
    expect(() =>
      colorProfileSchema.parse({
        ...validProfile(),
        displays: [
          { displayId: 'display:primary', color: color() },
          { displayId: 'DISPLAY:PRIMARY', color: color() }
        ]
      })
    ).toThrow(/assigned more than once/)
  })
})
