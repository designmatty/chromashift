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
  cancelNonOverride(onCancelled: () => void): Promise<void>
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
        await this.ports.cancelNonOverride(() => {
          if (this.ports.isDestroyed() || this.ports.isExiting()) return
          // Release within the preview queue so a pending start cannot outlive
          // the renderer that requested it.
          this.ports.notifyClosed()
          this.ports.releaseToTray(event)
          this.ports.logger.write({ level: 'information', eventName: 'MainWindowReleasedToTray' })
        })
      } catch (error) {
        this.ports.logger.write({
          level: 'error',
          eventName: 'PreviewCancelOnCloseFailed',
          reason: error instanceof PreviewRestoreError ? 'previewRestoreFailed' : 'previewCancelFailed',
          ...(error instanceof PreviewRestoreError ? { failures: error.failures } : {}),
          ...describeError(error)
        })
        if (
          !(error instanceof PreviewRestoreError) ||
          this.ports.isDestroyed() ||
          this.ports.isExiting()
        ) return
        if ((await showRestoreFailureGuidance(this.ports.errors)) === 'retry') continue
        return
      }
      return
    }
  }
}
