import type { Rectangle } from 'electron'
import { ProductConflictError } from '@main/product-controller.js'

export interface PanelWindowPort {
  isDestroyed(): boolean
  isVisible(): boolean
}

export type PanelKind = 'app' | 'mini'
export type PanelHideReason = 'close' | 'handoff'

export interface PanelPreviewPort {
  cancelForPanelHide(reason: PanelHideReason, onCancelled: () => void): Promise<void>
}

export class PanelController {
  #lastOpened: PanelKind
  #epoch = 0
  #lifetimes: Record<PanelKind, number | null> = { app: null, mini: null }
  #opened: Record<PanelKind, number> = { app: 0, mini: 0 }
  #miniClose: Promise<void> | undefined

  public constructor(
    private readonly getAppWindow: () => PanelWindowPort | undefined,
    private readonly getMiniWindow: () => PanelWindowPort | undefined,
    private readonly showAppPanel: () => void,
    private readonly hideAppPanel: (reason: PanelHideReason) => void,
    private readonly showMiniPanel: (anchorBounds?: Rectangle) => void,
    private readonly hideMiniPanel: () => void,
    initialPanel: PanelKind = 'mini',
    private readonly preview?: PanelPreviewPort,
    private readonly notifyLifetime: (panel: PanelKind, lifetime: number | null) => void = () =>
      undefined
  ) {
    this.#lastOpened = initialPanel
  }

  public openAppPanel(): void {
    this.endPanelLifetime('mini')
    this.hideMiniPanel()
    this.#openLifetime('app')
    this.#lastOpened = 'app'
    this.showAppPanel()
  }

  public openMiniPanel(anchorBounds?: Rectangle): void {
    this.endPanelLifetime('app')
    this.hideAppPanel('handoff')
    this.#openLifetime('mini')
    this.#lastOpened = 'mini'
    this.showMiniPanel(anchorBounds)
  }

  /** The close control and Escape share the same main-owned rollback. */
  public async closeMiniPanel(): Promise<void> {
    if (this.#miniClose !== undefined && this.#lifetimes.mini === null) return this.#miniClose
    if (!this.#isVisible(this.getMiniWindow())) return
    const epoch = this.#epoch
    this.endPanelLifetime('mini')
    const hide = (): void => {
      if (epoch === this.#epoch) this.hideMiniPanel()
    }
    const closing =
      this.preview === undefined
        ? Promise.resolve().then(hide)
        : this.preview.cancelForPanelHide('close', hide)
    this.#miniClose = closing
    try {
      await closing
    } finally {
      if (this.#miniClose === closing) this.#miniClose = undefined
      // A failed close keeps the panel usable for Retry and Discard.
      if (epoch === this.#epoch && this.#isVisible(this.getMiniWindow())) this.#openLifetime('mini')
    }
  }

  public endPanelLifetime(panel: PanelKind): void {
    const wasOpen = this.#lifetimes[panel] !== null
    this.#lifetimes[panel] = null
    if (wasOpen) this.notifyLifetime(panel, null)
  }

  public getPanelLifetime(panel: PanelKind): number | null {
    return this.#lifetimes[panel]
  }

  public getPanelOpenVersion(panel: PanelKind): number {
    return this.#opened[panel]
  }

  public renewPanelLifetime(panel: PanelKind, openVersion: number): void {
    if (this.#opened[panel] === openVersion) this.#openLifetime(panel)
  }

  public assertPanelLifetime(panel: PanelKind, lifetime: number): void {
    if (this.#lifetimes[panel] !== lifetime) {
      throw new ProductConflictError('This preview request belongs to an earlier panel opening.')
    }
  }

  #openLifetime(panel: PanelKind): void {
    if (this.#lifetimes[panel] === null) {
      this.#lifetimes[panel] = ++this.#epoch
      this.#opened[panel] = this.#epoch
      this.notifyLifetime(panel, this.#epoch)
    }
  }

  public async handleMiniPanelInput(
    event: { preventDefault(): void },
    input: { type: string; key: string }
  ): Promise<void> {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return
    event.preventDefault()
    await this.closeMiniPanel()
  }

  public handleMiniPanelBlur(platform: string): void {
    if (platform !== 'win32') {
      this.endPanelLifetime('mini')
      this.hideMiniPanel()
    }
  }

  public reopenLastPanel(anchorBounds: Rectangle): void {
    if (this.#isVisible(this.getAppWindow())) {
      this.openAppPanel()
      return
    }
    if (this.#isVisible(this.getMiniWindow())) {
      this.openMiniPanel(anchorBounds)
      return
    }

    if (this.#lastOpened === 'app') this.openAppPanel()
    else this.openMiniPanel(anchorBounds)
  }

  #isVisible(window: PanelWindowPort | undefined): boolean {
    return window !== undefined && !window.isDestroyed() && window.isVisible()
  }
}
