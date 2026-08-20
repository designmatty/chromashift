import type { ActivationOutcome } from './activation-coordinator.js'
import type { StructuredLogger } from './structured-logger.js'

export interface EmergencyPreviewPort {
  dispose(): Promise<void>
}

export interface EmergencyActivationPort {
  restoreBaseline(): Promise<ActivationOutcome>
}

export class EmergencyRestoreController {
  #operation: Promise<boolean> | undefined

  public constructor(
    private readonly preview: EmergencyPreviewPort,
    private readonly activation: EmergencyActivationPort,
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
    try {
      await this.preview.dispose()
      const outcome = await this.activation.restoreBaseline()
      const restored = outcome.status === 'activated' && outcome.deferredDisplayIds.length === 0
      this.logger.write({
        level: restored ? 'information' : 'critical',
        eventName: 'EmergencyRestoreCompleted',
        restored,
        failures: outcome.failures,
        deferredDisplayIds: outcome.deferredDisplayIds
      })
      return restored
    } catch (error) {
      this.logger.write({
        level: 'critical',
        eventName: 'EmergencyRestoreFailed',
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }
}
