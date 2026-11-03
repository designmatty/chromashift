import type { ColorProfile } from '@chromashift/core'
import type { ProductState, PreviewState } from '@shared/product-api.js'

/** An edit or temporary override whose applied draft differs from the saved profile. */
export function hasUnsavedSession(preview: PreviewState): boolean {
  return preview.state === 'active' && preview.unsavedChanges
}

/** Automatic switching is held only while display control is Active. */
export function autoSwitchingOnHold(
  product: Pick<ProductState, 'preview' | 'chromaShift'>
): boolean {
  return product.chromaShift.status === 'active' && hasUnsavedSession(product.preview)
}

/** Compares saved profile content, ignoring cached application icons and key order. */
export function profilesDiffer(left: ColorProfile, right: ColorProfile): boolean {
  return canonical(withoutIcons(left)) !== canonical(withoutIcons(right))
}

function withoutIcons(profile: ColorProfile): ColorProfile {
  return {
    ...profile,
    applications: profile.applications.map((application) => {
      const saved = { ...application }
      delete saved.iconDataUrl
      return saved
    })
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        )
      : item
  )
}
