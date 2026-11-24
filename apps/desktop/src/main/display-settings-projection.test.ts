import { createNeutralColorSettings } from '@chromashift/core'
import { describe, expect, it } from 'vitest'
import {
  hasDisplaySettings,
  projectDisplaySettings,
  withheldSettingNames
} from '@main/display-settings-projection.js'
import { amdCapabilityReport, nvidiaCapabilityReport } from '@main/testing/fake-native-display.js'

const color = { ...createNeutralColorSettings(), brightness: 30, saturation: 80, hue: 10 }

describe('projectDisplaySettings', () => {
  it('keeps only supported settings in SDR', () => {
    const { capabilities } = nvidiaCapabilityReport('display:one')
    expect(projectDisplaySettings(color, capabilities, false)).toEqual({
      brightness: 30,
      contrast: 50,
      gamma: 1,
      saturation: 80,
      hue: 10
    })
  })

  it('withholds the SDR-only ramp controls under HDR even if a stale report lists them', () => {
    const { capabilities } = nvidiaCapabilityReport('display:one')
    const projected = projectDisplaySettings(color, capabilities, true)
    expect(projected).toEqual({ saturation: 80, hue: 10 })
    expect(withheldSettingNames(color, projected)).toEqual([
      'brightness',
      'contrast',
      'gamma',
      'colorTemperature'
    ])
  })

  it('keeps every AMD ADLX control under HDR and withholds only the Windows ramp gamma (#122)', () => {
    const { capabilities } = amdCapabilityReport('display:one')
    const full = { ...color, contrast: 60, gamma: 1.4, colorTemperature: 40 }
    const projected = projectDisplaySettings(full, capabilities, true)
    expect(projected).toEqual({
      brightness: 30,
      contrast: 60,
      saturation: 80,
      hue: 10,
      colorTemperature: 40
    })
    expect(withheldSettingNames(full, projected)).toEqual(['gamma'])
    expect(projectDisplaySettings(full, capabilities, false)).toEqual(full)
  })

  it('withholds a control under HDR when its endpoints disagree on provider', () => {
    const { capabilities } = amdCapabilityReport('display:one')
    const mixed = { ...capabilities, brightness: { supported: true, provider: 'unknown' as const } }
    expect(projectDisplaySettings(color, mixed, true)).not.toHaveProperty('brightness')
    expect(projectDisplaySettings(color, mixed, false)).toHaveProperty('brightness', 30)
  })

  it('is empty under HDR when only SDR-only controls are supported', () => {
    const { capabilities } = nvidiaCapabilityReport('display:one', false)
    const projected = projectDisplaySettings(color, capabilities, true)
    expect(projected).toEqual({})
    expect(hasDisplaySettings(projected)).toBe(false)
    expect(hasDisplaySettings(undefined)).toBe(false)
    expect(hasDisplaySettings({ saturation: 50 })).toBe(true)
  })
})
