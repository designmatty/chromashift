import { describe, expect, it, vi } from 'vitest'
import { WindowController, type ManagedWindowPort } from './window-controller.js'

function windowPort(overrides: Partial<ManagedWindowPort> = {}): ManagedWindowPort {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    ...overrides
  }
}

describe('WindowController', () => {
  it('releases a closed renderer while the tray process remains alive', () => {
    const window = windowPort()
    const preventDefault = vi.fn()
    const controller = new WindowController(
      () => window,
      () => window,
      () => false
    )

    controller.handleClose({ preventDefault }, window)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('allows close during coordinated shutdown and restores an existing window on open', () => {
    const window = windowPort({ isMinimized: () => true })
    const preventDefault = vi.fn()
    const controller = new WindowController(
      () => window,
      () => window,
      () => true
    )

    controller.handleClose({ preventDefault }, window)
    controller.open()

    expect(preventDefault).not.toHaveBeenCalled()
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })
})
