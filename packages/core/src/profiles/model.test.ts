import { describe, expect, it } from 'vitest'
import { colorProfileSchema, colorSettingsSchema } from './model.js'

function validProfile() {
  return {
    id: 'gaming',
    name: 'Gaming',
    enabled: true,
    color: { saturation: 75, gamma: 2.8 },
    applications: [
      {
        executableName: 'Game.exe',
        executablePath: 'C:\\Games\\Game.exe'
      }
    ],
    displays: [{ displayId: 'display:primary' }]
  }
}

describe('profile model', () => {
  it('accepts vendor-neutral normalized values', () => {
    expect(colorProfileSchema.parse(validProfile())).toEqual(validProfile())
  })

  it('retains inactive values separately from applied overrides', () => {
    expect(colorProfileSchema.parse({
      ...validProfile(),
      color: {},
      lastColorValues: { brightness: 75, gamma: 1.3 }
    })).toMatchObject({
      color: {},
      lastColorValues: { brightness: 75, gamma: 1.3 }
    })
  })

  it('preserves omitted settings as omitted overrides', () => {
    const settings = colorSettingsSchema.parse({ saturation: 75 })

    expect(settings).toEqual({ saturation: 75 })
    expect(Object.hasOwn(settings, 'gamma')).toBe(false)
  })

  it.each([
    ['brightness', -1],
    ['contrast', 101],
    ['gamma', 0.49],
    ['gamma', 2.81],
    ['saturation', Number.NaN]
  ])('rejects an unsafe %s value of %s', (setting, value) => {
    expect(() => colorSettingsSchema.parse({ [setting]: value })).toThrow()
  })

  it('rejects vendor-specific persisted controls', () => {
    expect(() =>
      colorSettingsSchema.parse({ saturation: 75, digitalVibrance: 47 })
    ).toThrow()
  })

  it('rejects duplicate display targets case-insensitively', () => {
    const profile = validProfile()
    profile.displays.push({ displayId: 'DISPLAY:PRIMARY' })

    expect(() => colorProfileSchema.parse(profile)).toThrow(/assigned more than once/)
  })
})
