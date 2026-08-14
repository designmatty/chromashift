import type { Rectangle } from 'electron'

export interface PanelWindowPort {
  isDestroyed(): boolean
  isVisible(): boolean
}

export type PanelKind = 'app' | 'mini'

export class PanelController {
  #lastOpened: PanelKind

  public constructor(
    private readonly getAppWindow: () => PanelWindowPort | undefined,
    private readonly getMiniWindow: () => PanelWindowPort | undefined,
    private readonly showAppPanel: () => void,
    private readonly hideAppPanel: () => void,
    private readonly showMiniPanel: (anchorBounds?: Rectangle) => void,
    private readonly hideMiniPanel: () => void,
    initialPanel: PanelKind = 'mini'
  ) {
    this.#lastOpened = initialPanel
  }

  public openAppPanel(): void {
    this.hideMiniPanel()
    this.#lastOpened = 'app'
    this.showAppPanel()
  }

  public openMiniPanel(anchorBounds?: Rectangle): void {
    this.hideAppPanel()
    this.#lastOpened = 'mini'
    this.showMiniPanel(anchorBounds)
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
