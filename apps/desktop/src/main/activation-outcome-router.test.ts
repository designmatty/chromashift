import { describe, expect, it } from 'vitest'
import {
  attachActivationOutcomeRouter,
  type OutcomeNotificationPort
} from './activation-outcome-router.js'
import type { CompletedActivationOutcome } from './automatic-activation-controller.js'
import type { StructuredLogEvent } from './structured-logger.js'

function outcome(overrides: Partial<CompletedActivationOutcome> = {}): CompletedActivationOutcome {
  return {
    status: 'activated',
    resolution: null,
    failures: [],
    deferredDisplayIds: [],
    source: 'automatic',
    origin: 'foreground',
    ...overrides
  }
}

class RecordingLogger {
  public readonly events: StructuredLogEvent[] = []

  public write(event: StructuredLogEvent): void {
    this.events.push(event)
  }
}

class FakeControl {
  public readonly recorded: CompletedActivationOutcome[] = []
  public recordFailure: Error | undefined
  public syncs = 0
  public syncFailure: Error | undefined
  #listeners = new Set<(outcome: CompletedActivationOutcome) => void>()

  public syncActiveIntent(): Promise<unknown> {
    this.syncs += 1
    return this.syncFailure === undefined ? Promise.resolve() : Promise.reject(this.syncFailure)
  }

  public subscribeOperationalOutcomes(
    listener: (outcome: CompletedActivationOutcome) => void
  ): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  public recordCompletedOutcome(value: CompletedActivationOutcome): Promise<unknown> {
    this.recorded.push(value)
    return this.recordFailure === undefined ? Promise.resolve() : Promise.reject(this.recordFailure)
  }

  public emit(value: CompletedActivationOutcome): void {
    for (const listener of this.#listeners) listener(value)
  }
}

class FakeActivation {
  #listeners = new Set<(outcome: CompletedActivationOutcome) => void>()
  #stateListeners = new Set<() => void>()

  public subscribe(listener: () => void): () => void {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  public subscribeOutcomes(listener: (outcome: CompletedActivationOutcome) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  public emit(value: CompletedActivationOutcome): void {
    for (const listener of this.#listeners) listener(value)
  }

  public emitStateChange(): void {
    for (const listener of this.#stateListeners) listener()
  }
}

class FakeNotifications implements OutcomeNotificationPort {
  public readonly handled: CompletedActivationOutcome[] = []
  public failure: Error | undefined

  public handle(value: CompletedActivationOutcome): Promise<unknown> {
    this.handled.push(value)
    return this.failure === undefined ? Promise.resolve() : Promise.reject(this.failure)
  }
}

function createHarness(): {
  activation: FakeActivation
  control: FakeControl
  notifications: FakeNotifications
  logger: RecordingLogger
  broadcasts: () => number
  detach: () => void
} {
  const activation = new FakeActivation()
  const control = new FakeControl()
  const notifications = new FakeNotifications()
  const logger = new RecordingLogger()
  let broadcasts = 0
  const detach = attachActivationOutcomeRouter(
    activation,
    control,
    notifications,
    () => {
      broadcasts += 1
    },
    logger
  )
  return { activation, control, notifications, logger, broadcasts: () => broadcasts, detach }
}

describe('activation outcome router', () => {
  it('routes an activation outcome to intent persistence and notifications', () => {
    const harness = createHarness()
    const value = outcome()
    harness.activation.emit(value)
    expect(harness.control.recorded).toEqual([value])
    expect(harness.notifications.handled).toEqual([value])
  })

  it('drops control-operation origins from the activation stream', () => {
    const harness = createHarness()
    for (const origin of ['pause', 'resume', 'safetyRetry', 'originalSettingsRestore'] as const) {
      harness.activation.emit(outcome({ origin }))
    }
    expect(harness.control.recorded).toEqual([])
    expect(harness.notifications.handled).toEqual([])
  })

  it('routes finalized control outcomes from the operational stream', () => {
    const harness = createHarness()
    const value = outcome({ origin: 'pause', source: 'manual' })
    harness.control.emit(value)
    expect(harness.control.recorded).toEqual([value])
    expect(harness.notifications.handled).toEqual([value])
  })

  it('still notifies when intent persistence fails, logging the failure', async () => {
    const harness = createHarness()
    harness.control.recordFailure = new Error('disk full')
    harness.activation.emit(outcome())
    await Promise.resolve()
    expect(harness.notifications.handled).toHaveLength(1)
    expect(harness.logger.events).toEqual([
      { level: 'error', eventName: 'ChromaShiftIntentPersistenceFailed', message: 'disk full' }
    ])
  })

  it('still persists intent when notification handling fails, logging the failure', async () => {
    const harness = createHarness()
    harness.notifications.failure = new Error('toast broke')
    harness.activation.emit(outcome())
    await Promise.resolve()
    expect(harness.control.recorded).toHaveLength(1)
    expect(harness.logger.events).toEqual([
      {
        level: 'error',
        eventName: 'ProfileNotificationFailed',
        message: { message: 'toast broke' }
      }
    ])
  })

  it('syncs persisted intent and refreshes product state on an activation state change', () => {
    const harness = createHarness()
    harness.activation.emitStateChange()
    expect(harness.control.syncs).toBe(1)
    expect(harness.broadcasts()).toBe(1)
    expect(harness.control.recorded).toEqual([])
    expect(harness.notifications.handled).toEqual([])
  })

  it('still refreshes product state when intent sync fails, logging the failure', async () => {
    const harness = createHarness()
    harness.control.syncFailure = new Error('settings write broke')
    harness.activation.emitStateChange()
    await Promise.resolve()
    expect(harness.broadcasts()).toBe(1)
    expect(harness.logger.events).toEqual([
      {
        level: 'error',
        eventName: 'ChromaShiftIntentPersistenceFailed',
        message: 'settings write broke'
      }
    ])
  })

  it('detaches all three streams through the returned function', () => {
    const harness = createHarness()
    harness.detach()
    harness.activation.emit(outcome())
    harness.activation.emitStateChange()
    harness.control.emit(outcome({ origin: 'resume' }))
    expect(harness.control.recorded).toEqual([])
    expect(harness.control.syncs).toBe(0)
    expect(harness.notifications.handled).toEqual([])
    expect(harness.broadcasts()).toBe(0)
  })
})
