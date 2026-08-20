import { describe, expect, it } from 'vitest'
import { EmergencyRestoreController } from './emergency-restore-controller.js'
import type { StructuredLogger } from './structured-logger.js'

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
})
