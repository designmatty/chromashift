import {
  displayTopologyChangedDataSchema,
  foregroundApplicationChangedDataSchema,
  type NativeEvent
} from '@chromashift/native-client'
import { describeError, type StructuredLogger } from './structured-logger.js'

export interface NativeEventSource {
  on(event: 'event', listener: (event: NativeEvent) => void): unknown
  on(event: 'diagnostic', listener: (message: string) => void): unknown
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}

export interface NativeEventActivationPort {
  handleNativeEvent(event: NativeEvent): Promise<unknown>
  handleNativeServiceExit(): Promise<unknown>
}

export interface NativeEventDisplayTransitionPort {
  handleDisplayEvent(event: 'nativeDisplaySettingsChanged'): void
}

export interface NativeEventRecoveryPort {
  handleExit(): Promise<unknown>
}

export interface NativeEventRouterPorts {
  // Getters, not references: display transitions and recovery are constructed
  // after the native client starts, and events arriving before then are dropped.
  activation: () => NativeEventActivationPort | undefined
  displayTransitions: () => NativeEventDisplayTransitionPort | undefined
  recovery: () => NativeEventRecoveryPort | undefined
  isExiting: () => boolean
  broadcastProductState: () => void
  logger: StructuredLogger
}

/**
 * Routes DisplayService events, diagnostics, and process exit to the product
 * controllers. When the recovery controller exists it owns exit handling;
 * otherwise activation resets its own state directly.
 */
export function attachNativeEventRouter(
  client: NativeEventSource,
  ports: NativeEventRouterPorts
): void {
  client.on('diagnostic', (message) => recordNativeDiagnostic(ports.logger, message))
  client.on('event', (event) => {
    if (event.event === 'displayTopologyChanged') {
      const parsed = displayTopologyChangedDataSchema.safeParse(event.data)
      if (parsed.success) {
        ports.displayTransitions()?.handleDisplayEvent('nativeDisplaySettingsChanged')
      }
    }
    if (event.event === 'foregroundApplicationChanged') {
      const parsed = foregroundApplicationChangedDataSchema.safeParse(event.data)
      if (parsed.success) ports.broadcastProductState()
    }
    const activation = ports.activation()
    if (activation === undefined) return
    void activation.handleNativeEvent(event).catch((error: unknown) => {
      ports.logger.write({
        level: 'error',
        eventName: 'AutomaticActivationEventFailed',
        ...describeError(error)
      })
    })
  })
  client.on('exit', () => {
    const recovery = ports.recovery()
    const handling =
      recovery === undefined
        ? (ports.activation()?.handleNativeServiceExit() ?? Promise.resolve())
        : recovery.handleExit()
    void handling.catch((error: unknown) => {
      ports.logger.write({
        level: 'error',
        eventName: 'NativeServiceExitHandlingFailed',
        ...describeError(error)
      })
    })
    if (!ports.isExiting()) ports.broadcastProductState()
  })
}

function recordNativeDiagnostic(logger: StructuredLogger, message: string): void {
  try {
    const parsed = JSON.parse(message) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'eventName' in parsed &&
      typeof parsed.eventName === 'string'
    ) {
      const { level, eventName, ...details } = parsed as Record<string, unknown>
      logger.write({
        ...details,
        level:
          level === 'warning' || level === 'error' || level === 'critical' ? level : 'information',
        eventName: String(eventName)
      })
      return
    }
  } catch {
    // Preserve non-JSON native diagnostics as structured messages below.
  }
  logger.write({ level: 'warning', eventName: 'NativeServiceDiagnostic', message })
}
