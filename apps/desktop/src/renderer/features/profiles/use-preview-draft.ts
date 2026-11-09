import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clampProfileGamma, type ColorProfile, type DisplayLimits } from '@chromashift/core'
import {
  PreviewSyncSession,
  type PreviewSyncKind,
  type PreviewSyncPort
} from '@/features/profiles/preview-sync.js'
import type { PreviewState, ProductError, ProductState } from '@shared/product-api.js'
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
  gammaLimits?: DisplayLimits
  capabilityReports?: ProductState['capabilityReports']
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
  const brightnessSupport = Object.fromEntries(
    Object.entries(options.capabilityReports ?? {}).map(([id, report]) => [
      id.toLowerCase(),
      report.capabilities.brightness.supported
    ])
  )
  const [localDraft, setDraft] = useState<ColorProfile | null>(options.initialDraft ?? null)
  // A native acceptance can narrow gamma while local edits are still buffered.
  // Derive only gamma from the limits; metadata and every other draft field stay local.
  const draft =
    localDraft === null || options.gammaLimits === undefined
      ? localDraft
      : clampProfileGamma(localDraft, options.gammaLimits, brightnessSupport)
  const [markedDirty, setDirty] = useState<boolean>(options.initialDirty ?? false)
  // Hydration can be dirty without representing a new local edit. Only user
  // changes schedule writes; main's session broadcasts must not echo them back.
  const [localRevision, setLocalRevision] = useState(0)
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
      getPanelLifetime: () => window.chromaShift.getPanelLifetime(),
      startPreview: (profile, sessionKind, lifetime) =>
        window.chromaShift.startPreview(profile, sessionKind, lifetime),
      updatePreview: (profileId, targets, draft, lifetime) =>
        window.chromaShift.updatePreview(profileId, targets, draft, lifetime),
      cancelPreview: (lifetime) => window.chromaShift.cancelPreview(lifetime)
    }
    syncRef.current = new PreviewSyncSession(port, kind, onError)
  }
  const sync = syncRef.current

  useEffect(() => {
    if (options.gammaLimits === undefined) return
    setDraft((current) =>
      current === null ? null : clampProfileGamma(current, options.gammaLimits!, brightnessSupport)
    )
  }, [JSON.stringify(options.gammaLimits), JSON.stringify(brightnessSupport)])

  useLayoutEffect(() => window.chromaShift.onPanelClosing(() => sync.invalidate()), [sync])

  useEffect(() => {
    if (localRevision === 0) return
    if (!enabled || draft === null || (kind === 'override' && draft.displays.length === 0)) return
    if (!dirty && !hasUnsavedSession(session)) return
    sync.schedule(draft, session)
    return () => sync.cancelScheduled()
  }, [enabled, localRevision])

  useLayoutEffect(() => {
    return window.chromaShift.onFlushPreviewDraft(async () => {
      if (localRevision !== 0 && enabled && draft !== null && (dirty || hasUnsavedSession(session)))
        await sync.flush(draft, session)
    })
  })

  return {
    draft,
    dirty,
    updateDraft: (profile) => {
      setDraft(profile)
      setDirty(true)
      setLocalRevision((revision) => revision + 1)
    },
    replaceDraft: (profile) => {
      setDraft(profile)
    },
    resetTo: (source, resetOptions) => {
      setDraft(source === null ? null : structuredClone(source))
      setDirty(resetOptions?.dirty ?? false)
      setLocalRevision(0)
    },
    invalidateSync: () => sync.invalidate(),
    settlePreview: () => sync.settle(),
    rollbackPreview: (throwOnError) => sync.rollback(throwOnError)
  }
}
