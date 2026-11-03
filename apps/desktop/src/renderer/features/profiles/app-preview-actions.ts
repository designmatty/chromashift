import { activeColorTargets, type ColorProfile } from '@chromashift/core'
import type { ChromaShiftApi, ProductResult } from '@shared/product-api.js'

async function value<T>(request: Promise<ProductResult<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw result.error
  return result.value
}

/** Commit the latest draft after invalidating scheduled work and settling writes. */
export async function commitAppPreview(
  draft: ColorProfile,
  settlePreview: () => Promise<void>,
  api: Pick<ChromaShiftApi, 'getState' | 'startPreview' | 'updatePreview' | 'confirmPreview'>
): Promise<ColorProfile> {
  await settlePreview()
  const state = await value(api.getState())
  if (
    state.preview.state === 'active' &&
    state.preview.kind !== 'edit' &&
    state.preview.profileId === draft.id
  ) {
    await value(api.startPreview({ ...draft, displays: state.preview.targets }, 'edit'))
  } else if (
    state.preview.state !== 'active' ||
    state.preview.kind !== 'edit' ||
    state.preview.profileId !== draft.id
  ) {
    await value(api.startPreview(draft, 'edit'))
  }
  await value(api.updatePreview(draft.id, activeColorTargets(draft), draft))
  return value(api.confirmPreview(draft, 'preserve'))
}

export async function deleteAppProfile(
  profileId: string,
  rollback: () => Promise<void>,
  api: Pick<ChromaShiftApi, 'getState' | 'deleteProfile'>
): Promise<void> {
  const state = await value(api.getState())
  if (
    state.preview.state === 'active' &&
    state.preview.profileId.toLowerCase() === profileId.toLowerCase()
  )
    await rollback()
  await value(api.deleteProfile(profileId))
}
