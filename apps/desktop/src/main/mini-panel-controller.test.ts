import type { BrowserWindow, Display, Rectangle } from 'electron'
import { describe, expect, it } from 'vitest'
import { MiniPanelController } from './mini-panel-controller.js'

function fakePanel() {
  let visible = false
  const calls: string[] = []
  const positions: Array<[number, number]> = []
  const panel = {
    isDestroyed: () => false,
    isVisible: () => visible,
    getSize: () => [330, 388],
    setPosition: (x: number, y: number) => { positions.push([x, y]) },
    show: () => { visible = true; calls.push('show') },
    focus: () => calls.push('focus'),
    hide: () => { visible = false; calls.push('hide') }
  } as unknown as BrowserWindow
  return { panel, calls, positions }
}

const display = {
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
} as Display

describe('MiniPanelController', () => {
  it('positions above a bottom taskbar, focuses, and toggles closed', () => {
    const { panel, calls, positions } = fakePanel()
    const controller = new MiniPanelController(
      () => panel,
      () => panel,
      () => display
    )
    const trayBounds: Rectangle = { x: 1840, y: 1040, width: 24, height: 24 }

    controller.toggle(trayBounds)
    controller.toggle(trayBounds)

    expect(positions).toEqual([[1582, 644]])
    expect(calls).toEqual(['show', 'focus', 'hide'])
  })

  it('places the panel below a top taskbar and clamps it inside the work area', () => {
    const { panel, positions } = fakePanel()
    const controller = new MiniPanelController(
      () => panel,
      () => panel,
      () => display
    )

    controller.toggle({ x: -20, y: -24, width: 24, height: 24 })

    expect(positions).toEqual([[8, 8]])
  })
})
