import type { ColorProfile, ColorSettings, ProfileDisplayTarget } from './model.js'

export interface DisplayColorTarget {
  displayId: string
  color: ColorSettings
}

export function sameDisplayId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

export function hasColorOverrides(color: ColorSettings): boolean {
  return Object.keys(color).length > 0
}

export function findDisplayTarget(
  profile: ColorProfile,
  displayId: string
): ProfileDisplayTarget | null {
  return profile.displays.find((target) => sameDisplayId(target.displayId, displayId)) ?? null
}

/**
 * The settings this profile applies to one display. An absent target and an empty
 * target both mean the display keeps its captured baseline.
 */
export function resolveDisplayColor(profile: ColorProfile, displayId: string): ColorSettings {
  return { ...(findDisplayTarget(profile, displayId)?.color ?? {}) }
}

/**
 * Every display this profile actively overrides, in persisted target order.
 * Targets with no settings are excluded because they issue no native write.
 */
export function activeColorTargets(profile: ColorProfile): DisplayColorTarget[] {
  return profile.displays
    .filter((target) => hasColorOverrides(target.color))
    .map((target) => ({ displayId: target.displayId, color: { ...target.color } }))
}

export function setDisplayTarget(
  profile: ColorProfile,
  target: ProfileDisplayTarget
): ColorProfile {
  const existingIndex = profile.displays.findIndex((candidate) =>
    sameDisplayId(candidate.displayId, target.displayId)
  )
  const displays = [...profile.displays]
  if (existingIndex === -1) displays.push(target)
  else displays[existingIndex] = target
  return { ...profile, displays }
}

export function removeDisplayTarget(profile: ColorProfile, displayId: string): ColorProfile {
  return {
    ...profile,
    displays: profile.displays.filter((target) => !sameDisplayId(target.displayId, displayId))
  }
}
