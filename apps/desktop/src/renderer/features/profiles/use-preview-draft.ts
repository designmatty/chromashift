import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clampProfileGamma, type ColorProfile, type DisplayLimits } from '@chromashift/core'
import {
  PreviewSyncSession,
  type PreviewSyncKind,
  type PreviewSyncPort
} from '@/features/profiles/preview-sync.js'
import type { PreviewState, ProductError, ProductState } from '@shared/product-api.js'
import { hasUnsavedSession, profilesDiffer, profileColorsDiffer } from '@shared/unsaved-changes.js'
import {
  HoldToCompare,
  listenForCompareRelease,
  type CompareInput
} from '@/features/profiles/hold-to-compare.js'

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
  /** Unsaved colors in either panel, including a carried-in override. */
  canCompare: boolean
  /** True from press until the draft write after release has drained. */
  comparing: boolean
  pressCompare(input: CompareInput): void
  releaseCompare(input?: CompareInput): Promise<void>
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
  const [comparing, setComparing] = useState(false)
  const compareRef = useRef<HoldToCompare | null>(null)
  if (compareRef.current === null) compareRef.current = new HoldToCompare(setComparing)
  const compare = compareRef.current
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
      cancelPreview: (lifetime) => window.chromaShift.cancelPreview(lifetime),
      setPreviewCompare: (profileId, showing, sessionId, lifetime) =>
        window.chromaShift.setPreviewCompare(profileId, showing, sessionId, lifetime)
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

  useLayoutEffect(
    () =>
      window.chromaShift.onPanelClosing(() => {
        // Main has revoked this opening and owns the exact prior-target rollback.
        sync.invalidate()
        void compare.release()
      }),
    [sync, compare]
  )

  useEffect(() => {
    return listenForCompareRelease(window, (input) => compare.release(input))
  }, [kind, compare])

  const canCompare =
    dirty &&
    draft !== null &&
    options.savedProfile !== undefined &&
    options.savedProfile !== null &&
    profileColorsDiffer(draft, options.savedProfile) &&
    ((session.state === 'active' && session.kind !== 'preview' && session.profileId === draft.id) ||
      localRevision !== 0)
  useLayoutEffect(() => {
    // Busy work, navigation, Paused or a reverted draft end the comparison.
    if (!enabled || !canCompare) void compare.release()
  }, [enabled, canCompare, compare])

  const sessionId = session.state === 'active' ? session.sessionId : null
  const previousSession = useRef(sessionId)
  const previousMainCompare = useRef(false)
  useLayoutEffect(() => {
    if (
      ((previousSession.current !== null && previousSession.current !== sessionId) ||
        (previousMainCompare.current &&
          session.state === 'active' &&
          session.comparing === false)) &&
      compare.showingSaved
    ) {
      // An external shortcut ended/replaced this session. Do not send the old
      // draft into a newer session for the same profile.
      sync.invalidate()
      void compare.release()
    }
    previousSession.current = sessionId
    previousMainCompare.current = session.state === 'active' && session.comparing === true
  }, [sessionId, session.state === 'active' && session.comparing, compare, sync])
  useLayoutEffect(() => {
    return () => {
      void compare.release()
    }
  }, [draft?.id, compare])

  useEffect(() => {
    if (localRevision === 0) return
    if (!enabled || draft === null || (kind === 'override' && draft.displays.length === 0)) return
    if (!dirty && !hasUnsavedSession(session)) return
    sync.schedule(draft, session)
    return () => sync.cancelScheduled()
  }, [enabled, localRevision])

  useLayoutEffect(() => {
    return window.chromaShift.onFlushPreviewDraft(async () => {
      await compare.release()
      if (localRevision !== 0 && enabled && draft !== null && (dirty || hasUnsavedSession(session)))
        await sync.flush(draft, session)
    })
  })

  return {
    draft,
    dirty,
    canCompare,
    comparing,
    pressCompare: (input) => {
      const saved = options.savedProfile
      if (!enabled || !canCompare || draft === null || !saved) return
      compare.press(input, () =>
        sync.beginComparison(draft, session, () => {
          sync.invalidate()
          void compare.release()
        })
      )
    },
    releaseCompare: (input) => compare.release(input),
    updateDraft: (profile) => {
      if (compare.showingSaved) return
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
    invalidateSync: () => {
      sync.invalidate()
      void compare.release()
    },
    settlePreview: async () => {
      await compare.release()
      await sync.settle()
    },
    rollbackPreview: (throwOnError) => {
      const rollback = sync.rollback(throwOnError)
      void compare.release()
      return rollback
    }
  }
}
