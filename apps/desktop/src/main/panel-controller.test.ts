import type { Rectangle } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { PanelController, type PanelWindowPort } from './panel-controller.js'

function panelWindow(visible: boolean): PanelWindowPort {
  return {
    isDestroyed: () => false,
    isVisible: () => visible
  }
}

const trayBounds: Rectangle = { x: 1840, y: 1040, width: 24, height: 24 }

function setup(appVisible = false, miniVisible = false, initialPanel: 'app' | 'mini' = 'mini') {
  const calls: string[] = []
  const showMiniPanel = vi.fn((bounds?: Rectangle) => {
    calls.push(`show-mini:${JSON.stringify(bounds)}`)
  })
  const controller = new PanelController(
    () => panelWindow(appVisible),
    () => panelWindow(miniVisible),
    () => calls.push('show-app'),
    () => calls.push('hide-app'),
    showMiniPanel,
    () => calls.push('hide-mini'),
    initialPanel
  )
  return { calls, controller, showMiniPanel }
}

describe('PanelController', () => {
  it('focuses the visible app panel and closes a stray mini panel on tray click', () => {
    const { calls, controller } = setup(true, true)

    controller.reopenLastPanel(trayBounds)

    expect(calls).toEqual(['hide-mini', 'show-app'])
  })

  it('raises the visible mini panel without toggling it closed', () => {
    const { calls, controller, showMiniPanel } = setup(false, true)

    controller.reopenLastPanel(trayBounds)

    expect(calls).toEqual(['hide-app', `show-mini:${JSON.stringify(trayBounds)}`])
    expect(showMiniPanel).toHaveBeenCalledWith(trayBounds)
  })

  it('reopens the most recently opened panel when both are closed', () => {
    const { calls, controller } = setup()

    controller.openAppPanel()
    calls.length = 0
    controller.reopenLastPanel(trayBounds)

    expect(calls).toEqual(['hide-mini', 'show-app'])
  })

  it('remembers the mini panel after switching away from the app panel', () => {
    const { calls, controller } = setup()

    controller.openAppPanel()
    controller.openMiniPanel()
    calls.length = 0
    controller.reopenLastPanel(trayBounds)

    expect(calls).toEqual(['hide-app', `show-mini:${JSON.stringify(trayBounds)}`])
  })

  it('uses the mini panel before either panel has been opened', () => {
    const { calls, controller } = setup()

    controller.reopenLastPanel(trayBounds)

    expect(calls).toEqual(['hide-app', `show-mini:${JSON.stringify(trayBounds)}`])
  })

  it('always hides the other panel before opening one', () => {
    const { calls, controller } = setup()

    controller.openMiniPanel()
    controller.openAppPanel()

    expect(calls).toEqual(['hide-app', 'show-mini:undefined', 'hide-mini', 'show-app'])
  })
})
