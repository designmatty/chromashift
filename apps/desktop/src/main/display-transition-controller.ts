import type { DisplayTopologyRefreshResult } from '@chromashift/native-client'
import type { PowerTransitionEvent } from './power-event-adapter.js'
import { describeError, type StructuredLogger } from './structured-logger.js'

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

  public constructor(
    private readonly native: DisplayTransitionNativePort,
    private readonly activation: DisplayTransitionActivationPort,
    private readonly preview: DisplayTransitionPreviewPort,
    private readonly logger: StructuredLogger,
    private readonly debounceMs = 750,
    private readonly onRefreshed: () => void = () => undefined
  ) {}

  public handlePowerEvent(event: PowerTransitionEvent): void {
    if (this.#disposed) return
    this.#reasons.add(event)
    if (event === 'lock' || event === 'suspend') {
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
      void this.#enqueue(() => this.#refresh())
    }
    await this.#tail
  }

  public dispose(): void {
    this.#disposed = true
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#reasons.clear()
  }

  #scheduleRefresh(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#enqueue(() => this.#refresh())
    }, this.debounceMs)
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
      previewActive = await this.preview.reapplyAfterDisplayTransition()
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
      await this.activation.completeSystemTransition(refreshed && !previewActive, topologyValidated)
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
