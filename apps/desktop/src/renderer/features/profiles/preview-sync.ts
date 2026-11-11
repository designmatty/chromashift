import { activeColorTargets, type ColorProfile } from '@chromashift/core'
import { run } from '@/lib/product-result.js'
import type { PreviewState, ProductError, ProductResult } from '@shared/product-api.js'

export const PREVIEW_SYNC_DEBOUNCE_MS = 120

export type PreviewSyncKind = 'edit' | 'override'

export interface PreviewSyncPort {
  getPanelLifetime?(): number | null
  startPreview(
    profile: ColorProfile,
    kind: PreviewSyncKind,
    lifetime?: number
  ): Promise<ProductResult<null>>
  updatePreview(
    profileId: string,
    targets: ReturnType<typeof activeColorTargets>,
    draft?: ColorProfile,
    lifetime?: number
  ): Promise<ProductResult<null>>
  cancelPreview(lifetime?: number): Promise<ProductResult<null>>
}

/**
 * Debounced draft-to-session synchronization shared by the app panel's Edit
 * mode and the mini panel's temporary overrides. A schedule only sends after
 * the debounce window, joins the existing session of the same kind and profile
 * through updatePreview, and otherwise starts a new session. Rollback
 * invalidates anything scheduled, waits for every in-flight send, and only
 * then cancels, so a late debounced write can never land after its session
 * was rolled back.
 */
export class PreviewSyncSession {
  #generation = 0
  readonly #pending = new Set<Promise<unknown>>()
  #timer: ReturnType<typeof setTimeout> | undefined
  #scheduledSend: (() => void) | undefined
  #rollback: Promise<boolean> | undefined
  #needsStart = false
  #promotedProfileId: string | null = null

  public constructor(
    private readonly port: PreviewSyncPort,
    private readonly kind: PreviewSyncKind,
    private readonly onError: (error: ProductError | null) => void,
    private readonly debounceMs = PREVIEW_SYNC_DEBOUNCE_MS
  ) {}

  public schedule(draft: ColorProfile, session: PreviewState): void {
    this.cancelScheduled()
    const generation = this.#generation
    // Capture admission when the user edits, before the debounce can outlive
    // this panel opening. Main checks it again when the request arrives.
    const lifetime = this.port.getPanelLifetime?.()
    if (lifetime === null) return
    const scope: [] | [number] = lifetime === undefined ? [] : [lifetime]
    this.#scheduledSend = () => {
      this.#timer = undefined
      this.#scheduledSend = undefined
      if (generation !== this.#generation) return
      const rollback = this.#rollback
      const previousSends = [...this.#pending]
      const pending = (async () => {
        // A new slider change can arrive before rollback's inactive state has
        // reached the renderer. Wait for cancellation and start a fresh session.
        if (rollback !== undefined && !(await rollback)) return
        if (previousSends.length > 0) await Promise.allSettled(previousSends)
        if (generation !== this.#generation) return
        if (
          this.kind === 'edit' &&
          session.state === 'active' &&
          session.kind !== 'edit' &&
          session.profileId === draft.id
        ) {
          if (this.#promotedProfileId !== draft.id) {
            const promoted = await run(
              this.port.startPreview({ ...draft, displays: session.targets }, 'edit', ...scope),
              this.onError
            )
            if (promoted === undefined || generation !== this.#generation) return
            this.#promotedProfileId = draft.id
          }
          this.#needsStart = false
          const updated = await run(
            this.port.updatePreview(draft.id, activeColorTargets(draft), draft, ...scope),
            this.onError
          )
          if (updated !== undefined) this.onError(null)
          return
        }
        const joinsCurrentSession =
          !this.#needsStart &&
          session.state === 'active' &&
          session.kind === this.kind &&
          session.profileId === draft.id
        const request = joinsCurrentSession
          ? this.port.updatePreview(draft.id, activeColorTargets(draft), draft, ...scope)
          : this.port.startPreview(draft, this.kind, ...scope)
        const result = await run(request, this.onError)
        if (result !== undefined && generation === this.#generation) {
          this.#needsStart = false
          this.onError(null)
        }
      })()
      this.#pending.add(pending)
      void pending.finally(() => this.#pending.delete(pending))
    }
    this.#timer = setTimeout(this.#scheduledSend, this.debounceMs)
  }

  /** Send the current renderer draft now, then drain writes before main checks quit. */
  public async flush(draft: ColorProfile, session: PreviewState): Promise<void> {
    this.schedule(draft, session)
    const send = this.#scheduledSend
    this.cancelScheduled()
    send?.()
    await Promise.allSettled([...this.#pending])
  }

  /**
   * Hold to compare (#80): send the saved targets now, without the debounce,
   * and return the release that sends the draft targets back. Both writes join
   * #pending behind any draft write, so they stay ordered, and rollback or a
   * panel close invalidates and drains them like any other send. Neither write
   * starts a session: a shortcut or a close may have ended this one.
   */
  public beginComparison(
    saved: ColorProfile,
    draft: ColorProfile,
    session: PreviewState
  ): () => Promise<void> {
    // A rollback owns the session's ending. Comparing into it could land after
    // the cancel, so the press does nothing.
    if (this.#rollback !== undefined) return async () => undefined
    const generation = this.#generation
    const lifetime = this.port.getPanelLifetime?.()
    const joinable =
      !this.#needsStart &&
      session.state === 'active' &&
      session.kind === 'edit' &&
      session.profileId === draft.id
    // Send a debounced edit now, and start or promote the edit session when
    // needed, so the saved targets follow the latest draft in the same queue.
    if (this.#scheduledSend !== undefined || !joinable) void this.flush(draft, session)
    const update = (profile: ColorProfile): Promise<void> => {
      // Main requires the sent draft's displays to equal the targets, so the saved
      // write carries the draft (name, triggers) with the saved display targets.
      const shown: ColorProfile = { ...draft, displays: structuredClone(profile.displays) }
      const previous = [...this.#pending]
      const pending = (async () => {
        await Promise.allSettled(previous)
        if (generation !== this.#generation || lifetime === null) return
        const scope: [] | [number] = lifetime === undefined ? [] : [lifetime]
        // Never start a new session here. A shortcut or close may have ended it.
        const result = await run(
          this.port.updatePreview(draft.id, activeColorTargets(shown), shown, ...scope),
          this.onError
        )
        if (result !== undefined) this.onError(null)
      })()
      this.#pending.add(pending)
      void pending.finally(() => this.#pending.delete(pending))
      return pending
    }
    void update(saved)
    return () => update(draft)
  }

  public cancelScheduled(): void {
    if (this.#timer === undefined) return
    clearTimeout(this.#timer)
    this.#timer = undefined
    this.#scheduledSend = undefined
  }

  public invalidate(): void {
    this.#generation += 1
    this.cancelScheduled()
  }

  public async settle(): Promise<void> {
    this.invalidate()
    await Promise.allSettled([...this.#pending])
  }

  public async rollback(throwOnError = false): Promise<boolean> {
    this.invalidate()
    this.#needsStart = true
    this.#promotedProfileId = null
    const pending = [...this.#pending]
    const previousRollback = this.#rollback
    const lifetime = this.port.getPanelLifetime?.()
    const rollback = (async () => {
      await previousRollback
      await Promise.allSettled(pending)
      if (lifetime === null) return true
      let failure: ProductError | null = null
      const result = await run(
        lifetime === undefined ? this.port.cancelPreview() : this.port.cancelPreview(lifetime),
        (error) => {
          failure = error
          this.onError(error)
        }
      )
      if (failure !== null && throwOnError) throw failure
      if (result !== undefined) this.onError(null)
      return result !== undefined
    })()
    this.#rollback = rollback
    try {
      return await rollback
    } finally {
      if (this.#rollback === rollback) this.#rollback = undefined
    }
  }
}
