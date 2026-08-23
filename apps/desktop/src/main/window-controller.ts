export interface CloseEventPort {
  preventDefault(): void
}

export interface ManagedWindowPort {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  destroy(): void
  focus(): void
}

export class WindowController {
  public constructor(
    private readonly getWindow: () => ManagedWindowPort | undefined,
    private readonly createWindow: () => ManagedWindowPort,
    private readonly isExiting: () => boolean
  ) {}

  public open(): void {
    const existing = this.getWindow()
    const window = existing === undefined || existing.isDestroyed() ? this.createWindow() : existing
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  public handleClose(event: CloseEventPort, window: ManagedWindowPort): void {
    if (this.isExiting()) return
    event.preventDefault()
    window.destroy()
  }
}
