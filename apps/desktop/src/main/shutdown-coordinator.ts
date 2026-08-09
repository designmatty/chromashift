import { describeError, type StructuredLogger } from './structured-logger.js'

export interface ShutdownActivationPort {
  waitForIdle(): Promise<void>
}

export interface ShutdownNativePort {
  readonly running: boolean
  stop(): Promise<void>
}

export interface ShutdownApplicationPort {
  exit(exitCode?: number): void
}

export interface ShutdownErrorPort {
  show(): void
  showError(title: string, message: string): void
}

export type ShutdownSource = 'tray' | 'application'
export type ShutdownState = 'idle' | 'restoring' | 'failed' | 'complete'

export class ShutdownCoordinator {
  #state: ShutdownState = 'idle'
  #pending: Promise<boolean> | undefined

  public constructor(
    private readonly activation: ShutdownActivationPort,
    private readonly native: ShutdownNativePort,
    private readonly application: ShutdownApplicationPort,
    private readonly errors: ShutdownErrorPort,
    private readonly logger: StructuredLogger
  ) {}

  public get state(): ShutdownState {
    return this.#state
  }

  public get exiting(): boolean {
    return this.#state === 'restoring' || this.#state === 'complete'
  }

  public request(source: ShutdownSource): Promise<boolean> {
    if (this.#state === 'complete') return Promise.resolve(true)
    if (this.#pending !== undefined) return this.#pending

    this.#pending = this.#shutdown(source).finally(() => {
      this.#pending = undefined
    })
    return this.#pending
  }

  async #shutdown(source: ShutdownSource): Promise<boolean> {
    this.#state = 'restoring'
    this.logger.write({
      level: 'information',
      eventName: 'ApplicationExitRequested',
      source
    })

    try {
      await this.activation.waitForIdle()
      if (this.native.running) await this.native.stop()
      this.#state = 'complete'
      this.logger.write({
        level: 'information',
        eventName: 'ApplicationExiting',
        source,
        baselineRestored: true
      })
      this.application.exit(0)
      return true
    } catch (error) {
      this.#state = 'failed'
      const details = describeError(error)
      this.logger.write({
        level: 'critical',
        eventName: 'ApplicationExitBlocked',
        source,
        reason: 'baselineRestoreFailed',
        ...details
      })
      this.errors.show()
      this.errors.showError(
        'ChromaShift could not restore your displays',
        `${details.message}\n\nChromaShift is still running. Check the diagnostics window, then use Exit to retry. Do not force-close the application unless you have restored your display settings manually.`
      )
      return false
    }
  }
}
