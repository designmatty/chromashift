import { useEffect, useRef, useState } from 'react'
import type { ColorProfile } from '@chromashift/core'
import { PreviewSyncSession, type PreviewSyncKind, type PreviewSyncPort } from './preview-sync.js'
import type { PreviewState, ProductError } from '../../../shared/product-api.js'

export interface UsePreviewDraftOptions {
  kind: PreviewSyncKind
  session: PreviewState
  /**
   * Surface-specific gate for draft-to-session synchronization, e.g. Edit mode
   * being active or display control not being paused. The hook additionally
   * requires a draft with at least one display target, and an override session
   * only syncs while the draft is dirty: overrides exist exactly while applied
   * values diverge from the saved profile, while an edit session covers the
   * whole edit.
   */
  enabled: boolean
  onError: (error: ProductError | null) => void
  initialDraft?: () => ColorProfile | null
  initialDirty?: () => boolean
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
  /**
   * Invalidate, wait for every in-flight synchronization, then cancel the
   * native session. Resolves only once the session is safely rolled back.
   */
  rollbackPreview(): Promise<void>
}

export function usePreviewDraft(options: UsePreviewDraftOptions): PreviewDraft {
  const { kind, session, enabled, onError } = options
  const [draft, setDraft] = useState<ColorProfile | null>(options.initialDraft ?? null)
  const [dirty, setDirty] = useState<boolean>(options.initialDirty ?? false)
  const syncRef = useRef<PreviewSyncSession | null>(null)
  if (syncRef.current === null) {
    const port: PreviewSyncPort = {
      startPreview: (profile, sessionKind) => window.chromaShift.startPreview(profile, sessionKind),
      updatePreview: (profileId, targets) => window.chromaShift.updatePreview(profileId, targets),
      cancelPreview: () => window.chromaShift.cancelPreview()
    }
    syncRef.current = new PreviewSyncSession(port, kind, onError)
  }
  const sync = syncRef.current

  const draftSignature = JSON.stringify(draft)
  const sessionKind = session.state === 'active' ? session.kind : null
  const sessionProfileId = session.state === 'active' ? session.profileId : null
  useEffect(() => {
    if (!enabled || draft === null || draft.displays.length === 0) return
    if (kind === 'override' && !dirty) return
    sync.schedule(draft, session)
    return () => sync.cancelScheduled()
  }, [enabled, dirty, draftSignature, sessionKind, sessionProfileId])

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
    rollbackPreview: () => sync.rollback()
  }
}
