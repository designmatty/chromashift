import {
  showRestoreFailureGuidance,
  type RestoreFailureGuidancePort
} from '@main/restore-failure-guidance.js'
import { PreviewRestoreError } from '@main/preview-session-controller.js'
import { describeError, type StructuredLogger } from '@main/structured-logger.js'
import type { CloseEventPort } from '@main/window-controller.js'

export interface AppPanelClosePorts {
  isExiting(): boolean
  closeBehavior(): 'tray' | 'shutdown'
  isDestroyed(): boolean
  flushWindowState(): void
  requestShutdown(): void
  cancelNonOverride(): Promise<void>
  notifyClosed(): void
  releaseToTray(event: CloseEventPort): void
  errors: RestoreFailureGuidancePort
  logger: StructuredLogger
}

/** One instance per app window, including its pending close and retry dialog. */
export class AppPanelCloseController {
  #pending: Promise<void> | undefined

  public constructor(private readonly ports: AppPanelClosePorts) {}

  public handleClose(event: CloseEventPort): Promise<void> {
    this.ports.flushWindowState()
    if (this.ports.isExiting()) return Promise.resolve()
    event.preventDefault()
    if (this.ports.closeBehavior() === 'shutdown') {
      this.ports.requestShutdown()
      return Promise.resolve()
    }
    if (this.#pending !== undefined) return this.#pending
    this.#pending = this.#closeToTray(event).finally(() => {
      this.#pending = undefined
    })
    return this.#pending
  }

  async #closeToTray(event: CloseEventPort): Promise<void> {
    while (!this.ports.isDestroyed() && !this.ports.isExiting()) {
      try {
        // Always enqueue cancellation, even when a preview start is still pending.
        await this.ports.cancelNonOverride()
      } catch (error) {
        this.ports.logger.write({
          level: 'error',
          eventName: 'PreviewCancelOnCloseFailed',
          reason: 'previewRestoreFailed',
          ...(error instanceof PreviewRestoreError ? { failures: error.failures } : {}),
          ...describeError(error)
        })
        if (this.ports.isDestroyed() || this.ports.isExiting()) return
        if ((await showRestoreFailureGuidance(this.ports.errors)) === 'retry') continue
        return
      }
      if (this.ports.isDestroyed() || this.ports.isExiting()) return
      // Notify only after rollback, so renderer cleanup cannot race a failed close.
      this.ports.notifyClosed()
      this.ports.releaseToTray(event)
      this.ports.logger.write({ level: 'information', eventName: 'MainWindowReleasedToTray' })
      return
    }
  }
}
