import type { ColorProfile } from '@chromashift/core'
import type { PreviewState } from '@shared/product-api.js'
import { hasUnsavedSession } from '@shared/unsaved-changes.js'

export type UnsavedQuitDecision = 'update' | 'discard' | 'cancel'

/** Runs before restore-safe shutdown; Discard uses the normal shutdown restore. */
export async function prepareUnsavedQuit(port: {
  settle(): Promise<void>
  state(): PreviewState
  decide(profileName: string): Promise<UnsavedQuitDecision>
  confirm(profile: ColorProfile): Promise<unknown>
}): Promise<boolean> {
  await port.settle()
  const preview = port.state()
  if (!hasUnsavedSession(preview) || preview.state !== 'active') return true
  if (preview.draft === undefined) throw new Error('The unsaved profile draft is unavailable.')
  const decision = await port.decide(preview.draft.name)
  if (decision === 'cancel') return false
  await port.settle()
  const latest = port.state()
  if (!hasUnsavedSession(latest) || latest.state !== 'active') return true
  if (latest.profileId !== preview.profileId) return false
  if (decision === 'update') {
    if (latest.draft === undefined) throw new Error('The unsaved profile draft is unavailable.')
    await port.confirm(latest.draft)
  }
  return true
}
