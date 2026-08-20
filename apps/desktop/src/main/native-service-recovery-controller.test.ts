import type {
  DisplayTopologyRefreshResult,
  ForegroundApplication,
  ServiceHealth,
  SystemInfo
} from '@chromashift/native-client'
import { describe, expect, it } from 'vitest'
import {
  NativeServiceRecoveryController,
  type RecoverableActivationPort,
  type RecoverableNativeServicePort
} from './native-service-recovery-controller.js'
import type { StructuredLogEvent, StructuredLogger } from './structured-logger.js'

const info: SystemInfo = {
  protocolVersion: 1,
  serviceVersion: '1.0.0',
  operatingSystem: 'Windows',
  processId: 10,
  providers: {
    amd: {
      libraryAvailable: false,
      initialized: false,
      displayCount: 0,
      runtimeValidation: 'test'
    }
  }
}
const health: ServiceHealth = {
  status: 'healthy',
  protocolVersion: 1,
  serviceVersion: '1.0.0',
  processId: 10,
  serviceInstanceId: '11111111-1111-4111-8111-111111111111',
  baselineOwnerId: '22222222-2222-4222-8222-222222222222',
  baselineCount: 0,
  watchdogArmed: true
}

class Logger implements StructuredLogger {
  readonly events: StructuredLogEvent[] = []
  write(event: StructuredLogEvent): void {
    this.events.push(event)
  }
}

function activation(calls: string[]): RecoverableActivationPort {
  return {
    handleNativeServiceExit: async () => {
      calls.push('reset')
    },
    start: async () => {
      calls.push('start-activation')
    }
  }
}

function native(calls: string[], baselines: readonly string[] = []): RecoverableNativeServicePort {
  return {
    potentialBaselineDisplayIds: baselines,
    start: async () => {
      calls.push('start-native')
      return info
    },
    getServiceHealth: async () => {
      calls.push('health')
      return health
    },
    refreshDisplayTopology: async (): Promise<DisplayTopologyRefreshResult> => {
      calls.push('topology')
      return { generation: 1, displays: [], capabilityReports: [], baselines: [] }
    },
    getForegroundApplication: async (): Promise<ForegroundApplication | null> => {
      calls.push('foreground')
      return null
    }
  }
}

describe('NativeServiceRecoveryController', () => {
  it('health-checks and restarts automation when no baseline was owned', async () => {
    const calls: string[] = []
    const messages: string[] = []
    const controller = new NativeServiceRecoveryController(
      native(calls),
      activation(calls),
      () => false,
      { recovered: () => calls.push('recovered'), terminal: (message) => messages.push(message) },
      new Logger(),
      [0],
      60_000,
      Date.now,
      async () => undefined
    )

    await controller.handleExit()

    expect(calls).toEqual([
      'reset',
      'start-native',
      'health',
      'topology',
      'foreground',
      'start-activation',
      'recovered'
    ])
    expect(messages).toEqual([])
  })

  it('fails closed without starting a helper when baseline ownership may be live', async () => {
    const calls: string[] = []
    const messages: string[] = []
    const controller = new NativeServiceRecoveryController(
      native(calls, ['display:one']),
      activation(calls),
      () => false,
      { recovered: () => undefined, terminal: (message) => messages.push(message) },
      new Logger(),
      [0],
      60_000,
      Date.now,
      async () => undefined
    )

    await controller.handleExit()

    expect(calls).toEqual(['reset'])
    expect(messages[0]).toContain('Automatic restart was blocked')
  })

  it('opens the circuit after bounded handshake failures', async () => {
    const calls: string[] = []
    const messages: string[] = []
    const broken = native(calls)
    broken.getServiceHealth = async () => ({ ...health, protocolVersion: 99 })
    const controller = new NativeServiceRecoveryController(
      broken,
      activation(calls),
      () => false,
      { recovered: () => undefined, terminal: (message) => messages.push(message) },
      new Logger(),
      [0, 0, 0],
      60_000,
      Date.now,
      async () => undefined
    )

    await controller.handleExit()

    expect(calls.filter((call) => call === 'start-native')).toHaveLength(3)
    expect(messages).toEqual([
      'DisplayService could not be restarted after bounded recovery attempts.'
    ])
  })
})
