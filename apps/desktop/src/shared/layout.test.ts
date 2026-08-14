import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  isOnAnyWorkArea,
  resolveWindowBounds
} from './layout.js'

const primary = { x: 0, y: 0, width: 2560, height: 1400 }
const secondary = { x: 2560, y: 0, width: 1920, height: 1080 }

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
