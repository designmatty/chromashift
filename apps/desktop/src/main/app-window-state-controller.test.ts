import { describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../shared/product-api.js'
import { defaultAppSettings } from './app-settings.js'
import { AppWindowStateController, type WindowStatePort } from './app-window-state-controller.js'
import type { StructuredLogger } from './structured-logger.js'

function windowState(bounds = { x: 40, y: 50, width: 1000, height: 700 }): WindowStatePort {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    isMaximized: () => false,
    getNormalBounds: () => bounds
  }
}

const logger: StructuredLogger = { write: () => undefined }

describe('AppWindowStateController', () => {
  it('debounces movement and flushes the final geometry immediately', async () => {
    vi.useFakeTimers()
    let settings = { ...defaultAppSettings }
    const saved: unknown[] = []
    const controller = new AppWindowStateController(
      () => settings,
      (next) => {
        settings = next
      },
      async (next) => {
        saved.push(next)
      },
      () => [{ x: 0, y: 0, width: 1920, height: 1040 }],
      logger
    )

    controller.schedule(windowState({ x: 10, y: 10, width: 900, height: 650 }))
    controller.schedule(windowState({ x: 40, y: 50, width: 1000, height: 700 }))
    controller.flush(windowState({ x: 60, y: 70, width: 1100, height: 720 }))
    await vi.runAllTimersAsync()

    expect(saved).toHaveLength(1)
    expect(settings.windowBounds).toEqual({ x: 60, y: 70, width: 1100, height: 720 })
    vi.useRealTimers()
  })

  it('rejects transient geometry that no longer intersects a display', async () => {
    vi.useFakeTimers()
    let settings: AppSettings = {
      ...defaultAppSettings,
      windowBounds: { x: 100, y: 100, width: 1000, height: 700 }
    }
    const save = vi.fn(async () => undefined)
    const controller = new AppWindowStateController(
      () => settings,
      (next) => {
        settings = next
      },
      save,
      () => [{ x: 0, y: 0, width: 1920, height: 1040 }],
      logger
    )

    controller.flush(windowState({ x: 3000, y: 100, width: 1000, height: 700 }))
    await vi.runAllTimersAsync()

    expect(save).not.toHaveBeenCalled()
    expect(settings.windowBounds).toEqual({ x: 100, y: 100, width: 1000, height: 700 })
    vi.useRealTimers()
  })
})
