import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_EDITOR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  isOnAnyWorkArea,
  resolveSidebarWidth,
  resolveWindowBounds,
  shouldStackPanels
} from './layout.js'

const primary = { x: 0, y: 0, width: 2560, height: 1400 }
const secondary = { x: 2560, y: 0, width: 1920, height: 1080 }

describe('sidebar sizing', () => {
  it('keeps the persisted width when both panels fit', () => {
    expect(resolveSidebarWidth(300, 1400)).toBe(300)
  })

  it('never returns less than the minimum sidebar width', () => {
    expect(resolveSidebarWidth(40, 1400)).toBe(MIN_SIDEBAR_WIDTH)
  })

  it('never returns more than the maximum sidebar width', () => {
    expect(resolveSidebarWidth(900, 2400)).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('shrinks the sidebar before the editor drops below its minimum', () => {
    const windowWidth = MIN_SIDEBAR_WIDTH + MIN_EDITOR_WIDTH + 30
    const width = resolveSidebarWidth(MAX_SIDEBAR_WIDTH, windowWidth)

    expect(width).toBe(MIN_SIDEBAR_WIDTH + 30)
    expect(windowWidth - width).toBeGreaterThanOrEqual(MIN_EDITOR_WIDTH)
  })

  it('keeps both panels usable at the supported minimum window size', () => {
    const width = resolveSidebarWidth(DEFAULT_SIDEBAR_WIDTH, MIN_WINDOW_WIDTH)

    expect(width).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(width).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH)
    expect(MIN_WINDOW_WIDTH - width).toBeGreaterThanOrEqual(MIN_EDITOR_WIDTH)
  })

  it('falls back to a usable width for corrupt persisted values', () => {
    expect(resolveSidebarWidth(Number.NaN, 1400)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})

describe('narrow-window overflow', () => {
  it('keeps both panels side by side at the supported minimum window size', () => {
    expect(shouldStackPanels(MIN_WINDOW_WIDTH)).toBe(false)
  })

  it('stacks the panels once they cannot both meet their minimums', () => {
    expect(shouldStackPanels(MIN_SIDEBAR_WIDTH + MIN_EDITOR_WIDTH - 1)).toBe(true)
  })
})

describe('window bounds recovery', () => {
  it('centers a default window when nothing is persisted', () => {
    expect(resolveWindowBounds(undefined, [primary])).toEqual({
      x: (2560 - DEFAULT_WINDOW_WIDTH) / 2,
      y: Math.round((1400 - DEFAULT_WINDOW_HEIGHT) / 2),
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT
    })
  })

  it('restores saved geometry that still intersects a connected display', () => {
    const saved = { x: 2700, y: 200, width: 1200, height: 800 }

    expect(resolveWindowBounds(saved, [primary, secondary])).toEqual(saved)
  })

  it('recenters when the saved position no longer intersects any display', () => {
    const saved = { x: 4600, y: 200, width: 1200, height: 800 }
    const recovered = resolveWindowBounds(saved, [primary])

    expect(isOnAnyWorkArea(recovered, [primary])).toBe(true)
    expect(recovered).toEqual({ x: 680, y: 300, width: 1200, height: 800 })
  })

  it('recovers a window saved on a display that has been disconnected', () => {
    const saved = { x: 3000, y: 100, width: 1000, height: 700 }

    expect(isOnAnyWorkArea(saved, [primary])).toBe(false)
    expect(isOnAnyWorkArea(resolveWindowBounds(saved, [primary]), [primary])).toBe(true)
  })

  it('enforces the supported minimum size on undersized saved geometry', () => {
    const recovered = resolveWindowBounds({ x: 10, y: 10, width: 320, height: 240 }, [primary])

    expect(recovered.width).toBe(MIN_WINDOW_WIDTH)
    expect(recovered.height).toBe(MIN_WINDOW_HEIGHT)
  })

  it('keeps saved geometry when no work areas are reported', () => {
    const saved = { x: 40, y: 40, width: 1000, height: 700 }

    expect(resolveWindowBounds(saved, [])).toEqual(saved)
  })
})
