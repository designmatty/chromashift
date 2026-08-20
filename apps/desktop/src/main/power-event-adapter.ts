export type PowerTransitionEvent = 'lock' | 'unlock' | 'suspend' | 'resume'

type ElectronPowerEvent = 'lock-screen' | 'unlock-screen' | 'suspend' | 'resume'

export interface PowerMonitorPort {
  on(event: ElectronPowerEvent, listener: () => void): unknown
  off(event: ElectronPowerEvent, listener: () => void): unknown
}

/** Keeps Electron event names out of the transition coordinator and its tests. */
export class PowerEventAdapter {
  readonly #listeners = new Map<ElectronPowerEvent, () => void>()

  public constructor(private readonly source: PowerMonitorPort) {}

  public start(listener: (event: PowerTransitionEvent) => void): void {
    this.dispose()
    this.#subscribe('lock-screen', () => listener('lock'))
    this.#subscribe('unlock-screen', () => listener('unlock'))
    this.#subscribe('suspend', () => listener('suspend'))
    this.#subscribe('resume', () => listener('resume'))
  }

  public dispose(): void {
    for (const [event, listener] of this.#listeners) this.source.off(event, listener)
    this.#listeners.clear()
  }

  #subscribe(event: ElectronPowerEvent, listener: () => void): void {
    this.#listeners.set(event, listener)
    this.source.on(event, listener)
  }
}
