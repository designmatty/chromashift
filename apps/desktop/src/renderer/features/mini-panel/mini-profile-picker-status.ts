import type { ProductState } from '@shared/product-api'

interface MiniProfilePickerStatus {
  using?: string
  liveProfileId?: string
}

export function miniProfilePickerStatus(
  product: Pick<ProductState, 'configuration' | 'chromaShift' | 'activation'>
): MiniProfilePickerStatus {
  const { status, intendedMode } = product.chromaShift
  const automatic = intendedMode.kind === 'automatic'
  if (status === 'safetyBlocked') return {}
  if (status === 'paused') return automatic ? { using: 'Original settings' } : {}

  const target = product.activation.currentTarget
  if (target === null) return {}
  if (target.kind === 'baseline') return automatic ? { using: 'Original settings' } : {}

  const profile = product.configuration.profiles.find(
    (profile) => profile.id.toLowerCase() === target.profileId.toLowerCase()
  )
  if (profile === undefined) return {}
  return {
    using: automatic ? profile.name : undefined,
    liveProfileId: profile.enabled ? profile.id : undefined
  }
}
