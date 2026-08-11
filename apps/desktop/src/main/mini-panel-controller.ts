import { screen, type BrowserWindow, type Display, type Rectangle } from 'electron'

export interface MiniPanelPosition {
  x: number
  y: number
}

export class MiniPanelController {
  public constructor(
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly createWindow: () => BrowserWindow,
    private readonly getDisplay: (bounds: Rectangle) => Display = (bounds) =>
      screen.getDisplayMatching(bounds),
    private readonly getRememberedPosition: () => MiniPanelPosition | undefined = () => undefined,
    private readonly saveRememberedPosition: (position: MiniPanelPosition) => void = () => undefined
  ) {}

  public toggle(trayBounds: Rectangle): void {
    const panel = this.#window()
    if (panel.isVisible()) {
      panel.hide()
      return
    }
    this.#position(panel, trayBounds)
    panel.setAlwaysOnTop(true, 'pop-up-menu')
    panel.showInactive()
    panel.moveTop()
  }

  public hide(): void {
    this.getWindow()?.hide()
  }

  public rememberPosition(bounds: Rectangle): void {
    this.saveRememberedPosition({ x: bounds.x, y: bounds.y })
  }

  #window(): BrowserWindow {
    const current = this.getWindow()
    return current === undefined || current.isDestroyed() ? this.createWindow() : current
  }

  #position(panel: BrowserWindow, trayBounds: Rectangle): void {
    const size = panel.getSize()
    const width = size[0] ?? 330
    const height = size[1] ?? 388
    const remembered = this.getRememberedPosition()
    if (remembered !== undefined) {
      const display = this.getDisplay({ ...remembered, width, height })
      panel.setPosition(
        clamp(remembered.x, display.workArea.x + 8, display.workArea.x + display.workArea.width - width - 8),
        clamp(remembered.y, display.workArea.y + 8, display.workArea.y + display.workArea.height - height - 8),
        false
      )
      return
    }

    const display = this.getDisplay(trayBounds)
    const centerX = trayBounds.x + trayBounds.width / 2
    const taskbarIsBelow = trayBounds.y > display.workArea.y + display.workArea.height / 2
    const x = clamp(
      Math.round(centerX - width / 2),
      display.workArea.x + 8,
      display.workArea.x + display.workArea.width - width - 8
    )
    const y = taskbarIsBelow
      ? display.workArea.y + display.workArea.height - height - 8
      : display.workArea.y + 8
    panel.setPosition(x, y, false)
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}
