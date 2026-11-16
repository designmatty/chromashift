import type { DisplayTopologyRefreshResult } from '@chromashift/native-client'
import { describe, expect, it } from 'vitest'
import { DisplayTransitionController } from '@main/display-transition-controller.js'
import type { StructuredLogEvent, StructuredLogger } from '@main/structured-logger.js'

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
  it('reports pending from the first signal until the refresh, including completion, settles', async () => {
    let releaseRefresh: (() => void) | undefined
    const refreshStarted = async (): Promise<() => void> => {
      for (let turn = 0; turn < 50 && releaseRefresh === undefined; turn++) await Promise.resolve()
      const release = releaseRefresh!
      releaseRefresh = undefined
      return release
    }
    let refreshFails = false
    const pendingAt: Record<string, boolean> = {}
    const controller: DisplayTransitionController = new DisplayTransitionController(
      {
        refreshDisplayTopology: () =>
          new Promise((resolve, reject) => {
            releaseRefresh = () =>
              refreshFails ? reject(new Error('refresh failed')) : resolve(topology())
          })
      },
      {
        beginSystemTransition: async () => undefined,
        completeSystemTransition: async () => {
          pendingAt.complete = controller.pending
        }
      },
      { reapplyAfterDisplayTransition: async () => false },
      new Logger(),
      60_000
    )
    expect(controller.pending).toBe(false)

    controller.handleDisplayEvent('displayAdded')
    expect(controller.pending).toBe(true)
    const flushing = controller.flush()
    expect(controller.pending).toBe(true)
    ;(await refreshStarted())()
    await flushing
    expect(pendingAt.complete).toBe(true)
    expect(controller.pending).toBe(false)

    // A failed refresh still settles.
    refreshFails = true
    controller.handleDisplayEvent('displayRemoved')
    const failing = controller.flush()
    ;(await refreshStarted())()
    await failing
    expect(controller.pending).toBe(false)

    // Lock stays pending until a refresh queued after it settles.
    refreshFails = false
    controller.handlePowerEvent('lock')
    expect(controller.pending).toBe(true)
    await controller.flush()
    expect(controller.pending).toBe(true)
    controller.handlePowerEvent('unlock')
    const unlocking = controller.flush()
    expect(controller.pending).toBe(true)
    ;(await refreshStarted())()
    await unlocking
    expect(controller.pending).toBe(false)

    // Dispose drops a scheduled refresh and any pause.
    controller.handlePowerEvent('suspend')
    controller.handleDisplayEvent('displayMetricsChanged')
    expect(controller.pending).toBe(true)
    controller.dispose()
    expect(controller.pending).toBe(false)
  })

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
      60_000,
      () => calls.push('refreshed'),
      undefined,
      () => calls.push('settled')
    )

    controller.handlePowerEvent('suspend')
    controller.handleDisplayEvent('displayMetricsChanged')
    controller.handlePowerEvent('resume')
    await controller.flush()

    expect(calls).toEqual([
      'begin',
      'begin',
      'refresh',
      'preview',
      'complete:true:true',
      'settled',
      'refreshed'
    ])
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
      60_000,
      () => calls.push('refreshed'),
      undefined,
      () => calls.push('settled')
    )

    controller.handleDisplayEvent('displayRemoved')
    await controller.flush()

    // A failed refresh still settles, so cached hardware state is dropped.
    expect(calls).toEqual(['begin', 'complete:false:false', 'settled'])
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

describe('DisplayTransitionController pending across overlapping work', () => {
  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  function gatedController() {
    const refreshes: ReturnType<typeof deferred>[] = []
    const completions: ReturnType<typeof deferred>[] = []
    const controller = new DisplayTransitionController(
      {
        refreshDisplayTopology: async () => {
          const gate = deferred()
          refreshes.push(gate)
          await gate.promise
          return { generation: 1, displays: [], capabilityReports: [], baselines: [] }
        }
      },
      {
        beginSystemTransition: async () => undefined,
        completeSystemTransition: async () => {
          const gate = deferred()
          completions.push(gate)
          await gate.promise
        }
      },
      { reapplyAfterDisplayTransition: async () => false },
      new Logger(),
      60_000
    )
    return { controller, refreshes, completions }
  }

  async function settleMicrotasks(): Promise<void> {
    for (let turn = 0; turn < 30; turn++) await Promise.resolve()
  }

  it('stays pending through a lock that arrives while an earlier refresh runs', async () => {
    const { controller, refreshes, completions } = gatedController()
    controller.handleDisplayEvent('displayAdded')
    const first = controller.flush()
    await settleMicrotasks()
    controller.handlePowerEvent('lock')
    refreshes[0]!.resolve()
    await settleMicrotasks()
    expect(controller.pending).toBe(true)
    completions[0]!.resolve()
    await first
    // The earlier refresh settled, but the newer lock still awaits its own refresh.
    await controller.flush()
    expect(controller.pending).toBe(true)
    controller.handlePowerEvent('unlock')
    const second = controller.flush()
    await settleMicrotasks()
    refreshes[1]!.resolve()
    await settleMicrotasks()
    expect(controller.pending).toBe(true)
    completions[1]!.resolve()
    await second
    expect(controller.pending).toBe(false)
    controller.dispose()
  })

  it('counts both queued refreshes until each activation completion settles', async () => {
    const { controller, refreshes, completions } = gatedController()
    controller.handleDisplayEvent('displayAdded')
    const first = controller.flush()
    await settleMicrotasks()
    controller.handleDisplayEvent('displayMetricsChanged')
    const second = controller.flush()
    refreshes[0]!.resolve()
    await settleMicrotasks()
    completions[0]!.resolve()
    await first
    await settleMicrotasks()
    expect(controller.pending).toBe(true)
    refreshes[1]!.resolve()
    await settleMicrotasks()
    expect(controller.pending).toBe(true)
    completions[1]!.resolve()
    await second
    expect(controller.pending).toBe(false)
    controller.dispose()
  })

  it('keeps a refresh in flight across dispose, and a bare suspend pending without refreshing', async () => {
    const { controller, refreshes, completions } = gatedController()
    controller.handlePowerEvent('suspend')
    await controller.flush()
    expect(refreshes).toHaveLength(0)
    expect(controller.pending).toBe(true)
    controller.handlePowerEvent('resume')
    const refresh = controller.flush()
    await settleMicrotasks()
    controller.dispose()
    expect(controller.pending).toBe(true)
    refreshes[0]!.resolve()
    await settleMicrotasks()
    expect(controller.pending).toBe(true)
    completions[0]!.resolve()
    await refresh
    expect(controller.pending).toBe(false)
  })
})
