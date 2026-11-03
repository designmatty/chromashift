import { describe, expect, it } from 'vitest'
import { createNeutralColorSettings } from '@chromashift/core'
import type { DisplayCapabilityReport } from '@chromashift/native-client/protocol'
import {
  degreesToHue,
  formatValue,
  hueToDegrees,
  parseControlValue,
  showColorTemperature
} from '@/features/profiles/control-values'

describe('color control presentation', () => {
  it('round-trips every stored hue through displayed degrees', () => {
    for (let stored = 0; stored <= 100; stored++) {
      expect(degreesToHue(hueToDegrees(stored))).toBe(stored)
    }
    expect(hueToDegrees(0)).toBe(0)
    expect(hueToDegrees(100)).toBe(359)
    expect(parseControlValue('hue', '180', 0, 100)).toBe(50)
    expect(parseControlValue('hue', '360', 0, 100)).toBe(100)
    expect(parseControlValue('hue', '-1', 0, 100)).toBe(0)
  })

  it('keeps units and gamma precision', () => {
    expect(formatValue('gamma', 1)).toBe('1.00')
    expect(formatValue('gamma', 2.5)).toBe('2.50')
    expect(formatValue('hue', 50)).toBe('180°')
    for (const key of ['brightness', 'contrast', 'saturation', 'colorTemperature'] as const)
      expect(formatValue(key, 50)).toBe('50%')
  })

  it('rejects invalid input and clamps to current bounds without restricting existing decimal input', () => {
    for (const text of ['', ' ', '-', 'NaN', 'Infinity', '1x'])
      expect(parseControlValue('gamma', text, 0.5, 2.3)).toBeUndefined()
    expect(parseControlValue('gamma', '2.8', 0.5, 2.3)).toBe(2.3)
    expect(parseControlValue('gamma', '0.3', 0.5, 2.3)).toBe(0.5)
    expect(parseControlValue('gamma', '1.13', 0.3, 2.8)).toBe(1.13)
    expect(parseControlValue('brightness', '51.7', 0, 100)).toBe(51.7)
  })

  it('shows temperature by capability or non-neutral intent, independently of adapter vendor', () => {
    const neutral = createNeutralColorSettings()
    const report = {
      capabilities: { colorTemperature: { supported: false, provider: 'unknown' } }
    } as DisplayCapabilityReport
    expect(showColorTemperature(neutral, report)).toBe(false)
    expect(showColorTemperature({ ...neutral, colorTemperature: 63 }, report)).toBe(true)
    expect(showColorTemperature({ ...neutral, colorTemperature: 63 }, undefined)).toBe(true)
    report.capabilities.colorTemperature = { supported: true, provider: 'amd' }
    expect(showColorTemperature(neutral, report)).toBe(true)
  })
})
