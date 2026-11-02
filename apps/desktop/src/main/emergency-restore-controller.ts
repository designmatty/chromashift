import type { ActivationOutcome } from '@main/activation-coordinator.js'
import { describeError, type StructuredLogger } from '@main/structured-logger.js'

export interface EmergencyPreviewPort {
  dispose(): Promise<void>
}

export interface EmergencyActivationPort {
  restoreBaseline(): Promise<ActivationOutcome>
}

/**
 * Moves display control to Paused after a confirmed emergency restore, so the
 * restored state persists until the user resumes. `prepareRestore` runs before
 * the restore and returns the follow-up, which runs only after success.
 */
export interface EmergencyControlPort {
  prepareRestore(): () => Promise<unknown>
}

export class EmergencyRestoreController {
  #operation: Promise<boolean> | undefined

  public constructor(
    private readonly preview: EmergencyPreviewPort,
    private readonly activation: EmergencyActivationPort,
    private readonly control: EmergencyControlPort,
    private readonly logger: StructuredLogger
  ) {}

  public request(): Promise<boolean> {
    if (this.#operation !== undefined) return this.#operation
    this.#operation = this.#restore().finally(() => {
      this.#operation = undefined
    })
    return this.#operation
  }

  async #restore(): Promise<boolean> {
    const pauseAfterRestore = this.#preparePause()
    let restored: boolean
    try {
      await this.preview.dispose()
      const outcome = await this.activation.restoreBaseline()
      restored = outcome.status === 'activated' && outcome.deferredDisplayIds.length === 0
      this.logger.write({
        level: restored ? 'information' : 'critical',
        eventName: 'EmergencyRestoreCompleted',
        restored,
        failures: outcome.failures,
        deferredDisplayIds: outcome.deferredDisplayIds
      })
    } catch (error) {
      this.logger.write({
        level: 'critical',
        eventName: 'EmergencyRestoreFailed',
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
    if (restored && pauseAfterRestore !== null) await this.#pause(pauseAfterRestore)
    return restored
  }

  // Preparing the Paused follow-up must never block the restore itself.
  #preparePause(): (() => Promise<unknown>) | null {
    try {
      return this.control.prepareRestore()
    } catch (error) {
      this.#logPauseFailure(error)
      return null
    }
  }

  // The emergency restore itself is already confirmed here. A failure while
  // entering Paused is reported by the control path (Safety blocked plus its
  // own notification), so it is logged rather than reported as a restore failure.
  async #pause(pauseAfterRestore: () => Promise<unknown>): Promise<void> {
    try {
      await pauseAfterRestore()
    } catch (error) {
      this.#logPauseFailure(error)
    }
  }

  #logPauseFailure(error: unknown): void {
    this.logger.write({
      level: 'error',
      eventName: 'EmergencyRestorePauseFailed',
      ...describeError(error)
    })
  }
}
