import type { CompletedActivationOutcome } from './automatic-activation-controller.js'
import { describeError, type StructuredLogger } from './structured-logger.js'

export interface OutcomeActivationSource {
  subscribeOutcomes(listener: (outcome: CompletedActivationOutcome) => void): () => void
}

export interface OutcomeControlSource {
  subscribeOperationalOutcomes(listener: (outcome: CompletedActivationOutcome) => void): () => void
  recordCompletedOutcome(outcome: CompletedActivationOutcome): Promise<unknown>
}

export interface OutcomeNotificationPort {
  handle(outcome: CompletedActivationOutcome): Promise<unknown>
}

// Control-operation outcomes are dropped from the activation stream because
// their pause/resume/retry/restore operation has not finalized yet; the
// control source re-emits each one operationally once it has.
const finalizedControlOrigins = new Set<CompletedActivationOutcome['origin']>([
  'pause',
  'resume',
  'safetyRetry',
  'originalSettingsRestore'
])

/**
 * Routes every completed activation outcome into persisted ChromaShift intent
 * and user-facing profile notifications. Returns one detach function covering
 * both subscriptions.
 */
export function attachActivationOutcomeRouter(
  activation: OutcomeActivationSource,
  control: OutcomeControlSource,
  notifications: OutcomeNotificationPort,
  logger: StructuredLogger
): () => void {
  const handleOutcome = (outcome: CompletedActivationOutcome): void => {
    void control.recordCompletedOutcome(outcome).catch((error: unknown) => {
      logger.write({
        level: 'error',
        eventName: 'ChromaShiftIntentPersistenceFailed',
        ...describeError(error)
      })
    })
    void notifications.handle(outcome).catch((error: unknown) => {
      logger.write({
        level: 'error',
        eventName: 'ProfileNotificationFailed',
        message: describeError(error)
      })
    })
  }
  const unsubscribeActivation = activation.subscribeOutcomes((outcome) => {
    if (!finalizedControlOrigins.has(outcome.origin)) handleOutcome(outcome)
  })
  const unsubscribeControl = control.subscribeOperationalOutcomes(handleOutcome)
  return () => {
    unsubscribeActivation()
    unsubscribeControl()
  }
}
