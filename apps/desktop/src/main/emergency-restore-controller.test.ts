import { describe, expect, it, vi } from 'vitest'
import type { ActivationOutcome } from '@main/activation-coordinator.js'
import { EmergencyRestoreController } from '@main/emergency-restore-controller.js'
import type { StructuredLogEvent, StructuredLogger } from '@main/structured-logger.js'

const logger: StructuredLogger = { write: () => undefined }

function restoreOutcome(overrides: Partial<ActivationOutcome> = {}): ActivationOutcome {
  return {
    status: 'activated',
    resolution: null,
    failures: [],
    deferredDisplayIds: [],
    ...overrides
  }
}

describe('EmergencyRestoreController', () => {
  it('tears down preview state before restoring and coalesces concurrent shortcuts', async () => {
    const calls: string[] = []
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const controller = new EmergencyRestoreController(
      {
        dispose: async () => {
          calls.push('preview')
          await waiting
        }
      },
      {
        restoreBaseline: async () => {
          calls.push('restore')
          return restoreOutcome()
        }
      },
      {
        prepareRestore: () => {
          calls.push('prepare')
          return async () => {
            calls.push('pause')
          }
        }
      },
      logger
    )

    const first = controller.request()
    const second = controller.request()
    release()

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(calls).toEqual(['prepare', 'preview', 'restore', 'pause'])
  })

  it.each([
    ['a failed', restoreOutcome({ status: 'failed' })],
    ['a partial', restoreOutcome({ status: 'partialFailure' })],
    ['a deferred', restoreOutcome({ deferredDisplayIds: ['display:one'] })]
  ])('does not pause display control after %s restore', async (_label, outcome) => {
    const pauseAfterRestore = vi.fn(() => Promise.resolve())
    const events: StructuredLogEvent[] = []
    const controller = new EmergencyRestoreController(
      { dispose: () => Promise.resolve() },
      { restoreBaseline: () => Promise.resolve(outcome) },
      { prepareRestore: () => pauseAfterRestore },
      { write: (event) => events.push(event) }
    )

    await expect(controller.request()).resolves.toBe(false)

    expect(pauseAfterRestore).not.toHaveBeenCalled()
    expect(events).toMatchObject([
      { level: 'critical', eventName: 'EmergencyRestoreCompleted', restored: false }
    ])
  })

  it('does not pause display control when the emergency restore throws', async () => {
    const pauseAfterRestore = vi.fn(() => Promise.resolve())
    const events: StructuredLogEvent[] = []
    const controller = new EmergencyRestoreController(
      { dispose: () => Promise.resolve() },
      { restoreBaseline: () => Promise.reject(new Error('Service unavailable.')) },
      { prepareRestore: () => pauseAfterRestore },
      { write: (event) => events.push(event) }
    )

    await expect(controller.request()).resolves.toBe(false)

    expect(pauseAfterRestore).not.toHaveBeenCalled()
    expect(events).toMatchObject([
      { level: 'critical', eventName: 'EmergencyRestoreFailed', message: 'Service unavailable.' }
    ])
  })

  it('keeps a confirmed emergency restore successful when entering Paused fails', async () => {
    const events: StructuredLogEvent[] = []
    const controller = new EmergencyRestoreController(
      { dispose: () => Promise.resolve() },
      { restoreBaseline: () => Promise.resolve(restoreOutcome()) },
      { prepareRestore: () => () => Promise.reject(new Error('Settings write failed.')) },
      { write: (event) => events.push(event) }
    )

    await expect(controller.request()).resolves.toBe(true)

    expect(events).toMatchObject([
      { eventName: 'EmergencyRestoreCompleted', restored: true },
      { level: 'error', eventName: 'EmergencyRestorePauseFailed', message: 'Settings write failed.' }
    ])
  })

  it('still restores when the Paused follow-up cannot be prepared', async () => {
    const restoreBaseline = vi.fn(() => Promise.resolve(restoreOutcome()))
    const events: StructuredLogEvent[] = []
    const controller = new EmergencyRestoreController(
      { dispose: () => Promise.resolve() },
      { restoreBaseline },
      {
        prepareRestore: () => {
          throw new Error('Controller unavailable.')
        }
      },
      { write: (event) => events.push(event) }
    )

    await expect(controller.request()).resolves.toBe(true)

    expect(restoreBaseline).toHaveBeenCalledOnce()
    expect(events).toMatchObject([
      { level: 'error', eventName: 'EmergencyRestorePauseFailed' },
      { eventName: 'EmergencyRestoreCompleted', restored: true }
    ])
  })
})
