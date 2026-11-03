import type { ColorProfile } from '@chromashift/core'
import type { ProductState, PreviewState } from '@shared/product-api.js'

export function hasUnsavedSession(preview: PreviewState): boolean {
  return preview.state === 'active' && (preview.unsavedChanges ?? preview.kind !== 'preview')
}

export function profilesDiffer(left: ColorProfile, right: ColorProfile): boolean {
  const content = (profile: ColorProfile) => ({
    ...profile,
    applications: profile.applications.map((application) => ({
      ...application,
      iconDataUrl: undefined
    }))
  })
  return JSON.stringify(content(left)) !== JSON.stringify(content(right))
}

export function autoSwitchingOnHold(
  product: Pick<ProductState, 'preview' | 'chromaShift'>
): boolean {
  return product.chromaShift.status === 'active' && hasUnsavedSession(product.preview)
}
