import type { ColorProfile } from '@chromashift/core'
import type { AppPanelView, ProductState } from '@shared/product-api.js'
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
    liveProfile(product)?.id.toLowerCase() !== profile.id.toLowerCase()
  )
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  return (
    typeof left === 'string' &&
    typeof right === 'string' &&
    left.toLowerCase() === right.toLowerCase()
  )
}

/**
 * A click on the profile the Profiles view already shows changes nothing,
 * whether that profile is live or previewed and with or without a session.
 */
export function isProfileClickNoop(
  view: AppPanelView,
  clickedProfileId: string,
  shownProfileId: string | null
): boolean {
  return view === 'profiles' && sameId(clickedProfileId, shownProfileId)
}

/**
 * Switching from a Preview or Edit session to another profile that will start
 * its own native Preview rolls the first session back before starting the
 * next. The banner stays mounted for the destination during that gap.
 */
export function keepsPreviewBannerWhileSwitching(
  before: AppPreviewState & Pick<ProductState, 'preview'>,
  destination: ColorProfile
): boolean {
  return (
    before.preview.state === 'active' &&
    before.preview.kind !== 'override' &&
    !sameId(before.preview.profileId, destination.id) &&
    shouldPreviewProfile(before, destination)
  )
}

export function previewBannerVisible(
  product: AppPreviewState & Pick<ProductState, 'preview'>,
  shownProfile: ColorProfile | null,
  pendingPreviewId: string | null
): boolean {
  if (product.chromaShift.status !== 'active' || shownProfile === null) return false
  if (product.preview.state === 'active' && product.preview.kind === 'override') return false
  if (sameId(liveProfile(product)?.id, shownProfile.id)) return false
  return product.preview.state === 'active' || sameId(pendingPreviewId, shownProfile.id)
}

type SessionState = AppPreviewState & Pick<ProductState, 'preview'>

/**
 * Update profile on the live profile commits and ends the session as before.
 * On any other profile it saves while the session keeps previewing it.
 */
export function updatePlan(product: SessionState, profileId: string): 'commit' | 'saveInSession' {
  return sameId(liveProfile(product)?.id, profileId) ? 'commit' : 'saveInSession'
}

/**
 * Discard changes stays on a non-live profile, showing its saved values as if
 * it had just been clicked. Missing targets restore Original settings in place,
 * including targets added only in the draft.
 */
export function discardPlan(
  product: SessionState,
  saved: ColorProfile | undefined
): 'returnToLive' | 'revertSession' | 'restartPreview' {
  if (saved === undefined || sameId(liveProfile(product)?.id, saved.id)) return 'returnToLive'
  const session = product.preview
  if (
    product.chromaShift.status === 'active' &&
    session.state === 'active' &&
    session.kind !== 'override' &&
    sameId(session.profileId, saved.id)
  )
    return 'revertSession'
  return 'restartPreview'
}
