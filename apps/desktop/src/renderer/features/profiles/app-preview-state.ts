import type { ColorProfile } from '@chromashift/core'
import type { AppPanelView, ProductState } from '@shared/product-api.js'

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
  return (
    product.preview.state === 'active' ||
    sameId(pendingPreviewId, shownProfile.id) ||
    emptyPreviewMessage(product, shownProfile) !== null
  )
}
