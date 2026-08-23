import { describe, expect, it } from 'vitest'
import type { NativeEvent } from '@chromashift/native-client'
import {
  attachNativeEventRouter,
  type NativeEventActivationPort,
  type NativeEventDisplayTransitionPort,
  type NativeEventRecoveryPort,
  type NativeEventRouterPorts
} from './native-event-router.js'
import type { StructuredLogEvent } from './structured-logger.js'

class FakeNativeEventSource {
  #eventListeners: Array<(event: NativeEvent) => void> = []
  #diagnosticListeners: Array<(message: string) => void> = []
  #exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []

  public on(event: 'event', listener: (event: NativeEvent) => void): unknown
  public on(event: 'diagnostic', listener: (message: string) => void): unknown
  public on(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown
  public on(event: 'event' | 'diagnostic' | 'exit', listener: unknown): unknown {
    if (event === 'event') this.#eventListeners.push(listener as (event: NativeEvent) => void)
    if (event === 'diagnostic')
      this.#diagnosticListeners.push(listener as (message: string) => void)
    if (event === 'exit') {
      this.#exitListeners.push(
        listener as (code: number | null, signal: NodeJS.Signals | null) => void
      )
    }
    return this
  }

  public emitEvent(event: NativeEvent): void {
    for (const listener of this.#eventListeners) listener(event)
  }

  public emitDiagnostic(message: string): void {
    for (const listener of this.#diagnosticListeners) listener(message)
  }

  public emitExit(): void {
    for (const listener of this.#exitListeners) listener(null, null)
  }
}

class RecordingLogger {
  public readonly events: StructuredLogEvent[] = []

  public write(event: StructuredLogEvent): void {
    this.events.push(event)
  }
}

class FakeActivation implements NativeEventActivationPort {
  public readonly events: NativeEvent[] = []
  public exits = 0
  public failure: Error | undefined

  public handleNativeEvent(event: NativeEvent): Promise<unknown> {
    this.events.push(event)
    return this.failure === undefined ? Promise.resolve() : Promise.reject(this.failure)
  }

  public handleNativeServiceExit(): Promise<unknown> {
    this.exits += 1
    return this.failure === undefined ? Promise.resolve() : Promise.reject(this.failure)
  }
}

class FakeDisplayTransitions implements NativeEventDisplayTransitionPort {
  public readonly events: string[] = []

  public handleDisplayEvent(event: 'nativeDisplaySettingsChanged'): void {
    this.events.push(event)
  }
}

class FakeRecovery implements NativeEventRecoveryPort {
  public exits = 0

  public handleExit(): Promise<unknown> {
    this.exits += 1
    return Promise.resolve()
  }
}

interface Harness {
  source: FakeNativeEventSource
  logger: RecordingLogger
  activation: FakeActivation
  displayTransitions: FakeDisplayTransitions
  broadcasts: () => number
}

function createHarness(overrides: Partial<NativeEventRouterPorts> = {}): Harness {
  const source = new FakeNativeEventSource()
  const logger = new RecordingLogger()
  const activation = new FakeActivation()
  const displayTransitions = new FakeDisplayTransitions()
  let broadcasts = 0
  attachNativeEventRouter(source, {
    activation: () => activation,
    displayTransitions: () => displayTransitions,
    recovery: () => undefined,
    isExiting: () => false,
    broadcastProductState: () => {
      broadcasts += 1
    },
    logger,
    ...overrides
  })
  return { source, logger, activation, displayTransitions, broadcasts: () => broadcasts }
}

const foregroundEvent: NativeEvent = {
  event: 'foregroundApplicationChanged',
  data: {
    application: {
      pid: 4242,
      executable: 'game.exe',
      path: 'C:\\Games\\game.exe',
      title: 'Game',
      monitorDeviceName: null
    }
  }
}

describe('native event router', () => {
  it('routes a validated topology change to display transitions', () => {
    const harness = createHarness()
    harness.source.emitEvent({
      event: 'displayTopologyChanged',
      data: { reason: 'displaySettingsChanged' }
    })
    expect(harness.displayTransitions.events).toEqual(['nativeDisplaySettingsChanged'])
    expect(harness.broadcasts()).toBe(0)
  })

  it('ignores a topology change whose payload fails validation', () => {
    const harness = createHarness()
    harness.source.emitEvent({ event: 'displayTopologyChanged', data: { reason: 'unexpected' } })
    expect(harness.displayTransitions.events).toEqual([])
  })

  it('broadcasts product state for a validated foreground change and forwards it to activation', () => {
    const harness = createHarness()
    harness.source.emitEvent(foregroundEvent)
    expect(harness.broadcasts()).toBe(1)
    expect(harness.activation.events).toEqual([foregroundEvent])
  })

  it('still forwards an event to activation when its payload fails broadcast validation', () => {
    const harness = createHarness()
    const malformed: NativeEvent = { event: 'foregroundApplicationChanged', data: {} }
    harness.source.emitEvent(malformed)
    expect(harness.broadcasts()).toBe(0)
    expect(harness.activation.events).toEqual([malformed])
  })

  it('drops display routing while the transition controller does not exist yet', () => {
    const harness = createHarness({ displayTransitions: () => undefined })
    harness.source.emitEvent({
      event: 'displayTopologyChanged',
      data: { reason: 'displaySettingsChanged' }
    })
    expect(harness.displayTransitions.events).toEqual([])
    expect(harness.logger.events).toEqual([])
  })

  it('logs a failed activation event without throwing', async () => {
    const harness = createHarness()
    harness.activation.failure = new Error('activation broke')
    harness.source.emitEvent(foregroundEvent)
    await Promise.resolve()
    expect(harness.logger.events).toEqual([
      { level: 'error', eventName: 'AutomaticActivationEventFailed', message: 'activation broke' }
    ])
  })

  it('routes exit to activation when no recovery controller exists', () => {
    const harness = createHarness()
    harness.source.emitExit()
    expect(harness.activation.exits).toBe(1)
    expect(harness.broadcasts()).toBe(1)
  })

  it('routes exit to the recovery controller once it exists, not to activation', () => {
    const recovery = new FakeRecovery()
    const harness = createHarness({ recovery: () => recovery })
    harness.source.emitExit()
    expect(recovery.exits).toBe(1)
    expect(harness.activation.exits).toBe(0)
  })

  it('suppresses the exit broadcast during shutdown', () => {
    const harness = createHarness({ isExiting: () => true })
    harness.source.emitExit()
    expect(harness.activation.exits).toBe(1)
    expect(harness.broadcasts()).toBe(0)
  })

  it('logs a failed exit handling without throwing', async () => {
    const harness = createHarness()
    harness.activation.failure = new Error('restore broke')
    harness.source.emitExit()
    await Promise.resolve()
    expect(harness.logger.events).toEqual([
      { level: 'error', eventName: 'NativeServiceExitHandlingFailed', message: 'restore broke' }
    ])
  })

  it('records structured JSON diagnostics with their native level and details', () => {
    const harness = createHarness()
    harness.source.emitDiagnostic(
      JSON.stringify({ level: 'error', eventName: 'ProviderWriteFailed', displayId: 'display:abc' })
    )
    expect(harness.logger.events).toEqual([
      { level: 'error', eventName: 'ProviderWriteFailed', displayId: 'display:abc' }
    ])
  })

  it('normalizes an unknown diagnostic level to information', () => {
    const harness = createHarness()
    harness.source.emitDiagnostic(JSON.stringify({ level: 'debug', eventName: 'HelperStarted' }))
    expect(harness.logger.events).toEqual([{ level: 'information', eventName: 'HelperStarted' }])
  })

  it('preserves non-JSON diagnostics as warning messages', () => {
    const harness = createHarness()
    harness.source.emitDiagnostic('plain text from the helper')
    expect(harness.logger.events).toEqual([
      {
        level: 'warning',
        eventName: 'NativeServiceDiagnostic',
        message: 'plain text from the helper'
      }
    ])
  })
})
