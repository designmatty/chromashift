import { findMatchingProfile, type ForegroundApplication } from '../matching/application-matcher.js'
import type { ProfileConfiguration } from '../profiles/configuration.js'
import type { ColorProfile } from '../profiles/model.js'

export type ActivationMode =
  | { kind: 'automatic' }
  | { kind: 'manual'; profileId: string }

export type ActivationTarget =
  | { kind: 'baseline' }
  | { kind: 'profile'; profileId: string }

export type ActivationReason =
  | 'manualOverride'
  | 'foregroundApplication'
  | 'defaultProfile'
  | 'baseline'

export interface ActivationSelection {
  target: ActivationTarget
  reason: ActivationReason
}

export interface ActivationResolution extends ActivationSelection {
  changed: boolean
  previousTarget: ActivationTarget | null
}

export interface ActivationContext {
  configuration: ProfileConfiguration
  foregroundApplication: ForegroundApplication | null
  mode: ActivationMode
}

export const automaticActivationMode: ActivationMode = { kind: 'automatic' }

export function manualActivationMode(profileId: string): ActivationMode {
  return { kind: 'manual', profileId }
}

function findEnabledProfile(
  profiles: readonly ColorProfile[],
  profileId: string | null
): ColorProfile | null {
  if (profileId === null) return null
  return profiles.find(
    (profile) => profile.enabled && profile.id.toLowerCase() === profileId.toLowerCase()
  ) ?? null
}

export function selectActivation(context: ActivationContext): ActivationSelection {
  const { configuration, foregroundApplication, mode } = context

  if (mode.kind === 'manual') {
    const manualProfile = findEnabledProfile(configuration.profiles, mode.profileId)
    if (manualProfile !== null) {
      return {
        target: { kind: 'profile', profileId: manualProfile.id },
        reason: 'manualOverride'
      }
    }
  }

  const foregroundMatch = findMatchingProfile(configuration.profiles, foregroundApplication)
  if (foregroundMatch !== null) {
    return {
      target: { kind: 'profile', profileId: foregroundMatch.profile.id },
      reason: 'foregroundApplication'
    }
  }

  const defaultProfile = findEnabledProfile(
    configuration.profiles,
    configuration.settings.defaultProfileId
  )
  if (defaultProfile !== null) {
    return {
      target: { kind: 'profile', profileId: defaultProfile.id },
      reason: 'defaultProfile'
    }
  }

  return { target: { kind: 'baseline' }, reason: 'baseline' }
}

function targetsEqual(left: ActivationTarget | null, right: ActivationTarget): boolean {
  if (left === null) return false
  if (left.kind === 'baseline') return right.kind === 'baseline'
  return right.kind === 'profile' && left.profileId === right.profileId
}

export class ActivationResolver {
  private activeTarget: ActivationTarget | null = null

  public get currentTarget(): ActivationTarget | null {
    return this.activeTarget === null ? null : { ...this.activeTarget }
  }

  public resolve(context: ActivationContext): ActivationResolution {
    const selection = selectActivation(context)
    const previousTarget = this.activeTarget
    const changed = !targetsEqual(previousTarget, selection.target)
    this.activeTarget = { ...selection.target }
    return { ...selection, changed, previousTarget }
  }

  public reset(): void {
    this.activeTarget = null
  }
}
