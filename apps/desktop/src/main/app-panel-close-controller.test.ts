import { createNeutralColorSettings } from '@chromashift/core'
import { describe, expect, it, vi } from 'vitest'
import {
  AppPanelCloseController,
  type AppPanelClosePorts
} from '@main/app-panel-close-controller.js'
import { PanelController } from '@main/panel-controller.js'
import { PreviewSessionController, PreviewRestoreError } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort } from '@main/testing/fake-native-display.js'
import { WindowController } from '@main/window-controller.js'

function setup() {
  let destroyed = false
  let visible = true
  let miniVisible = false
  const window = {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(() => {
      visible = true
    }),
    focus: vi.fn(),
    destroy: vi.fn(() => {
      destroyed = true
    })
  }
  const windowController = new WindowController(
    () => window,
    () => window,
    () => exiting
  )
  const panels = new PanelController(
    () => window,
    () => ({ isDestroyed: () => false, isVisible: () => miniVisible }),
    () => windowController.open(),
    () => {
      visible = false
    },
    () => {
      miniVisible = true
    },
    () => {
      miniVisible = false
    }
  )
  let exiting = false
  let behavior: 'tray' | 'shutdown' = 'tray'
  const native = new FakeNativeDisplayPort()
  const activation = {
    beginPreview: vi.fn(async () => undefined),
    cancelPreview: vi.fn(async () => undefined),
    confirmPreview: vi.fn(async () => undefined)
  }
  const preview = new PreviewSessionController(native, activation, vi.fn())
  const ports = {
    isExiting: () => exiting,
    closeBehavior: () => behavior,
    isDestroyed: window.isDestroyed,
    flushWindowState: vi.fn(),
    requestShutdown: vi.fn(),
    cancelNonOverride: vi.fn(() => preview.cancelNonOverride()),
    notifyClosed: vi.fn(),
    releaseToTray: vi.fn((event) => windowController.handleClose(event, window)),
    errors: {
      show: vi.fn(() => panels.openAppPanel()),
      showError: vi.fn(async () => 'cancel' as 'retry' | 'cancel')
    },
    logger: { write: vi.fn() }
  } satisfies AppPanelClosePorts
  const controller = new AppPanelCloseController(ports)
  const event = { preventDefault: vi.fn() }
  const start = (kind: 'edit' | 'preview' | 'override' = 'edit') =>
    preview.start(
      {
        id: 'gaming',
        name: 'Gaming',
        enabled: true,
        applications: [],
        displays: [
          { displayId: 'display:one', color: { ...createNeutralColorSettings(), saturation: 60 } }
        ]
      },
      kind
    )
  return {
    controller,
    ports,
    window,
    preview,
    native,
    event,
    start,
    panels,
    isMiniVisible: () => miniVisible,
    setExiting: () => {
      exiting = true
    },
    setShutdown: () => {
      behavior = 'shutdown'
    }
  }
}

describe('AppPanelCloseController', () => {
  it('prevents close while rollback is pending and releases only after it succeeds', async () => {
    const { controller, ports, window, event } = setup()
    let finish!: () => void
    ports.cancelNonOverride.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )

    const closing = controller.handleClose(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(ports.flushWindowState).toHaveBeenCalledOnce()
    expect(ports.notifyClosed).not.toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
    finish()
    await closing
    expect(ports.notifyClosed).toHaveBeenCalledOnce()
    expect(ports.releaseToTray).toHaveBeenCalledOnce()
    expect(window.destroy).toHaveBeenCalledOnce()
    expect(ports.logger.write).toHaveBeenCalledWith({
      level: 'information',
      eventName: 'MainWindowReleasedToTray'
    })
  })

  it('keeps the window visible, hides the mini panel, and logs restore-failure guidance', async () => {
    const { controller, ports, window, native, event, start, panels, isMiniVisible } = setup()
    await start()
    native.failRestoreDisplayIds.add('display:one')
    panels.openMiniPanel()

    await controller.handleClose(event)

    expect(window.isVisible()).toBe(true)
    expect(isMiniVisible()).toBe(false)
    expect(window.focus).toHaveBeenCalledOnce()
    expect(window.destroy).not.toHaveBeenCalled()
    expect(ports.notifyClosed).not.toHaveBeenCalled()
    expect(ports.releaseToTray).not.toHaveBeenCalled()
    expect(ports.errors.showError).toHaveBeenCalledWith(
      'Display settings need attention',
      expect.stringContaining('try again now')
    )
    expect(ports.logger.write).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        eventName: 'PreviewCancelOnCloseFailed',
        reason: 'previewRestoreFailed',
        failures: [expect.stringContaining('display:one')]
      })
    )
    expect(ports.logger.write).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'MainWindowReleasedToTray' })
    )
  })

  it('retries the actual failed restore on a later close, then releases the renderer', async () => {
    const { controller, ports, window, native, event, start } = setup()
    await start()
    native.failRestoreDisplayIds.add('display:one')
    await controller.handleClose(event)
    await controller.handleClose(event)
    expect(window.destroy).not.toHaveBeenCalled()
    expect(ports.errors.showError).toHaveBeenCalledTimes(2)

    native.failRestoreDisplayIds.clear()
    await controller.handleClose(event)

    expect(native.calls.filter((call) => call.operation === 'restore')).toHaveLength(3)
    expect(native.restored).toEqual(['display:one'])
    expect(window.destroy).toHaveBeenCalledOnce()
    expect(ports.flushWindowState).toHaveBeenCalledTimes(3)
  })

  it('supports Try again from the shared guidance', async () => {
    const { controller, ports, native, event, start, window } = setup()
    await start()
    native.failRestoreDisplayIds.add('display:one')
    ports.errors.showError.mockImplementationOnce(async () => {
      native.failRestoreDisplayIds.clear()
      return 'retry'
    })

    await controller.handleClose(event)

    expect(ports.cancelNonOverride).toHaveBeenCalledTimes(2)
    expect(native.restored).toEqual(['display:one'])
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it.each(['edit', 'preview', 'override', 'inactive'] as const)(
    'releases after a successful close with %s',
    async (kind) => {
      const { controller, ports, window, native, event, start, preview } = setup()
      if (kind !== 'inactive') await start(kind)

      await controller.handleClose(event)

      expect(window.destroy).toHaveBeenCalledOnce()
      expect(ports.errors.showError).not.toHaveBeenCalled()
      expect(native.restored).toEqual(kind === 'edit' || kind === 'preview' ? ['display:one'] : [])
      expect(preview.state).toMatchObject(
        kind === 'override' ? { state: 'active', kind: 'override' } : { state: 'inactive' }
      )
    }
  )

  it.each(['disconnected', 'hdr'] as const)(
    'releases when teardown retains a %s baseline',
    async (reason) => {
      const { controller, ports, native, event, start, window } = setup()
      await start()
      if (reason === 'disconnected') native.disconnectedDisplayIds.add('display:one')
      else native.hdrDisplayIds.add('display:one')

      await controller.handleClose(event)

      expect(window.destroy).toHaveBeenCalledOnce()
      expect(ports.errors.showError).not.toHaveBeenCalled()
    }
  )

  it('coalesces repeated close attempts while guidance is open', async () => {
    const { controller, ports, event, window } = setup()
    ports.cancelNonOverride.mockRejectedValue(new PreviewRestoreError(['display:one: failed']))
    let dismiss!: () => void
    const opened = new Promise<void>((resolve) => {
      ports.errors.showError.mockImplementationOnce(() => {
        resolve()
        return new Promise<'cancel'>((resolve) => {
          dismiss = () => resolve('cancel')
        })
      })
    })
    const first = controller.handleClose(event)
    await opened
    const second = controller.handleClose(event)
    expect(first).toBe(second)
    expect(ports.errors.showError).toHaveBeenCalledOnce()
    expect(ports.cancelNonOverride).toHaveBeenCalledOnce()
    dismiss()
    await first
    expect(window.destroy).not.toHaveBeenCalled()
    expect(ports.flushWindowState).toHaveBeenCalledTimes(2)
  })

  it.each(['exiting', 'destroyed'] as const)(
    'does not release or show guidance if %s during rollback',
    async (state) => {
      const { controller, ports, event, window, setExiting } = setup()
      ports.cancelNonOverride.mockImplementationOnce(async () => {
        if (state === 'exiting') setExiting()
        else window.destroy()
        throw new PreviewRestoreError(['display:one: failed'])
      })

      await controller.handleClose(event)

      expect(ports.releaseToTray).not.toHaveBeenCalled()
      expect(ports.errors.showError).not.toHaveBeenCalled()
    }
  )

  it('routes shutdown-mode close to the shutdown coordinator without cancelling preview', async () => {
    const { controller, ports, event, window, setShutdown } = setup()
    setShutdown()

    await controller.handleClose(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(ports.flushWindowState).toHaveBeenCalledOnce()
    expect(ports.requestShutdown).toHaveBeenCalledOnce()
    expect(ports.cancelNonOverride).not.toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
    expect(ports.notifyClosed).not.toHaveBeenCalled()
  })

  it('allows the native close during coordinated exit while flushing geometry', async () => {
    const { controller, ports, event, setExiting } = setup()
    setExiting()

    await controller.handleClose(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(ports.flushWindowState).toHaveBeenCalledOnce()
    expect(ports.cancelNonOverride).not.toHaveBeenCalled()
    expect(ports.releaseToTray).not.toHaveBeenCalled()
    expect(ports.logger.write).not.toHaveBeenCalled()
  })
})
