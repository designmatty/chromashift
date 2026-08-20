import type { StructuredLogger } from './structured-logger.js'

export type RendererSurface = 'appPanel' | 'miniPanel'
export type RendererExitReason =
  | 'clean-exit'
  | 'abnormal-exit'
  | 'killed'
  | 'crashed'
  | 'oom'
  | 'launch-failed'
  | 'integrity-failure'

export class RendererRecoveryController {
  readonly #attempts = new Map<RendererSurface, number[]>()

  public constructor(
    private readonly logger: StructuredLogger,
    private readonly maximumAttempts = 3,
    private readonly attemptWindowMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  public handle(
    surface: RendererSurface,
    reason: RendererExitReason,
    recreate: () => void,
    terminal: (message: string) => void
  ): void {
    if (!isRecoverable(reason)) return
    const attempts = this.#attempts.get(surface) ?? []
    const earliest = this.now() - this.attemptWindowMs
    while (attempts.length > 0 && attempts[0]! < earliest) attempts.shift()
    if (attempts.length >= this.maximumAttempts) {
      const message = `${surface} renderer failed repeatedly (${reason}); automatic recovery stopped.`
      this.logger.write({
        level: 'critical',
        eventName: 'RendererRecoveryTerminated',
        surface,
        reason,
        attempts: attempts.length,
        message
      })
      terminal(message)
      return
    }

    attempts.push(this.now())
    this.#attempts.set(surface, attempts)
    this.logger.write({
      level: 'warning',
      eventName: 'RendererRecoveryStarted',
      surface,
      reason,
      attempt: attempts.length
    })
    recreate()
  }
}

function isRecoverable(reason: RendererExitReason): boolean {
  return reason === 'crashed' || reason === 'oom' || reason === 'abnormal-exit'
}
