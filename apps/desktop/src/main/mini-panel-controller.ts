import { screen, type BrowserWindow, type Display, type Rectangle } from 'electron'

export class MiniPanelController {
  public constructor(
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly createWindow: () => BrowserWindow,
    private readonly getDisplay: (trayBounds: Rectangle) => Display = (trayBounds) =>
      screen.getDisplayNearestPoint({
        x: Math.round(trayBounds.x + trayBounds.width / 2),
        y: Math.round(trayBounds.y + trayBounds.height / 2)
      })
  ) {}

  public toggle(trayBounds: Rectangle): void {
    const panel = this.#window()
    if (panel.isVisible()) {
      panel.hide()
      return
    }
    this.#position(panel, trayBounds)
    panel.show()
    panel.focus()
  }

  public hide(): void {
    this.getWindow()?.hide()
  }

  #window(): BrowserWindow {
    const current = this.getWindow()
    return current === undefined || current.isDestroyed() ? this.createWindow() : current
  }

  #position(panel: BrowserWindow, trayBounds: Rectangle): void {
    const display = this.getDisplay(trayBounds)
    const size = panel.getSize()
    const width = size[0] ?? 330
    const height = size[1] ?? 510
    const centerX = trayBounds.x + trayBounds.width / 2
    const taskbarIsBelow = trayBounds.y > display.workArea.y + display.workArea.height / 2
    const x = Math.min(
      display.workArea.x + display.workArea.width - width - 8,
      Math.max(display.workArea.x + 8, Math.round(centerX - width / 2))
    )
    const y = taskbarIsBelow
      ? display.workArea.y + display.workArea.height - height - 8
      : display.workArea.y + 8
    panel.setPosition(x, y, false)
  }
}
