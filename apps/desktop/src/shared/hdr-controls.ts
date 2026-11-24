import type { ColorSettingName } from '@chromashift/core'
import type { DisplayCapabilityReport } from '@chromashift/native-client/protocol'

type Capability = DisplayCapabilityReport['capabilities'][ColorSettingName]

/**
 * GPU providers whose controls still apply while HDR is on: NVIDIA saturation
 * and hue (#89) and AMD ADLX custom color (#122).
 */
const hdrProviders: ReadonlySet<Capability['provider']> = new Set(['nvidia', 'amd'])

/**
 * Whether a control applies while HDR is on. Gamma and the other Windows ramp
 * controls stay SDR-only, even if a stale report lists them. A control whose
 * endpoints disagree on provider reports 'unknown' and is withheld too.
 */
export function appliesUnderHdr(
  name: ColorSettingName,
  capability: Capability | undefined
): boolean {
  return name !== 'gamma' && capability?.supported === true && hdrProviders.has(capability.provider)
}
