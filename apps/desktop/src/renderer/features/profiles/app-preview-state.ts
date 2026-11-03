import { selectActivation, type ColorProfile } from '@chromashift/core'
import type { ProductState } from '@shared/product-api'
import { hasUnsavedSession } from '@shared/unsaved-changes'
import { applyOverrideTargets } from '@/features/profiles/override-targets'

export function appSessionDraft(product: ProductState): ColorProfile | null {
  const session = product.preview
  if (session.state === 'active' && hasUnsavedSession(session)) {
    const saved = product.configuration.profiles.find((profile) => profile.id === session.profileId)
    if (session.draft !== undefined) return structuredClone(session.draft)
    if (saved !== undefined) return applyOverrideTargets(saved, session.targets)
  }
  return liveProfile(product)
}

export function shouldEndPreviewOnMinimize(
  dirty: boolean,
  preview: ProductState['preview']
): boolean {
  return !dirty && !hasUnsavedSession(preview)
}

type AppPreviewState = Pick<ProductState, 'configuration' | 'chromaShift' | 'foregroundApplication'>

export function liveProfile(product: AppPreviewState): ColorProfile | null {
  const target = product.chromaShift.intendedTarget
  const id = target?.kind === 'profile' ? target.profileId : 'default'
  return (
    product.configuration.profiles.find(
      (profile) => profile.id.toLowerCase() === id.toLowerCase()
    ) ??
    product.configuration.profiles.find((profile) => profile.id === 'default') ??
    null
  )
}

export function shouldPreviewProfile(product: AppPreviewState, profile: ColorProfile): boolean {
  return (
    product.chromaShift.status === 'active' &&
    profile.displays.length > 0 &&
    liveProfile(product)?.id.toLowerCase() !== profile.id.toLowerCase()
  )
}

export function automaticProfileName(product: AppPreviewState): string {
  const { target } = selectActivation({
    configuration: product.configuration,
    foregroundApplication: product.foregroundApplication,
    mode: { kind: 'automatic' }
  })
  return target.kind === 'profile'
    ? (product.configuration.profiles.find(
        (profile) => profile.id.toLowerCase() === target.profileId.toLowerCase()
      )?.name ?? 'Original settings')
    : 'Original settings'
}

export function emptyPreviewMessage(
  product: AppPreviewState,
  profile: ColorProfile
): string | null {
  if (
    product.chromaShift.status !== 'active' ||
    profile.displays.length > 0 ||
    liveProfile(product)?.id.toLowerCase() === profile.id.toLowerCase()
  )
    return null
  const target = product.chromaShift.intendedTarget
  const name =
    target?.kind === 'profile'
      ? product.configuration.profiles.find(
          (item) => item.id.toLowerCase() === target.profileId.toLowerCase()
        )?.name
      : undefined
  return `No display settings saved — your displays keep ${name ?? 'their current settings'} until you change a value.`
}
