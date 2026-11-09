import type { Rectangle } from 'electron'

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

  public constructor(
    private readonly getAppWindow: () => PanelWindowPort | undefined,
    private readonly getMiniWindow: () => PanelWindowPort | undefined,
    private readonly showAppPanel: () => void,
    private readonly hideAppPanel: (reason: PanelHideReason) => void,
    private readonly showMiniPanel: (anchorBounds?: Rectangle) => void,
    private readonly hideMiniPanel: () => void,
    initialPanel: PanelKind = 'mini',
    private readonly preview?: PanelPreviewPort
  ) {
    this.#lastOpened = initialPanel
  }

  public openAppPanel(): void {
    this.hideMiniPanel()
    this.#lastOpened = 'app'
    this.showAppPanel()
  }

  public openMiniPanel(anchorBounds?: Rectangle): void {
    this.hideAppPanel('handoff')
    this.#lastOpened = 'mini'
    this.showMiniPanel(anchorBounds)
  }

  /** The close control and Escape share the same main-owned rollback. */
  public async closeMiniPanel(): Promise<void> {
    if (this.preview === undefined) this.hideMiniPanel()
    else await this.preview.cancelForPanelHide('close', () => this.hideMiniPanel())
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
    if (platform !== 'win32') this.hideMiniPanel()
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
