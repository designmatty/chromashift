import type { EndPreviewRequest, PreviewState } from '@shared/product-api.js'
import { hasUnsavedSession } from '@shared/unsaved-changes.js'

/** Dispatch to the app's existing End preview action after flushing buffered edits. */
export async function requestEndPreview(ports: {
  preview(): PreviewState
  panelLifetime(): number | null
  flushDrafts(): Promise<void>
  dispatch(request: EndPreviewRequest, needsPrompt: boolean): void
}): Promise<void> {
  const before = ports.preview()
  const lifetime = ports.panelLifetime()
  if (before.state !== 'active' || before.kind === 'override' || lifetime === null) return
  await ports.flushDrafts()
  const preview = ports.preview()
  // A close or another selection may have ended/replaced the session during flush.
  if (
    preview.state !== 'active' ||
    preview.kind === 'override' ||
    preview.sessionId !== before.sessionId ||
    ports.panelLifetime() !== lifetime ||
    preview.profileId !== before.profileId
  )
    return
  ports.dispatch(
    { lifetime, sessionId: before.sessionId, profileId: before.profileId },
    hasUnsavedSession(preview)
  )
}
