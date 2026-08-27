import type { BrowserWindow, Display, Rectangle } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiniPanelController } from './mini-panel-controller.js'

function fakePanel() {
  let visible = false
  let destroyed = false
  let bounds = { x: 100, y: 100, width: 400, height: 596 }
  const calls: string[] = []
  const positions: Array<[number, number]> = []
  const resized: Rectangle[] = []
  const panel = {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    getSize: () => [bounds.width, bounds.height],
    getBounds: () => bounds,
    setBounds: (next: Rectangle) => {
      bounds = next
      resized.push(next)
    },
    setPosition: (x: number, y: number) => {
      positions.push([x, y])
    },
    setAlwaysOnTop: (_flag: boolean, level: string) => calls.push(`alwaysOnTop:${level}`),
    showInactive: () => {
      visible = true
      calls.push('showInactive')
    },
    moveTop: () => calls.push('moveTop'),
    hide: () => {
      visible = false
      calls.push('hide')
    },
    destroy: () => {
      destroyed = true
      calls.push('destroy')
    }
  } as unknown as BrowserWindow
  return { panel, calls, positions, resized }
}

const display = {
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
} as Display

describe('MiniPanelController', () => {
  afterEach(() => vi.useRealTimers())

  it('positions above a bottom taskbar and shows without activation', () => {
    vi.useFakeTimers()
    const { panel, calls, positions } = fakePanel()
    const controller = new MiniPanelController(
      () => panel,
      () => panel,
      () => display
    )
    const trayBounds: Rectangle = { x: 1840, y: 1040, width: 24, height: 24 }

    controller.show(trayBounds)
    controller.hide()
    vi.advanceTimersByTime(5_000)

    expect(positions).toEqual([[1512, 436]])
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

    controller.show(trayBounds)
    controller.hide()
    vi.advanceTimersByTime(1_000)
    controller.show(trayBounds)
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

    controller.show({ x: -20, y: -24, width: 24, height: 24 })

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

    controller.show({ x: 1840, y: 1040, width: 24, height: 24 })

    expect(positions).toEqual([[1512, 8]])
  })

  it('remembers a user-moved position', () => {
    const { panel } = fakePanel()
    const positions: Array<{ x: number; y: number }> = []
    const controller = new MiniPanelController(
      () => panel,
      () => panel,
      () => display,
      () => undefined,
      (position) => positions.push(position)
    )

    controller.rememberPosition({ x: 420, y: 240, width: 400, height: 596 })

    expect(positions).toEqual([{ x: 420, y: 240 }])
  })

  it('keeps the bottom edge anchored while matching each configured panel height', () => {
    const { panel, resized } = fakePanel()
    const controller = new MiniPanelController(
      () => panel,
      () => panel,
      () => display
    )

    controller.setView('override', true)
    controller.setView('picker', false)

    expect(resized).toEqual([
      { x: 100, y: 76, width: 400, height: 620 },
      { x: 100, y: 121, width: 400, height: 575 }
    ])
  })

  it('adds the light-frame height while keeping the bottom edge anchored', () => {
    const { panel, resized } = fakePanel()
    const controller = new MiniPanelController(
      () => panel,
      () => panel,
      () => display,
      () => undefined,
      () => undefined,
      () => 6
    )

    controller.setView('controls', true)

    expect(resized).toEqual([{ x: 100, y: 115, width: 400, height: 581 }])
  })

  it('shrinks controls and override views when color temperature is hidden', () => {
    const { panel, resized } = fakePanel()
    const controller = new MiniPanelController(
      () => panel,
      () => panel,
      () => display
    )

    controller.setView('controls', false)
    controller.setView('override', false)

    expect(resized).toEqual([
      { x: 100, y: 186, width: 400, height: 510 },
      { x: 100, y: 141, width: 400, height: 555 }
    ])
  })
})
