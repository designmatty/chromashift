import { colorSettingNames, type ColorSettingName } from '@chromashift/core'
import type { DisplayCapabilities, DisplaySettings } from '@chromashift/native-client'

/** Windows gamma-ramp controls. They stay SDR-only while HDR is on (#89). */
export const sdrOnlySettingNames: ReadonlySet<ColorSettingName> = new Set([
  'brightness',
  'contrast',
  'gamma'
])

/**
 * The native request for one display: only the settings its capabilities
 * support. While HDR is on, brightness, contrast and gamma are withheld even if
 * a stale report lists them; they apply again when HDR turns off. The saved
 * profile target keeps every value.
 */
export function projectDisplaySettings(
  settings: DisplaySettings,
  capabilities: DisplayCapabilities,
  hdr: boolean
): DisplaySettings {
  const projected: DisplaySettings = {}
  for (const name of colorSettingNames) {
    const value = settings[name]
    if (value === undefined || !capabilities[name].supported) continue
    if (hdr && sdrOnlySettingNames.has(name)) continue
    projected[name] = value
  }
  return projected
}

export function hasDisplaySettings(settings: DisplaySettings | undefined): boolean {
  return settings !== undefined && Object.keys(settings).length > 0
}

/** The target settings a projection left out, for diagnostics. */
export function withheldSettingNames(
  settings: DisplaySettings,
  projected: DisplaySettings
): ColorSettingName[] {
  return colorSettingNames.filter(
    (name) => settings[name] !== undefined && projected[name] === undefined
  )
}
