import { screen, type BrowserWindow, type Display, type Rectangle } from 'electron'

export interface MiniPanelPosition {
  x: number
  y: number
}

export type MiniPanelView = 'controls' | 'override' | 'picker'

const MINI_PANEL_WIDTH = 400
const MINI_PANEL_HEIGHTS: Record<MiniPanelView, number> = {
  controls: 596,
  override: 642,
  picker: 335
}

export class MiniPanelController {
  #releaseTimer: ReturnType<typeof setTimeout> | undefined
  #view: MiniPanelView = 'controls'

  public constructor(
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly createWindow: () => BrowserWindow,
    private readonly getDisplay: (bounds: Rectangle) => Display = (bounds) =>
      screen.getDisplayMatching(bounds),
    private readonly getRememberedPosition: () => MiniPanelPosition | undefined = () => undefined,
    private readonly saveRememberedPosition: (position: MiniPanelPosition) => void = () =>
      undefined,
    private readonly getHeightAdjustment: () => number = () => 0,
    private readonly releaseDelayMilliseconds = 5_000
  ) {}

  public toggle(trayBounds: Rectangle): void {
    this.#cancelRelease()
    const panel = this.#window()
    if (panel.isVisible()) {
      panel.hide()
      this.#scheduleRelease(panel)
      return
    }
    this.show(trayBounds)
  }

  public show(anchorBounds?: Rectangle): void {
    this.#cancelRelease()
    const panel = this.#window()
    const anchor = anchorBounds ?? this.#cursorAnchor()
    this.#position(panel, anchor)
    panel.setAlwaysOnTop(true, 'pop-up-menu')
    panel.showInactive()
    panel.moveTop()
  }

  public setView(view: MiniPanelView): void {
    this.#view = view
    const panel = this.getWindow()
    if (panel === undefined || panel.isDestroyed()) return
    const bounds = panel.getBounds()
    const height = MINI_PANEL_HEIGHTS[view] + this.getHeightAdjustment()
    const display = this.getDisplay(bounds)
    const nextX = clamp(
      bounds.x,
      display.workArea.x + 8,
      display.workArea.x + display.workArea.width - MINI_PANEL_WIDTH - 8
    )
    const nextY = clamp(
      bounds.y + bounds.height - height,
      display.workArea.y + 8,
      display.workArea.y + display.workArea.height - height - 8
    )
    panel.setBounds({ x: nextX, y: nextY, width: MINI_PANEL_WIDTH, height }, false)
  }

  public refreshSize(): void {
    this.setView(this.#view)
  }

  public hide(): void {
    const panel = this.getWindow()
    if (panel === undefined || panel.isDestroyed()) return
    panel.hide()
    this.#scheduleRelease(panel)
  }

  public rememberPosition(bounds: Rectangle): void {
    this.saveRememberedPosition({ x: bounds.x, y: bounds.y })
  }

  #window(): BrowserWindow {
    const current = this.getWindow()
    return current === undefined || current.isDestroyed() ? this.createWindow() : current
  }

  #scheduleRelease(panel: BrowserWindow): void {
    this.#cancelRelease()
    this.#releaseTimer = setTimeout(() => {
      this.#releaseTimer = undefined
      if (!panel.isDestroyed() && !panel.isVisible()) panel.destroy()
    }, this.releaseDelayMilliseconds)
  }

  #cancelRelease(): void {
    if (this.#releaseTimer === undefined) return
    clearTimeout(this.#releaseTimer)
    this.#releaseTimer = undefined
  }

  #cursorAnchor(): Rectangle {
    const point = screen.getCursorScreenPoint()
    return { x: point.x, y: point.y, width: 1, height: 1 }
  }

  #position(panel: BrowserWindow, trayBounds: Rectangle): void {
    const size = panel.getSize()
    const width = size[0] ?? 330
    const height = size[1] ?? 388
    const remembered = this.getRememberedPosition()
    if (remembered !== undefined) {
      const display = this.getDisplay({ ...remembered, width, height })
      panel.setPosition(
        clamp(
          remembered.x,
          display.workArea.x + 8,
          display.workArea.x + display.workArea.width - width - 8
        ),
        clamp(
          remembered.y,
          display.workArea.y + 8,
          display.workArea.y + display.workArea.height - height - 8
        ),
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
