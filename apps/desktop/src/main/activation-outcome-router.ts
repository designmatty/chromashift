import type { CompletedActivationOutcome } from './automatic-activation-controller.js'
import { describeError, type StructuredLogger } from './structured-logger.js'

export interface OutcomeActivationSource {
  subscribe(listener: () => void): () => void
  subscribeOutcomes(listener: (outcome: CompletedActivationOutcome) => void): () => void
}

export interface OutcomeControlSource {
  subscribeOperationalOutcomes(listener: (outcome: CompletedActivationOutcome) => void): () => void
  recordCompletedOutcome(outcome: CompletedActivationOutcome): Promise<unknown>
  syncActiveIntent(): Promise<unknown>
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
 * Routes activation state changes into persisted ChromaShift intent and a
 * product-state refresh, and every completed activation outcome into intent
 * persistence and user-facing notifications. Returns one detach
 * function covering all three subscriptions.
 */
export function attachActivationOutcomeRouter(
  activation: OutcomeActivationSource,
  control: OutcomeControlSource,
  notifications: OutcomeNotificationPort,
  broadcastProductState: () => void,
  logger: StructuredLogger
): () => void {
  const unsubscribeStateSync = activation.subscribe(() => {
    void control.syncActiveIntent().catch((error: unknown) => {
      logger.write({
        level: 'error',
        eventName: 'ChromaShiftIntentPersistenceFailed',
        ...describeError(error)
      })
    })
    broadcastProductState()
  })
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
    unsubscribeStateSync()
    unsubscribeActivation()
    unsubscribeControl()
  }
}
