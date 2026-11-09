import { createNeutralColorSettings } from '@chromashift/core'
import { describe, expect, it, vi } from 'vitest'
import {
  AppPanelCloseController,
  type AppPanelClosePorts
} from '@main/app-panel-close-controller.js'
import { PanelController } from '@main/panel-controller.js'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort } from '@main/testing/fake-native-display.js'
import { WindowController } from '@main/window-controller.js'
import { PreviewSyncSession } from '@/features/profiles/preview-sync.js'

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

describe('panel close and reopen races', () => {
  it('preserves a new editor opened during handoff rollback', async () => {
    const h = setup()
    await h.start('edit')
    h.panels.openMiniPanel()
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((r) => {
      enter = r
    })
    const gate = new Promise<void>((r) => {
      release = r
    })
    const restore = h.native.restoreDisplay.bind(h.native)
    vi.spyOn(h.native, 'restoreDisplay').mockImplementationOnce(async (id) => {
      enter()
      await gate
      return restore(id)
    })
    const closing = h.controller.handleClose(h.event, 'handoff')
    await entered
    h.panels.openAppPanel()
    const reopenedDraft = {
      id: 'gaming',
      name: 'New unsaved draft',
      enabled: true,
      applications: [],
      displays: [
        { displayId: 'display:one', color: { ...createNeutralColorSettings(), brightness: 45 } }
      ]
    }
    const newEdit = h.preview.start(reopenedDraft, 'edit', { ...reopenedDraft, name: 'Saved name' })
    release()
    await Promise.all([closing, newEdit])
    expect(h.window.isVisible()).toBe(true)
    expect(h.window.destroy).not.toHaveBeenCalled()
    expect(h.preview.state).toMatchObject({ state: 'active', kind: 'edit' })
    expect(h.preview.unsavedDraft).toEqual(reopenedDraft)
    expect(h.native.restored).toEqual(['display:one'])
  })

  it('preserves the editor opened while mini close rollback is pending', async () => {
    const h = setup()
    await h.start('override')
    let appVisible = false
    let miniVisible = true
    const panels = new PanelController(
      () => ({ isDestroyed: () => false, isVisible: () => appVisible }),
      () => ({ isDestroyed: () => false, isVisible: () => miniVisible }),
      () => {
        appVisible = true
      },
      () => {
        appVisible = false
      },
      () => {
        miniVisible = true
      },
      () => {
        miniVisible = false
      },
      'mini',
      h.preview
    )
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((r) => {
      enter = r
    })
    const gate = new Promise<void>((r) => {
      release = r
    })
    const restore = h.native.restoreDisplay.bind(h.native)
    vi.spyOn(h.native, 'restoreDisplay').mockImplementationOnce(async (id) => {
      enter()
      await gate
      return restore(id)
    })
    const closing = panels.closeMiniPanel()
    await entered
    panels.openAppPanel()
    const reopenedDraft = {
      id: 'gaming',
      name: 'New unsaved draft',
      enabled: true,
      applications: [],
      displays: [
        { displayId: 'display:one', color: { ...createNeutralColorSettings(), brightness: 45 } }
      ]
    }
    const newEdit = h.preview.start(reopenedDraft, 'edit', { ...reopenedDraft, name: 'Saved name' })
    release()
    await Promise.all([closing, newEdit])
    expect(appVisible).toBe(true)
    expect(h.preview.state).toMatchObject({ state: 'active', kind: 'edit' })
    expect(h.preview.unsavedDraft).toEqual(reopenedDraft)
    expect(h.native.restored).toEqual(['display:one'])
  })
})

it('does not apply a debounced first slider change after mini close', async () => {
  vi.useFakeTimers()
  try {
    const h = setup()
    let visible = true
    const panels = new PanelController(
      () => undefined,
      () => ({ isDestroyed: () => false, isVisible: () => visible }),
      () => undefined,
      () => undefined,
      () => {
        visible = true
      },
      () => {
        visible = false
      },
      'mini',
      h.preview
    )
    const draft = {
      id: 'gaming',
      name: 'Gaming',
      enabled: true,
      applications: [],
      displays: [
        { displayId: 'display:one', color: { ...createNeutralColorSettings(), brightness: 40 } }
      ]
    }
    panels.openMiniPanel()
    const sync = new PreviewSyncSession(
      {
        getPanelLifetime: () => panels.getPanelLifetime('mini'),
        startPreview: async (profile, kind, lifetime) => {
          panels.assertPanelLifetime('mini', lifetime!)
          await h.preview.start(profile, kind, { ...profile, displays: [] })
          return { ok: true, value: null }
        },
        updatePreview: async (id, targets, profile) => {
          await h.preview.update(id, targets, profile)
          return { ok: true, value: null }
        },
        cancelPreview: async () => {
          await h.preview.cancel()
          return { ok: true, value: null }
        }
      },
      'override',
      vi.fn()
    )
    sync.schedule(draft, h.preview.state)
    await panels.closeMiniPanel()
    expect(visible).toBe(false)
    expect(h.preview.state).toEqual({ state: 'inactive' })
    await vi.advanceTimersByTimeAsync(120)
    expect(visible).toBe(false)
    expect(h.preview.state).toEqual({ state: 'inactive' })
    expect(h.native.calls.filter((c) => c.operation === 'apply')).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

function miniHarness() {
  const h = setup()
  let miniVisible = false
  const panels = new PanelController(
    () => undefined,
    () => ({ isDestroyed: () => false, isVisible: () => miniVisible }),
    () => undefined,
    () => undefined,
    () => {
      miniVisible = true
    },
    () => {
      miniVisible = false
    },
    'mini',
    h.preview
  )
  panels.openMiniPanel()
  return { ...h, panels, isMiniVisible: () => miniVisible }
}

it('rejects the old mini debounce even when that renderer reopens before it fires', async () => {
  vi.useFakeTimers()
  try {
    const h = miniHarness()
    const draft = {
      id: 'gaming',
      name: 'Gaming',
      enabled: true,
      applications: [],
      displays: [
        { displayId: 'display:one', color: { ...createNeutralColorSettings(), brightness: 40 } }
      ]
    }
    const start = vi.fn(async (profile, kind, lifetime) => {
      h.panels.assertPanelLifetime('mini', lifetime)
      await h.preview.start(profile, kind)
      return { ok: true as const, value: null }
    })
    const sync = new PreviewSyncSession(
      {
        getPanelLifetime: () => h.panels.getPanelLifetime('mini'),
        startPreview: start,
        updatePreview: async () => {
          throw new Error('Unexpected update')
        },
        cancelPreview: async () => {
          throw new Error('Unexpected renderer cancellation')
        }
      },
      'override',
      vi.fn()
    )
    sync.schedule(draft, h.preview.state)
    const oldLifetime = h.panels.getPanelLifetime('mini')
    await h.panels.closeMiniPanel()
    h.panels.openMiniPanel()
    await vi.advanceTimersByTimeAsync(120)
    expect(h.isMiniVisible()).toBe(true)
    expect(start).toHaveBeenCalledExactlyOnceWith(draft, 'override', oldLifetime)
    expect(h.preview.state).toEqual({ state: 'inactive' })
    expect(h.native.calls).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

it('coalesces repeated mini closes and preserves the newly reopened mini session', async () => {
  const h = miniHarness()
  await h.start('override')
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const restore = h.native.restoreDisplay.bind(h.native)
  vi.spyOn(h.native, 'restoreDisplay').mockImplementationOnce(async (id) => {
    enter()
    await gate
    return restore(id)
  })
  const first = h.panels.closeMiniPanel()
  await entered
  const second = h.panels.closeMiniPanel()
  h.panels.openMiniPanel()
  const editing = h.start('override')
  release()
  await Promise.all([first, second, editing])
  expect(h.isMiniVisible()).toBe(true)
  expect(h.preview.state).toMatchObject({ state: 'active', kind: 'override' })
  expect(h.native.restored).toEqual(['display:one'])
})
