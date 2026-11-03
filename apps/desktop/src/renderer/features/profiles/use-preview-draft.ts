import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ColorProfile } from '@chromashift/core'
import {
  PreviewSyncSession,
  type PreviewSyncKind,
  type PreviewSyncPort
} from '@/features/profiles/preview-sync.js'
import type { PreviewState, ProductError } from '@shared/product-api.js'
import { hasUnsavedSession, profilesDiffer } from '@shared/unsaved-changes.js'

export interface UsePreviewDraftOptions {
  kind: PreviewSyncKind
  session: PreviewState
  /**
   * Surface-specific gate for synchronizing unsaved changes, e.g. Active display
   * control and no navigation in progress. Overrides require a display target;
   * edits may start without targets for metadata-only changes.
   */
  enabled: boolean
  onError: (error: ProductError | null) => void
  initialDraft?: () => ColorProfile | null
  initialDirty?: () => boolean
  /** Saved content for the app editor, including metadata-only changes. */
  savedProfile?: ColorProfile | null
}

export interface PreviewDraft {
  draft: ColorProfile | null
  dirty: boolean
  /** Replace the draft with a user change and mark it dirty. */
  updateDraft(profile: ColorProfile): void
  /** Replace the draft without touching dirtiness, e.g. after save or duplicate. */
  replaceDraft(profile: ColorProfile | null): void
  /** Re-clone the draft from a saved source and reset dirtiness. */
  resetTo(source: ColorProfile | null, options?: { dirty?: boolean }): void
  /** Drop any scheduled-but-unsent synchronization. */
  invalidateSync(): void
  settlePreview(): Promise<void>
  /**
   * Invalidate, wait for every in-flight synchronization, then cancel the
   * native session. Resolves only once the session is safely rolled back.
   */
  rollbackPreview(throwOnError?: boolean): Promise<boolean>
}

export function usePreviewDraft(options: UsePreviewDraftOptions): PreviewDraft {
  const { kind, session, enabled, onError } = options
  const [draft, setDraft] = useState<ColorProfile | null>(options.initialDraft ?? null)
  const [markedDirty, setDirty] = useState<boolean>(options.initialDirty ?? false)
  const dirty =
    options.savedProfile === undefined
      ? markedDirty
      : markedDirty &&
        draft !== null &&
        options.savedProfile !== null &&
        profilesDiffer(draft, options.savedProfile)
  const syncRef = useRef<PreviewSyncSession | null>(null)
  if (syncRef.current === null) {
    const port: PreviewSyncPort = {
      startPreview: (profile, sessionKind) => window.chromaShift.startPreview(profile, sessionKind),
      updatePreview: (profileId, targets, draft) =>
        window.chromaShift.updatePreview(profileId, targets, draft),
      cancelPreview: () => window.chromaShift.cancelPreview()
    }
    syncRef.current = new PreviewSyncSession(port, kind, onError)
  }
  const sync = syncRef.current

  const draftSignature = JSON.stringify(draft)
  const sessionKind = session.state === 'active' ? session.kind : null
  const sessionProfileId = session.state === 'active' ? session.profileId : null
  const sessionUnsaved = hasUnsavedSession(session)
  useEffect(() => {
    if (!enabled || draft === null || (kind === 'override' && draft.displays.length === 0)) return
    if (!dirty && !sessionUnsaved) return
    sync.schedule(draft, session)
    return () => sync.cancelScheduled()
  }, [enabled, dirty, draftSignature, sessionKind, sessionProfileId, sessionUnsaved])

  useLayoutEffect(() => {
    return window.chromaShift.onFlushPreviewDraft(async () => {
      if (enabled && draft !== null && (dirty || hasUnsavedSession(session)))
        await sync.flush(draft, session)
    })
  })

  return {
    draft,
    dirty,
    updateDraft: (profile) => {
      setDraft(profile)
      setDirty(true)
    },
    replaceDraft: (profile) => {
      setDraft(profile)
    },
    resetTo: (source, resetOptions) => {
      setDraft(source === null ? null : structuredClone(source))
      setDirty(resetOptions?.dirty ?? false)
    },
    invalidateSync: () => sync.invalidate(),
    settlePreview: () => sync.settle(),
    rollbackPreview: (throwOnError) => sync.rollback(throwOnError)
  }
}
