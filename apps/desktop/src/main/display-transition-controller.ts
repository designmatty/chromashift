import type { DisplayTopologyRefreshResult } from '@chromashift/native-client'
import type { PowerTransitionEvent } from '@main/power-event-adapter.js'
import { describeError, type StructuredLogger } from '@main/structured-logger.js'

export type DisplayTransitionReason =
  | PowerTransitionEvent
  | 'displayAdded'
  | 'displayRemoved'
  | 'displayMetricsChanged'
  | 'nativeDisplaySettingsChanged'

export interface DisplayTransitionNativePort {
  refreshDisplayTopology(): Promise<DisplayTopologyRefreshResult>
}

export interface DisplayTransitionActivationPort {
  beginSystemTransition(): Promise<void>
  completeSystemTransition(reapply: boolean, resumeWrites?: boolean): Promise<void>
}

export interface DisplayTransitionPreviewPort {
  invalidateComparison?(): Promise<void>
  reapplyAfterDisplayTransition(): Promise<boolean>
}

/**
 * Coalesces noisy Windows display notifications into one restore-safe refresh.
 * Automatic writes stay paused from the first signal until enumeration,
 * capability/HDR resolution, and baseline ownership validation finish.
 */
export class DisplayTransitionController {
  readonly #reasons = new Set<DisplayTransitionReason>()
  #timer: NodeJS.Timeout | undefined
  #tail: Promise<void> = Promise.resolve()
  #disposed = false
  // Refreshes queued or running, and a lock or suspend awaiting its refresh.
  #refreshes = 0
  #paused = false
  #pauses = 0

  public constructor(
    private readonly native: DisplayTransitionNativePort,
    private readonly activation: DisplayTransitionActivationPort,
    private readonly preview: DisplayTransitionPreviewPort,
    private readonly logger: StructuredLogger,
    private readonly debounceMs = 750,
    private readonly onRefreshed: () => void = () => undefined,
    private readonly onPreviewFailed: (error: unknown) => void = () => undefined,
    /** Runs after every refresh attempt, including failures, before onRefreshed. */
    private readonly onSettled: () => void = () => undefined
  ) {}

  /**
   * True from the first display or power signal until its refresh settles,
   * including the activation completion. Display ownership may change during
   * this window, so preview replacement takes the restore-first path.
   */
  public get pending(): boolean {
    return this.#timer !== undefined || this.#refreshes > 0 || this.#paused
  }

  public handlePowerEvent(event: PowerTransitionEvent): void {
    if (this.#disposed) return
    this.#reasons.add(event)
    if (event === 'lock' || event === 'suspend') {
      this.#paused = true
      this.#pauses += 1
      void this.#enqueue(async () => {
        await this.activation.beginSystemTransition()
        this.logger.write({
          level: 'information',
          eventName: 'DisplayTransitionPaused',
          reason: event
        })
      })
      return
    }
    this.#scheduleRefresh()
  }

  public handleDisplayEvent(event: Exclude<DisplayTransitionReason, PowerTransitionEvent>): void {
    if (this.#disposed) return
    this.#reasons.add(event)
    this.#scheduleRefresh()
  }

  public async flush(): Promise<void> {
    if (this.#disposed) return
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
      this.#timer = undefined
      this.#queueRefresh()
    }
    await this.#tail
  }

  public dispose(): void {
    this.#disposed = true
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#paused = false
    this.#reasons.clear()
  }

  #scheduleRefresh(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.#queueRefresh()
    }, this.debounceMs)
  }

  #queueRefresh(): void {
    // Counted in the same turn that clears the timer, so pending never drops between them.
    this.#refreshes += 1
    const pauses = this.#pauses
    void this.#enqueue(async () => {
      try {
        await this.#refresh()
      } finally {
        this.#refreshes -= 1
        // Only a refresh queued after the latest lock or suspend completes it.
        if (pauses === this.#pauses) this.#paused = false
      }
    })
  }

  async #refresh(): Promise<void> {
    const reasons = [...this.#reasons]
    this.#reasons.clear()
    await this.activation.beginSystemTransition()
    let previewActive = false
    let refreshed = false
    let topologyValidated = false
    try {
      const topology = await this.native.refreshDisplayTopology()
      const changedOwner = topology.baselines.find(
        (baseline) => baseline.ownership === 'providerChanged'
      )
      if (changedOwner !== undefined) {
        throw new Error(
          `Baseline ownership changed for ${changedOwner.displayId}; display writes remain paused.`
        )
      }
      topologyValidated = true
      try {
        previewActive = await this.preview.reapplyAfterDisplayTransition()
      } catch (error) {
        this.onPreviewFailed(error)
        throw error
      }
      refreshed = true
      this.logger.write({
        level: 'information',
        eventName: 'DisplayTransitionCompleted',
        reasons,
        generation: topology.generation,
        displayIds: topology.displays.map((display) => display.id),
        disconnectedBaselineIds: topology.baselines
          .filter((baseline) => baseline.state === 'disconnected')
          .map((baseline) => baseline.displayId),
        previewActive
      })
    } catch (error) {
      this.logger.write({
        level: 'error',
        eventName: 'DisplayTransitionFailed',
        reasons,
        ...describeError(error)
      })
    } finally {
      if (!topologyValidated) await this.preview.invalidateComparison?.()
      await this.activation.completeSystemTransition(refreshed && !previewActive, topologyValidated)
      this.onSettled()
      if (refreshed) this.onRefreshed()
    }
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const scheduled = this.#tail.then(operation)
    this.#tail = scheduled.then(
      () => undefined,
      () => undefined
    )
    return scheduled
  }
}
