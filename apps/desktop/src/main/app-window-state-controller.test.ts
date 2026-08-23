import { describe, expect, it, vi } from 'vitest'
import { defaultWindowState, type WindowState } from './app-settings.js'
import {
  AppWindowStateController,
  type WindowStatePort,
  type WindowStateStorePort
} from './app-window-state-controller.js'
import type { StructuredLogger } from './structured-logger.js'

function windowState(bounds = { x: 40, y: 50, width: 1000, height: 700 }): WindowStatePort {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    isMaximized: () => false,
    getNormalBounds: () => bounds
  }
}

class MemoryWindowStateStore implements WindowStateStorePort {
  public saves = 0

  public constructor(public state: WindowState = { ...defaultWindowState }) {}

  public get current(): WindowState {
    return structuredClone(this.state)
  }

  public update(updater: (current: WindowState) => WindowState): Promise<unknown> {
    this.state = updater(this.current)
    this.saves += 1
    return Promise.resolve(this.state)
  }
}

const logger: StructuredLogger = { write: () => undefined }

describe('AppWindowStateController', () => {
  it('debounces movement and flushes the final geometry immediately', async () => {
    vi.useFakeTimers()
    const store = new MemoryWindowStateStore()
    const controller = new AppWindowStateController(
      store,
      () => [{ x: 0, y: 0, width: 1920, height: 1040 }],
      logger
    )

    controller.schedule(windowState({ x: 10, y: 10, width: 900, height: 650 }))
    controller.schedule(windowState({ x: 40, y: 50, width: 1000, height: 700 }))
    controller.flush(windowState({ x: 60, y: 70, width: 1100, height: 720 }))
    await vi.runAllTimersAsync()

    expect(store.saves).toBe(1)
    expect(store.state.windowBounds).toEqual({ x: 60, y: 70, width: 1100, height: 720 })
    vi.useRealTimers()
  })

  it('rejects transient geometry that no longer intersects a display', async () => {
    vi.useFakeTimers()
    const store = new MemoryWindowStateStore({
      ...defaultWindowState,
      windowBounds: { x: 100, y: 100, width: 1000, height: 700 }
    })
    const controller = new AppWindowStateController(
      store,
      () => [{ x: 0, y: 0, width: 1920, height: 1040 }],
      logger
    )

    controller.flush(windowState({ x: 3000, y: 100, width: 1000, height: 700 }))
    await vi.runAllTimersAsync()

    expect(store.saves).toBe(0)
    expect(store.state.windowBounds).toEqual({ x: 100, y: 100, width: 1000, height: 700 })
    vi.useRealTimers()
  })
})
