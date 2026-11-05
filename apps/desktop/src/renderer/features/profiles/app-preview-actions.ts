import { activeColorTargets, type ColorProfile } from '@chromashift/core'
import type { ChromaShiftApi, ProductResult } from '@shared/product-api.js'

async function value<T>(request: Promise<ProductResult<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw result.error
  return result.value
}

/** Apply the latest draft to its Edit session after settling scheduled writes. */
async function applyDraftToEditSession(
  draft: ColorProfile,
  settlePreview: () => Promise<void>,
  api: Pick<ChromaShiftApi, 'getState' | 'startPreview' | 'updatePreview'>
): Promise<void> {
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
}

/**
 * Commit the latest draft and end its session. Ending restores every touched
 * display and re-applies the live target, so this is for the live profile and
 * for continuing to another destination.
 */
export async function commitAppPreview(
  draft: ColorProfile,
  settlePreview: () => Promise<void>,
  api: Pick<ChromaShiftApi, 'getState' | 'startPreview' | 'updatePreview' | 'confirmPreview'>
): Promise<ColorProfile> {
  await applyDraftToEditSession(draft, settlePreview, api)
  return value(api.confirmPreview(draft, 'preserve'))
}

/**
 * Save a non-live profile's draft and keep its session showing the saved
 * values. Saving while a session is active makes no display writes, so the
 * displays keep exactly what the draft already applied.
 */
export async function saveAppPreview(
  draft: ColorProfile,
  settlePreview: () => Promise<void>,
  api: Pick<ChromaShiftApi, 'getState' | 'startPreview' | 'updatePreview' | 'saveProfile'>
): Promise<ColorProfile> {
  await applyDraftToEditSession(draft, settlePreview, api)
  return value(api.saveProfile(draft))
}

/**
 * Discard by reverting the existing session to the saved targets after
 * settling scheduled writes, without returning the displays to the live target.
 */
export async function revertAppPreview(
  saved: ColorProfile,
  settlePreview: () => Promise<void>,
  api: Pick<ChromaShiftApi, 'updatePreview'>
): Promise<void> {
  await settlePreview()
  await value(api.updatePreview(saved.id, activeColorTargets(saved), saved))
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
