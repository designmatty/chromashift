import { colorSettingNames, type ColorSettingName } from '@chromashift/core'
import type { DisplayCapabilities, DisplaySettings } from '@chromashift/native-client'
import { appliesUnderHdr } from '@shared/hdr-controls.js'

/**
 * The native request for one display: only the settings its capabilities
 * support. While HDR is on, only GPU-provider controls apply: NVIDIA saturation
 * and hue, and AMD ADLX color. Windows ramp controls, including gamma, are
 * withheld even if a stale report lists them; they apply again when HDR turns
 * off. The saved profile target keeps every value.
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
    if (hdr && !appliesUnderHdr(name, capabilities[name])) continue
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
