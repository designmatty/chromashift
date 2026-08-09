import { describe, expect, it, vi } from 'vitest'
import { ShutdownCoordinator } from './shutdown-coordinator.js'
import type { StructuredLogEvent, StructuredLogger } from './structured-logger.js'

class RecordingLogger implements StructuredLogger {
  public readonly events: StructuredLogEvent[] = []
  public write(event: StructuredLogEvent): void {
    this.events.push(event)
  }
}

describe('ShutdownCoordinator', () => {
  it('waits for activation, confirms native restoration, and exits once', async () => {
    const order: string[] = []
    const exit = vi.fn(() => order.push('exit'))
    const coordinator = new ShutdownCoordinator(
      { waitForIdle: () => { order.push('idle'); return Promise.resolve() } },
      { running: true, stop: () => { order.push('restore'); return Promise.resolve() } },
      { exit },
      { show: vi.fn(), showError: vi.fn() },
      new RecordingLogger()
    )

    const first = coordinator.request('tray')
    const second = coordinator.request('application')

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(order).toEqual(['idle', 'restore', 'exit'])
    expect(exit).toHaveBeenCalledWith(0)
    expect(coordinator.state).toBe('complete')
  })

  it('keeps the application alive, shows actionable guidance, and permits retry', async () => {
    const stop = vi.fn()
      .mockRejectedValueOnce(new Error('BASELINE_RESTORE_FAILED: display one'))
      .mockResolvedValueOnce(undefined)
    const exit = vi.fn()
    const show = vi.fn()
    const showError = vi.fn()
    const logger = new RecordingLogger()
    const coordinator = new ShutdownCoordinator(
      { waitForIdle: () => Promise.resolve() },
      { running: true, stop },
      { exit },
      { show, showError },
      logger
    )

    await expect(coordinator.request('tray')).resolves.toBe(false)
    expect(coordinator.state).toBe('failed')
    expect(exit).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledOnce()
    expect(showError).toHaveBeenCalledWith(
      'ChromaShift could not restore your displays',
      expect.stringContaining('use Exit to retry')
    )
    expect(logger.events).toContainEqual(
      expect.objectContaining({ eventName: 'ApplicationExitBlocked' })
    )

    await expect(coordinator.request('application')).resolves.toBe(true)
    expect(stop).toHaveBeenCalledTimes(2)
    expect(exit).toHaveBeenCalledOnce()
  })
})
