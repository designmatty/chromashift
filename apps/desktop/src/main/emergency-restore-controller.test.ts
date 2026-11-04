import { describe, expect, it, vi } from 'vitest'
import { EmergencyRestoreController } from '@main/emergency-restore-controller.js'
import type { StructuredLogger } from '@main/structured-logger.js'

const logger: StructuredLogger = { write: () => undefined }

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
          return {
            status: 'activated',
            resolution: null,
            failures: [],
            deferredDisplayIds: []
          }
        }
      },
      logger
    )

    const first = controller.request()
    const second = controller.request()
    release()

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(calls).toEqual(['preview', 'restore'])
  })

  it.each([
    { status: 'activated' as const, deferredDisplayIds: [], restored: true },
    { status: 'activated' as const, deferredDisplayIds: ['display:one'], restored: false },
    { status: 'partialFailure' as const, deferredDisplayIds: [], restored: false },
    { status: 'failed' as const, deferredDisplayIds: [], restored: false }
  ])(
    'reports restore-all $status with deferred $deferredDisplayIds after teardown fails',
    async ({ status, deferredDisplayIds, restored }) => {
      const write = vi.fn()
      const controller = new EmergencyRestoreController(
        {
          dispose: async () => {
            throw new Error('preview restore failed')
          }
        },
        {
          restoreBaseline: async () => ({
            status,
            resolution: null,
            failures: [],
            deferredDisplayIds
          })
        },
        { write }
      )

      await expect(controller.request()).resolves.toBe(restored)
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'critical',
          eventName: 'EmergencyPreviewTeardownFailed',
          message: 'preview restore failed'
        })
      )
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({
          level: restored ? 'information' : 'critical',
          eventName: 'EmergencyRestoreCompleted',
          restored,
          deferredDisplayIds
        })
      )
    }
  )

  it('reports failure and allows retry when restore-all throws after teardown fails', async () => {
    const write = vi.fn()
    const restoreBaseline = vi.fn().mockRejectedValue(new Error('restore-all failed'))
    const controller = new EmergencyRestoreController(
      {
        dispose: async () => {
          throw new Error('preview restore failed')
        }
      },
      { restoreBaseline },
      { write }
    )

    await expect(controller.request()).resolves.toBe(false)
    await expect(controller.request()).resolves.toBe(false)
    expect(restoreBaseline).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'critical',
        eventName: 'EmergencyRestoreFailed',
        message: 'restore-all failed'
      })
    )
  })
})
