import { selectActivation, type ColorProfile } from '@chromashift/core'
import type { AppPanelView, ProductState } from '@shared/product-api.js'
import { hasUnsavedSession } from '@shared/unsaved-changes.js'
import { applyOverrideTargets } from '@/features/profiles/override-targets.js'

export function appSessionDraft(product: ProductState): ColorProfile | null {
  const session = product.preview
  if (session.state === 'active' && hasUnsavedSession(session)) {
    const saved = product.configuration.profiles.find((profile) => profile.id === session.profileId)
    if (session.draft !== undefined) return structuredClone(session.draft)
    if (saved !== undefined) return applyOverrideTargets(saved, session.targets)
  }
  return liveProfile(product)
}

export function shouldEndPreviewOnMinimize(dirty: boolean): boolean {
  return !dirty
}

export function initialAppView(product: ProductState, remembered: AppPanelView): AppPanelView {
  return hasUnsavedSession(product.preview) ? 'profiles' : remembered
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
