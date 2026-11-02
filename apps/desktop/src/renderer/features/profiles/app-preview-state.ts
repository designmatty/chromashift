import { selectActivation, type ColorProfile } from '@chromashift/core'
import type { ProductState } from '@shared/product-api'

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
