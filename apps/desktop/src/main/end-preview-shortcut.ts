import type { PreviewState } from '@shared/product-api.js'
import { hasUnsavedSession } from '@shared/unsaved-changes.js'

/** Dispatch to the app's existing End preview action after flushing buffered edits. */
export async function requestEndPreview(ports: {
  preview(): PreviewState
  flushDrafts(): Promise<void>
  dispatch(profileId: string, needsPrompt: boolean): void
}): Promise<void> {
  const before = ports.preview()
  if (before.state !== 'active' || before.kind === 'override') return
  await ports.flushDrafts()
  const preview = ports.preview()
  // A close or another selection may have ended/replaced the session during flush.
  if (
    preview.state !== 'active' ||
    preview.kind === 'override' ||
    preview.profileId !== before.profileId
  )
    return
  ports.dispatch(preview.profileId, hasUnsavedSession(preview))
}
