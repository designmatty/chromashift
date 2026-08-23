import type { ColorProfile, ProfileDisplayTarget, ProfileRepository } from '@chromashift/core'
import type { Display } from '@chromashift/native-client'

export interface PhysicalDisplayProfileRewriteResult {
  rewrittenProfiles: number
  remappedTargets: number
  discardedConflicts: number
}

function sameTarget(left: ProfileDisplayTarget, right: ProfileDisplayTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function rewriteProfile(
  profile: ColorProfile,
  endpointToPhysical: ReadonlyMap<string, string>
): { profile: ColorProfile; remappedTargets: number; discardedConflicts: number } {
  const targets = new Map<string, ProfileDisplayTarget>()
  let remappedTargets = 0
  let discardedConflicts = 0

  for (const target of profile.displays) {
    const physicalId = endpointToPhysical.get(target.displayId.toLowerCase()) ?? target.displayId
    if (physicalId.toLowerCase() !== target.displayId.toLowerCase()) remappedTargets += 1
    const rewritten = { ...target, displayId: physicalId }
    const key = physicalId.toLowerCase()
    const existing = targets.get(key)
    if (existing === undefined) {
      targets.set(key, rewritten)
      continue
    }
    if (!sameTarget(existing, rewritten)) discardedConflicts += 1
    // A target already written with the physical ID is newer than an endpoint
    // target left by the connector-specific model, so it wins a collision.
    if (target.displayId.toLowerCase() === key) targets.set(key, rewritten)
  }

  return {
    profile: { ...profile, displays: [...targets.values()] },
    remappedTargets,
    discardedConflicts
  }
}

export async function rewriteProfilesForPhysicalDisplays(
  repository: ProfileRepository,
  displays: readonly Display[]
): Promise<PhysicalDisplayProfileRewriteResult> {
  const endpointToPhysical = new Map<string, string>()
  for (const display of displays) {
    endpointToPhysical.set(display.id.toLowerCase(), display.id)
    for (const endpointId of display.endpointIds ?? []) {
      endpointToPhysical.set(endpointId.toLowerCase(), display.id)
    }
  }

  let rewrittenProfiles = 0
  let remappedTargets = 0
  let discardedConflicts = 0
  for (const profile of await repository.list()) {
    const rewrite = rewriteProfile(profile, endpointToPhysical)
    remappedTargets += rewrite.remappedTargets
    discardedConflicts += rewrite.discardedConflicts
    if (sameTargetList(profile.displays, rewrite.profile.displays)) continue
    await repository.save(rewrite.profile)
    rewrittenProfiles += 1
  }
  return { rewrittenProfiles, remappedTargets, discardedConflicts }
}

function sameTargetList(
  left: readonly ProfileDisplayTarget[],
  right: readonly ProfileDisplayTarget[]
): boolean {
  return (
    left.length === right.length && left.every((target, index) => sameTarget(target, right[index]!))
  )
}
