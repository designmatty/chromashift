import {
  showRestoreFailureGuidance,
  type RestoreFailureGuidancePort
} from '@main/restore-failure-guidance.js'
import { PreviewRestoreError } from '@main/preview-session-controller.js'
import { describeError, type StructuredLogger } from '@main/structured-logger.js'
import type { CloseEventPort } from '@main/window-controller.js'
import type { PanelHideReason } from '@main/panel-controller.js'

export interface AppPanelClosePorts {
  isExiting(): boolean
  closeBehavior(): 'tray' | 'shutdown'
  isDestroyed(): boolean
  isVisible(): boolean
  flushWindowState(): void
  requestShutdown(): void
  cancelForPanelHide(reason: PanelHideReason, onCancelled: () => void): Promise<void>
  waitForHandoffResponse(): Promise<void>
  notifyClosed(): void
  notifyMinimized(): void
  releaseToTray(event: CloseEventPort): void
  errors: RestoreFailureGuidancePort
  logger: StructuredLogger
}

/** One instance per app window, including its pending close and retry dialog. */
export class AppPanelCloseController {
  #pending: Promise<void> | undefined
  #reason: PanelHideReason = 'close'

  public constructor(private readonly ports: AppPanelClosePorts) {}

  public handleMinimize(): void {
    this.ports.notifyMinimized()
  }

  public handleClose(event: CloseEventPort, reason: PanelHideReason = 'close'): Promise<void> {
    this.ports.flushWindowState()
    if (this.ports.isExiting()) return Promise.resolve()
    event.preventDefault()
    if (reason === 'close' && this.ports.closeBehavior() === 'shutdown') {
      this.ports.requestShutdown()
      return Promise.resolve()
    }
    if (this.#pending !== undefined) {
      if (reason === 'close') this.#reason = 'close'
      return this.#pending
    }
    this.#reason = reason
    this.#pending = this.#closeToTray(event).finally(() => {
      this.#pending = undefined
    })
    return this.#pending
  }

  async #closeToTray(event: CloseEventPort): Promise<void> {
    let handoffPrepared = false
    while (!this.ports.isDestroyed() && !this.ports.isExiting()) {
      const reason = this.#reason
      const closingHiddenWindow = !this.ports.isVisible()
      try {
        if (reason === 'handoff' && !handoffPrepared) {
          handoffPrepared = true
          // Revert Edit immediately, even if the app reopens during the grace
          // period. Only renderer release waits for the handoff IPC response.
          await this.ports.cancelForPanelHide(reason, () => undefined)
          await this.ports.waitForHandoffResponse()
          if (this.ports.isDestroyed() || this.ports.isExiting()) return
          if (reason !== this.#reason) continue
          if (this.ports.isVisible()) return
        }
        // Always enqueue cancellation, even when a preview start is still pending.
        await this.ports.cancelForPanelHide(reason, () => {
          if (this.ports.isDestroyed() || this.ports.isExiting()) return
          // A caption close supersedes an in-flight handoff's keep-override policy.
          if (reason !== this.#reason) return
          // A mini-panel handoff closes a hidden app window. Reopening that
          // window while restoration is pending cancels its deferred release.
          if (closingHiddenWindow && this.ports.isVisible()) return
          // Release within the preview queue so a pending start cannot outlive
          // the renderer that requested it.
          this.ports.notifyClosed()
          this.ports.releaseToTray(event)
          this.ports.logger.write({ level: 'information', eventName: 'MainWindowReleasedToTray' })
        })
        if (reason !== this.#reason) continue
      } catch (error) {
        this.ports.logger.write({
          level: 'error',
          eventName: 'PreviewCancelOnCloseFailed',
          reason:
            error instanceof PreviewRestoreError ? 'previewRestoreFailed' : 'previewCancelFailed',
          ...(error instanceof PreviewRestoreError ? { failures: error.failures } : {}),
          ...describeError(error)
        })
        if (
          !(error instanceof PreviewRestoreError) ||
          this.ports.isDestroyed() ||
          this.ports.isExiting()
        )
          return
        if ((await showRestoreFailureGuidance(this.ports.errors)) === 'retry') continue
        return
      }
      return
    }
  }
}
