import type { CompleteColorSettings } from '@chromashift/core'
import type { DisplayCapabilityReport } from '@chromashift/native-client/protocol'

export type ColorControlKey = keyof CompleteColorSettings

export function hueToDegrees(value: number): number {
  return Math.round(value * 3.59)
}

export function degreesToHue(value: number): number {
  return Math.round(Math.min(359, Math.max(0, value)) / 3.59)
}

export function formatValue(key: ColorControlKey, value: number): string {
  if (key === 'gamma') return value.toFixed(2)
  if (key === 'hue') return `${hueToDegrees(value)}°`
  return `${Math.round(value)}%`
}

export function showColorTemperature(
  color: CompleteColorSettings,
  report: DisplayCapabilityReport | undefined
): boolean {
  return report?.capabilities.colorTemperature.supported === true || color.colorTemperature !== 50
}

export function parseControlValue(
  key: ColorControlKey,
  text: string,
  min: number,
  max: number
): number | undefined {
  if (text.trim() === '') return undefined
  const value = Number(text)
  if (!Number.isFinite(value)) return undefined
  const stored = key === 'hue' ? degreesToHue(value) : value
  return Math.min(max, Math.max(min, stored))
}
