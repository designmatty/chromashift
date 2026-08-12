import { setDisplayTarget, type ColorProfile, type ColorSettings } from '@chromashift/core'

export interface AppliedTarget {
  displayId: string
  color: ColorSettings
}

/**
 * Overlays a temporary override session's applied settings onto a saved profile,
 * producing the complete draft the user is actually looking at. Targets the
 * session left untouched fall back to baseline, matching what the displays show.
 */
export function applyOverrideTargets(
  profile: ColorProfile,
  targets: readonly AppliedTarget[]
): ColorProfile {
  const applied = new Map(targets.map((target) => [target.displayId.toLowerCase(), target.color]))
  const merged: ColorProfile = {
    ...profile,
    displays: profile.displays.map((target) => ({
      ...target,
      color: applied.get(target.displayId.toLowerCase()) ?? {}
    }))
  }

  return targets.reduce((current, target) => {
    const known = current.displays.some(
      (existing) => existing.displayId.toLowerCase() === target.displayId.toLowerCase()
    )
    return known
      ? current
      : setDisplayTarget(current, { displayId: target.displayId, color: { ...target.color } })
  }, merged)
}
