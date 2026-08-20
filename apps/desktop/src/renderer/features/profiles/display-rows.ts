import { findDisplayTarget, type ColorProfile, type ProfileDisplayTarget } from '@chromashift/core'
import type { Display } from '@chromashift/native-client/protocol'

export interface DisplayRow {
  displayId: string
  display: Display
  target: ProfileDisplayTarget | undefined
}

/**
 * The editor is an active-topology view. Saved targets for absent displays stay
 * in profile persistence and reappear only when the same stable ID reconnects.
 */
export function buildDisplayRows(
  profile: ColorProfile,
  product: { displays: Display[] }
): DisplayRow[] {
  return product.displays.map((display) => ({
    displayId: display.id,
    display,
    target: findDisplayTarget(profile, display.id) ?? undefined
  }))
}
