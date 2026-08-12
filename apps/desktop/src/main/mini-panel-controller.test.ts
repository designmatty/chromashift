import type { BrowserWindow, Display, Rectangle } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiniPanelController } from './mini-panel-controller.js'

function fakePanel() {
  let visible = false
  let destroyed = false
  const calls: string[] = []
  const positions: Array<[number, number]> = []
  const panel = {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    getSize: () => [330, 388],
    setPosition: (x: number, y: number) => { positions.push([x, y]) },
    setAlwaysOnTop: (_flag: boolean, level: string) => calls.push(`alwaysOnTop:${level}`),
    showInactive: () => { visible = true; calls.push('showInactive') },
    moveTop: () => calls.push('moveTop'),
    hide: () => { visible = false; calls.push('hide') },
    destroy: () => {
      destroyed = true
      calls.push('destroy')
    }
  } as unknown as BrowserWindow
  return { panel, calls, positions }
}

const display = {
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
} as Display

describe('MiniPanelController', () => {
  afterEach(() => vi.useRealTimers())

  it('positions above a bottom taskbar, shows without activation, and toggles closed', () => {
    vi.useFakeTimers()
    const { panel, calls, positions } = fakePanel()
    const controller = new MiniPanelController(() => panel, () => panel, () => display)
    const trayBounds: Rectangle = { x: 1840, y: 1040, width: 24, height: 24 }

    controller.toggle(trayBounds)
    controller.toggle(trayBounds)
    vi.advanceTimersByTime(5_000)

    expect(positions).toEqual([[1582, 644]])
    expect(calls).toEqual(['alwaysOnTop:pop-up-menu', 'showInactive', 'moveTop', 'hide', 'destroy'])
  })

  it('keeps a quickly reopened panel alive', () => {
    vi.useFakeTimers()
    const { panel, calls } = fakePanel()
    const controller = new MiniPanelController(
      () => panel,
      () => panel,
      () => display
    )
    const trayBounds: Rectangle = { x: 1840, y: 1040, width: 24, height: 24 }

    controller.toggle(trayBounds)
    controller.toggle(trayBounds)
    vi.advanceTimersByTime(1_000)
    controller.toggle(trayBounds)
    vi.advanceTimersByTime(5_000)

    expect(calls).not.toContain('destroy')
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

  it('reopens at the remembered position and clamps it to a connected display', () => {
    const { panel, positions } = fakePanel()
    const controller = new MiniPanelController(
      () => panel,
      () => panel,
      () => display,
      () => ({ x: 1900, y: -100 })
    )

    controller.toggle({ x: 1840, y: 1040, width: 24, height: 24 })

    expect(positions).toEqual([[1582, 8]])
  })

  it('remembers a user-moved position', () => {
    const { panel } = fakePanel()
    const positions: Array<{ x: number, y: number }> = []
    const controller = new MiniPanelController(
      () => panel,
      () => panel,
      () => display,
      () => undefined,
      (position) => positions.push(position)
    )

    controller.rememberPosition({ x: 420, y: 240, width: 330, height: 388 })

    expect(positions).toEqual([{ x: 420, y: 240 }])
  })
})
