import type { DisplayTopologyRefreshResult } from '@chromashift/native-client'
import { describe, expect, it } from 'vitest'
import { DisplayTransitionController } from './display-transition-controller.js'
import type { StructuredLogEvent, StructuredLogger } from './structured-logger.js'

class Logger implements StructuredLogger {
  readonly events: StructuredLogEvent[] = []
  write(event: StructuredLogEvent): void {
    this.events.push(event)
  }
}

function topology(
  ownership: 'validated' | 'providerChanged' = 'validated'
): DisplayTopologyRefreshResult {
  return {
    generation: 3,
    displays: [],
    capabilityReports: [],
    baselines: [
      {
        displayId: 'display:one',
        state: 'connected',
        ownership
      }
    ]
  }
}

describe('DisplayTransitionController', () => {
  it('pauses immediately and coalesces resume and display notifications', async () => {
    const calls: string[] = []
    const logger = new Logger()
    const controller = new DisplayTransitionController(
      {
        refreshDisplayTopology: async () => {
          calls.push('refresh')
          return topology()
        }
      },
      {
        beginSystemTransition: async () => {
          calls.push('begin')
        },
        completeSystemTransition: async (reapply, resume) => {
          calls.push(`complete:${reapply}:${resume}`)
        }
      },
      {
        reapplyAfterDisplayTransition: async () => {
          calls.push('preview')
          return false
        }
      },
      logger,
      60_000
    )

    controller.handlePowerEvent('suspend')
    controller.handleDisplayEvent('displayMetricsChanged')
    controller.handlePowerEvent('resume')
    await controller.flush()

    expect(calls).toEqual(['begin', 'begin', 'refresh', 'preview', 'complete:true:true'])
    expect(logger.events).toContainEqual(
      expect.objectContaining({
        eventName: 'DisplayTransitionCompleted',
        reasons: ['suspend', 'displayMetricsChanged', 'resume']
      })
    )
  })

  it('does not reapply through a changed baseline owner', async () => {
    const calls: string[] = []
    const logger = new Logger()
    const controller = new DisplayTransitionController(
      { refreshDisplayTopology: async () => topology('providerChanged') },
      {
        beginSystemTransition: async () => {
          calls.push('begin')
        },
        completeSystemTransition: async (reapply, resume) => {
          calls.push(`complete:${reapply}:${resume}`)
        }
      },
      {
        reapplyAfterDisplayTransition: async () => {
          calls.push('preview')
          return false
        }
      },
      logger,
      60_000
    )

    controller.handleDisplayEvent('displayRemoved')
    await controller.flush()

    expect(calls).toEqual(['begin', 'complete:false:false'])
    expect(logger.events).toContainEqual(
      expect.objectContaining({
        eventName: 'DisplayTransitionFailed'
      })
    )
  })

  it('reapplies an active preview without also applying automatic state', async () => {
    const calls: string[] = []
    const controller = new DisplayTransitionController(
      { refreshDisplayTopology: async () => topology() },
      {
        beginSystemTransition: async () => {
          calls.push('begin')
        },
        completeSystemTransition: async (reapply, resume) => {
          calls.push(`complete:${reapply}:${resume}`)
        }
      },
      {
        reapplyAfterDisplayTransition: async () => {
          calls.push('preview')
          return true
        }
      },
      new Logger(),
      60_000
    )

    controller.handlePowerEvent('unlock')
    await controller.flush()

    expect(calls).toEqual(['begin', 'preview', 'complete:false:true'])
  })
})
