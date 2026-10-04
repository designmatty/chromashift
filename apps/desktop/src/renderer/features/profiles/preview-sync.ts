import { activeColorTargets, type ColorProfile } from '@chromashift/core'
import { run } from '@/lib/product-result.js'
import type { PreviewState, ProductError, ProductResult } from '@shared/product-api.js'

export const PREVIEW_SYNC_DEBOUNCE_MS = 120

export type PreviewSyncKind = 'edit' | 'override'

export interface PreviewSyncPort {
  startPreview(profile: ColorProfile, kind: PreviewSyncKind): Promise<ProductResult<null>>
  updatePreview(
    profileId: string,
    targets: ReturnType<typeof activeColorTargets>
  ): Promise<ProductResult<null>>
  cancelPreview(): Promise<ProductResult<null>>
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
  #rollback: Promise<boolean> | undefined
  #needsStart = false

  public constructor(
    private readonly port: PreviewSyncPort,
    private readonly kind: PreviewSyncKind,
    private readonly onError: (error: ProductError | null) => void,
    private readonly debounceMs = PREVIEW_SYNC_DEBOUNCE_MS
  ) {}

  public schedule(draft: ColorProfile, session: PreviewState): void {
    this.cancelScheduled()
    const generation = this.#generation
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      if (generation !== this.#generation) return
      const rollback = this.#rollback
      const pending = (async () => {
        // A new slider change can arrive before rollback's inactive state has
        // reached the renderer. Wait for cancellation and start a fresh session.
        if (rollback !== undefined && !(await rollback)) return
        if (generation !== this.#generation) return
        const joinsCurrentSession =
          !this.#needsStart &&
          session.state === 'active' &&
          session.kind === this.kind &&
          session.profileId === draft.id
        const request = joinsCurrentSession
          ? this.port.updatePreview(draft.id, activeColorTargets(draft))
          : this.port.startPreview(draft, this.kind)
        const result = await run(request, this.onError)
        if (result !== undefined && generation === this.#generation) {
          this.#needsStart = false
          this.onError(null)
        }
      })()
      this.#pending.add(pending)
      void pending.finally(() => this.#pending.delete(pending))
    }, this.debounceMs)
  }

  public cancelScheduled(): void {
    if (this.#timer === undefined) return
    clearTimeout(this.#timer)
    this.#timer = undefined
  }

  public invalidate(): void {
    this.#generation += 1
    this.cancelScheduled()
  }

  public async rollback(): Promise<void> {
    this.invalidate()
    this.#needsStart = true
    const pending = [...this.#pending]
    const previousRollback = this.#rollback
    const rollback = (async () => {
      await previousRollback
      await Promise.allSettled(pending)
      const result = await run(this.port.cancelPreview(), this.onError)
      if (result !== undefined) this.onError(null)
      return result !== undefined
    })()
    this.#rollback = rollback
    try {
      await rollback
    } finally {
      if (this.#rollback === rollback) this.#rollback = undefined
    }
  }
}
