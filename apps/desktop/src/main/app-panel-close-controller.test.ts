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
    beginPreview: vi.fn(async () => []),
    cancelPreview: vi.fn(async () => undefined),
    confirmPreview: vi.fn(async () => undefined)
  }
  const preview = new PreviewSessionController(native, activation, vi.fn())
  const ports = {
    isExiting: () => exiting,
    closeBehavior: () => behavior,
    isDestroyed: window.isDestroyed,
    isVisible: window.isVisible,
    flushWindowState: vi.fn(),
    requestShutdown: vi.fn(),
    getPanelHideScope: () => preview.panelHideScope,
    getPanelOpenVersion: () => panels.getPanelOpenVersion('app'),
    beginPanelHide: () => panels.endPanelLifetime('app'),
    cancelForPanelHide: vi.fn(
      (reason: 'close' | 'handoff', onCancelled: () => void, scope: number) =>
        preview.cancelForPanelHide(reason, onCancelled, scope)
    ),
    notifyClosed: vi.fn(),
    waitForHandoffResponse: vi.fn(async () => undefined),
    notifyMinimized: vi.fn(),
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
    activation,
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

function holdRestore(native: FakeNativeDisplayPort): { entered: Promise<void>; release(): void } {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const restore = native.restoreDisplay.bind(native)
  vi.spyOn(native, 'restoreDisplay').mockImplementationOnce(async (id) => {
    enter()
    await gate
    return restore(id)
  })
  return { entered, release }
}

describe('AppPanelCloseController', () => {
  it('preserves the new Edit and window reopened during caption-close restoration', async () => {
    const h = setup()
    await h.start('edit')
    const gate = holdRestore(h.native)
    const closing = h.controller.handleClose(h.event)
    await gate.entered
    h.panels.openAppPanel()
    const editing = h.start('edit')
    gate.release()
    await Promise.all([closing, editing])
    expect(h.preview.state).toMatchObject({ state: 'active', kind: 'edit' })
    expect(h.native.restored).toEqual(['display:one'])
    expect(h.window.destroy).not.toHaveBeenCalled()
  })

  it('closes a reopened editor when a second explicit close arrives during the older rollback', async () => {
    const h = setup()
    await h.start('edit')
    h.panels.openMiniPanel()
    const gate = holdRestore(h.native)
    const handoff = h.controller.handleClose(h.event, 'handoff')
    await gate.entered
    h.panels.openAppPanel()
    const editing = h.start('edit')
    const closing = h.controller.handleClose(h.event)
    expect(closing).toBe(handoff)
    gate.release()
    await Promise.all([handoff, editing, closing])
    expect(h.preview.state).toEqual({ state: 'inactive' })
    expect(h.native.restored).toEqual(['display:one', 'display:one'])
    expect(h.window.destroy).toHaveBeenCalledOnce()
  })

  it('honors a second close after reopening even if no new preview has started', async () => {
    const h = setup()
    await h.start('edit')
    const gate = holdRestore(h.native)
    const first = h.controller.handleClose(h.event)
    await gate.entered
    h.panels.openAppPanel()
    const second = h.controller.handleClose(h.event)
    gate.release()
    await Promise.all([first, second])
    expect(h.native.restored).toEqual(['display:one'])
    expect(h.window.destroy).toHaveBeenCalledOnce()
  })

  it('reverts a reopened Edit on a second app-to-mini handoff during the first rollback', async () => {
    const h = setup()
    await h.start('edit')
    h.panels.openMiniPanel()
    const gate = holdRestore(h.native)
    const first = h.controller.handleClose(h.event, 'handoff')
    await gate.entered
    h.panels.openAppPanel()
    const editing = h.start('edit')
    h.panels.openMiniPanel()
    const second = h.controller.handleClose(h.event, 'handoff')
    gate.release()
    await Promise.all([first, second, editing])
    expect(h.preview.state).toEqual({ state: 'inactive' })
    expect(h.native.restored).toEqual(['display:one', 'display:one'])
    expect(h.ports.waitForHandoffResponse).toHaveBeenCalledTimes(2)
    expect(h.window.destroy).toHaveBeenCalledOnce()
    expect(h.isMiniVisible()).toBe(true)
  })

  it('coalesces two closes during restoration without another restore or release', async () => {
    const h = setup()
    await h.start('override')
    const gate = holdRestore(h.native)
    const first = h.controller.handleClose(h.event)
    await gate.entered
    const second = h.controller.handleClose(h.event)
    expect(first).toBe(second)
    gate.release()
    await Promise.all([first, second])
    expect(h.native.restored).toEqual(['display:one'])
    expect(h.window.destroy).toHaveBeenCalledOnce()
  })

  it('keeps failed restoration owned when a reopened Edit queues behind close', async () => {
    const h = setup()
    await h.start('edit')
    const gate = holdRestore(h.native)
    h.native.failRestoreDisplayIds.add('display:one')
    const closing = h.controller.handleClose(h.event)
    await gate.entered
    h.panels.openAppPanel()
    const editing = expect(h.start('edit')).rejects.toThrow('pending displays')
    const calls = h.native.calls.length
    gate.release()
    await Promise.all([closing, editing])
    expect(h.preview.state).toEqual({ state: 'restorePending', displayIds: ['display:one'] })
    expect(h.native.calls.slice(calls).filter((call) => call.operation === 'apply')).toEqual([])
    expect(h.window.destroy).not.toHaveBeenCalled()
    expect(h.ports.errors.showError).toHaveBeenCalledOnce()
  })
  it('prevents close while rollback is pending and releases only after it succeeds', async () => {
    const { controller, ports, window, event } = setup()
    let finish!: () => void
    ports.cancelForPanelHide.mockImplementationOnce(
      (_reason, onCancelled) =>
        new Promise<void>((resolve) => {
          finish = () => {
            onCancelled()
            resolve()
          }
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

  it('restores a preview admitted before close before releasing the renderer', async () => {
    const { controller, ports, native, event, start, preview, window } = setup()
    await start()
    let releaseRestore!: () => void
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve
    })
    let restoreStarted!: () => void
    const restoring = new Promise<void>((resolve) => {
      restoreStarted = resolve
    })
    const restore = native.restoreDisplay.bind(native)
    vi.spyOn(native, 'restoreDisplay').mockImplementationOnce(async (displayId) => {
      restoreStarted()
      await restoreGate
      return restore(displayId)
    })
    let releaseApply!: () => void
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve
    })
    let applyStarted!: () => void
    const applying = new Promise<void>((resolve) => {
      applyStarted = resolve
    })
    const apply = native.applyDisplaySettings.bind(native)
    vi.spyOn(native, 'applyDisplaySettings').mockImplementationOnce(async (displayId, color) => {
      applyStarted()
      await applyGate
      return apply(displayId, color)
    })

    // A replacement start first restores the existing session, then applies.
    // Closing must drain that already admitted start before renderer release.
    const starting = start('preview')
    await restoring
    const closing = controller.handleClose(event)
    releaseRestore()
    await applying
    expect(window.destroy).not.toHaveBeenCalled()
    expect(ports.notifyClosed).not.toHaveBeenCalled()
    releaseApply()
    await starting
    await closing

    expect(native.restored).toEqual(['display:one', 'display:one'])
    expect(preview.state).toEqual({ state: 'inactive' })
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('settles overlapping close controllers after renderer recovery during restoration', async () => {
    const { controller, ports, window, event, native, start, preview } = setup()
    await start()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const restoring = new Promise<void>((resolve) => {
      entered = resolve
    })
    const restore = native.restoreDisplay.bind(native)
    vi.spyOn(native, 'restoreDisplay').mockImplementationOnce(async (displayId) => {
      entered()
      await waiting
      return restore(displayId)
    })
    const first = controller.handleClose(event)
    await restoring
    window.destroy()
    const releaseReplacement = vi.fn()
    const recovered = new AppPanelCloseController({
      ...ports,
      isDestroyed: () => false,
      isVisible: () => true,
      releaseToTray: releaseReplacement
    })
    const second = recovered.handleClose({ preventDefault: vi.fn() })
    release()
    await Promise.all([first, second])
    expect(preview.state).toEqual({ state: 'inactive' })
    expect(native.restored).toEqual(['display:one'])
    expect(ports.releaseToTray).not.toHaveBeenCalled()
    expect(releaseReplacement).toHaveBeenCalledOnce()
    expect(ports.notifyClosed).toHaveBeenCalledOnce()
  })

  it('drains a start queued immediately before close with no active session', async () => {
    const { controller, event, start, preview, native, window } = setup()
    const starting = start()
    const closing = controller.handleClose(event)

    await starting
    await closing

    expect(native.restored).toEqual(['display:one'])
    expect(preview.state).toEqual({ state: 'inactive' })
    expect(window.destroy).toHaveBeenCalledOnce()
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

  it('logs an activation error after the session ends without showing restore guidance', async () => {
    const { controller, ports, activation, event, start, preview, native, window } = setup()
    await start()
    const error = new Error('Activation target is unavailable.')
    activation.cancelPreview.mockRejectedValueOnce(error)

    await controller.handleClose(event)

    expect(native.restored).toEqual(['display:one'])
    expect(preview.state).toEqual({ state: 'inactive' })
    expect(ports.errors.show).not.toHaveBeenCalled()
    expect(ports.errors.showError).not.toHaveBeenCalled()
    expect(ports.logger.write).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        eventName: 'PreviewCancelOnCloseFailed',
        reason: 'previewCancelFailed',
        message: error.message
      })
    )
    expect(window.destroy).not.toHaveBeenCalled()

    await controller.handleClose(event)
    expect(window.destroy).toHaveBeenCalledOnce()
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

    expect(ports.cancelForPanelHide).toHaveBeenCalledTimes(2)
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
      expect(native.restored).toEqual(kind !== 'inactive' ? ['display:one'] : [])
      expect(preview.state).toMatchObject({ state: 'inactive' })
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

  it('keeps a reopened app window after restoration during a mini-panel handoff', async () => {
    const { controller, ports, event, window, start, native, preview, panels, isMiniVisible } =
      setup()
    await start()
    panels.openMiniPanel()
    expect(window.isVisible()).toBe(false)
    expect(isMiniVisible()).toBe(true)
    let releaseRestore!: () => void
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve
    })
    let restoreStarted!: () => void
    const restoring = new Promise<void>((resolve) => {
      restoreStarted = resolve
    })
    const restore = native.restoreDisplay.bind(native)
    vi.spyOn(native, 'restoreDisplay').mockImplementationOnce(async (displayId) => {
      restoreStarted()
      await restoreGate
      return restore(displayId)
    })

    // The hidden window's delayed close has fired, but rollback is not done.
    const closing = controller.handleClose(event, 'handoff')
    await restoring
    panels.openAppPanel()
    releaseRestore()
    await closing

    expect(preview.state).toEqual({ state: 'inactive' })
    expect(window.isVisible()).toBe(true)
    expect(isMiniVisible()).toBe(false)
    expect(window.destroy).not.toHaveBeenCalled()
    expect(ports.notifyClosed).not.toHaveBeenCalled()
    expect(ports.releaseToTray).not.toHaveBeenCalled()

    await controller.handleClose(event)
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('can retry a hidden-window close after restore guidance reopens the app', async () => {
    const { controller, event, window, start, native, panels, ports } = setup()
    await start()
    panels.openMiniPanel()
    native.failRestoreDisplayIds.add('display:one')
    ports.errors.showError.mockImplementationOnce(async () => {
      native.failRestoreDisplayIds.clear()
      return 'retry'
    })

    await controller.handleClose(event)

    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('coalesces repeated close attempts while guidance is open', async () => {
    const { controller, ports, event, window } = setup()
    ports.cancelForPanelHide.mockRejectedValue(new PreviewRestoreError(['display:one: failed']))
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
    expect(ports.cancelForPanelHide).toHaveBeenCalledOnce()
    dismiss()
    await first
    expect(window.destroy).not.toHaveBeenCalled()
    expect(ports.flushWindowState).toHaveBeenCalledTimes(2)
  })

  it.each(['exiting', 'destroyed'] as const)(
    'does not release or show guidance if %s during rollback',
    async (state) => {
      const { controller, ports, event, window, setExiting } = setup()
      ports.cancelForPanelHide.mockImplementationOnce(async () => {
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
    expect(ports.cancelForPanelHide).not.toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
    expect(ports.notifyClosed).not.toHaveBeenCalled()
  })

  it('carries an override through an explicit handoff even when caption close means shutdown', async () => {
    const { controller, ports, event, start, preview, native, setShutdown, panels } = setup()
    await start('override')
    setShutdown()
    panels.openMiniPanel()

    await controller.handleClose(event, 'handoff')

    expect(ports.requestShutdown).not.toHaveBeenCalled()
    expect(ports.releaseToTray).toHaveBeenCalledOnce()
    expect(preview.state).toMatchObject({ state: 'active', kind: 'override' })
    expect(native.restored).toEqual([])
  })

  it('reverts Edit before the handoff grace period and keeps a newly reopened editor', async () => {
    const { controller, ports, event, start, preview, native, panels, window } = setup()
    await start('edit')
    panels.openMiniPanel()
    let entered!: () => void
    const prepared = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    ports.waitForHandoffResponse.mockImplementationOnce(async () => {
      entered()
      await gate
    })
    const closing = controller.handleClose(event, 'handoff')
    await prepared
    expect(preview.state).toEqual({ state: 'inactive' })
    expect(native.restored).toEqual(['display:one'])
    expect(window.destroy).not.toHaveBeenCalled()
    panels.openAppPanel()
    await start('edit')
    release()
    await closing
    expect(preview.state).toMatchObject({ state: 'active', kind: 'edit' })
    expect(native.restored).toEqual(['display:one'])
    expect(window.destroy).not.toHaveBeenCalled()
  })

  it('honors a caption close arriving during a pending override handoff', async () => {
    const { controller, ports, event, start, preview, native } = setup()
    await start('override')
    const handoff = controller.handleClose(event, 'handoff')
    const closing = controller.handleClose(event)
    await Promise.all([handoff, closing])
    expect(preview.state).toEqual({ state: 'inactive' })
    expect(native.restored).toEqual(['display:one'])
    expect(ports.releaseToTray).toHaveBeenCalledOnce()
  })

  it('allows the native close during coordinated exit while flushing geometry', async () => {
    const { controller, ports, event, setExiting } = setup()
    setExiting()

    await controller.handleClose(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(ports.flushWindowState).toHaveBeenCalledOnce()
    expect(ports.cancelForPanelHide).not.toHaveBeenCalled()
    expect(ports.releaseToTray).not.toHaveBeenCalled()
    expect(ports.logger.write).not.toHaveBeenCalled()
  })

  it.each(['edit', 'override'] as const)('keeps %s applied on minimize', async (kind) => {
    const { controller, ports, start, preview, native } = setup()
    await start(kind)
    const state = preview.state
    const calls = [...native.calls]

    controller.handleMinimize()
    await preview.waitForIdle()

    expect(ports.notifyMinimized).toHaveBeenCalledOnce()
    expect(preview.state).toEqual(state)
    expect(native.calls).toEqual(calls)
    expect(ports.releaseToTray).not.toHaveBeenCalled()
  })
})
