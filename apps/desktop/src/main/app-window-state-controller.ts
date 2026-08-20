import type { AppSettings } from '../shared/product-api.js'
import { isOnAnyWorkArea, type WindowBounds, type WorkArea } from '../shared/layout.js'
import { describeError, type StructuredLogger } from './structured-logger.js'

export interface WindowStatePort {
  isDestroyed(): boolean
  isMinimized(): boolean
  isMaximized(): boolean
  getNormalBounds(): WindowBounds
}

/** Debounces geometry writes while retaining an explicit close-time flush. */
export class AppWindowStateController {
  #timer: NodeJS.Timeout | undefined

  public constructor(
    private readonly getSettings: () => AppSettings,
    private readonly setSettings: (settings: AppSettings) => void,
    private readonly saveSettings: (settings: AppSettings) => Promise<unknown>,
    private readonly getWorkAreas: () => readonly WorkArea[],
    private readonly logger: StructuredLogger,
    private readonly debounceMs = 400
  ) {}

  public schedule(window: WindowStatePort): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#captureAndSave(window)
    }, this.debounceMs)
  }

  public flush(window: WindowStatePort): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    void this.#captureAndSave(window)
  }

  public dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
  }

  async #captureAndSave(window: WindowStatePort): Promise<void> {
    if (window.isDestroyed() || window.isMinimized()) return
    const current = this.getSettings()
    const maximized = window.isMaximized()
    const bounds = maximized ? current.windowBounds : window.getNormalBounds()

    // Display notifications can briefly report old off-screen normal bounds.
    // Keep the last known-good geometry instead of persisting an unreachable window.
    if (bounds !== undefined && !isOnAnyWorkArea(bounds, this.getWorkAreas())) return
    if (
      maximized === (current.windowMaximized ?? false) &&
      bounds?.x === current.windowBounds?.x &&
      bounds?.y === current.windowBounds?.y &&
      bounds?.width === current.windowBounds?.width &&
      bounds?.height === current.windowBounds?.height
    )
      return

    const next: AppSettings = {
      ...current,
      windowMaximized: maximized,
      ...(bounds === undefined ? {} : { windowBounds: bounds })
    }
    this.setSettings(next)
    try {
      await this.saveSettings(next)
    } catch (error) {
      this.logger.write({
        level: 'warning',
        eventName: 'WindowStateSaveFailed',
        ...describeError(error)
      })
    }
  }
}
