import { describe, expect, it } from 'vitest'
import { placeBubble } from './demo-tour'

const viewport = { width: 1200, height: 800 }
const bubble = { width: 300, height: 160 }

describe('tour bubble placement', () => {
  it('uses the preferred side when it fits', () => {
    const placed = placeBubble(
      { x: 800, y: 300, width: 380, height: 400 },
      bubble,
      viewport,
      'left'
    )
    expect(placed).toEqual({ side: 'left', x: 486, y: 420, arrow: 80 })
  })

  it('falls back to the opposite side', () => {
    const placed = placeBubble({ x: 20, y: 300, width: 200, height: 100 }, bubble, viewport, 'left')
    expect(placed.side).toBe('right')
    expect(placed.x).toBe(234)
  })

  it('keeps the bubble on screen and points the arrow at the target', () => {
    const placed = placeBubble({ x: 1100, y: 700, width: 80, height: 40 }, bubble, viewport, 'top')
    expect(placed.side).toBe('top')
    expect(placed.x).toBe(888)
    expect(placed.arrow).toBe(252)
  })

  it('centers near the bottom when no side fits', () => {
    const placed = placeBubble({ x: 0, y: 0, width: 1200, height: 800 }, bubble, viewport, 'left')
    expect(placed).toEqual({ side: null, x: 450, y: 628, arrow: 0 })
  })
})
