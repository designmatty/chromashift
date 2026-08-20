import {
  PROTOCOL_VERSION,
  type DisplayTopologyRefreshResult,
  type ForegroundApplication,
  type ServiceHealth,
  type SystemInfo
} from '@chromashift/native-client'
import { describeError, type StructuredLogger } from './structured-logger.js'

export interface RecoverableNativeServicePort {
  readonly potentialBaselineDisplayIds: readonly string[]
  start(): Promise<SystemInfo>
  getServiceHealth(): Promise<ServiceHealth>
  refreshDisplayTopology(): Promise<DisplayTopologyRefreshResult>
  getForegroundApplication(): Promise<ForegroundApplication | null>
}

export interface RecoverableActivationPort {
  handleNativeServiceExit(): Promise<void>
  start(application: ForegroundApplication | null): Promise<unknown>
}

export interface NativeRecoveryCallbacks {
  recovered(): void
  terminal(message: string): void
}

/**
 * Restarts only a helper that provably owned no display baseline. If an exited
 * helper may have modified output, stopping is safer than letting a new process
 * capture that output as its baseline.
 */
export class NativeServiceRecoveryController {
  readonly #attempts: number[] = []
  #recovering = false

  public constructor(
    private readonly native: RecoverableNativeServicePort,
    private readonly activation: RecoverableActivationPort,
    private readonly isShuttingDown: () => boolean,
    private readonly callbacks: NativeRecoveryCallbacks,
    private readonly logger: StructuredLogger,
    private readonly delaysMs: readonly number[] = [250, 1_000, 3_000],
    private readonly attemptWindowMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds))
  ) {}

  public async handleExit(): Promise<void> {
    await this.activation.handleNativeServiceExit()
    if (this.isShuttingDown() || this.#recovering) return

    const owned = this.native.potentialBaselineDisplayIds
    if (owned.length > 0) {
      this.#terminal(
        `DisplayService exited while owning baselines for ${owned.join(', ')}. ` +
          'Automatic restart was blocked to avoid recapturing modified output.'
      )
      return
    }

    this.#recovering = true
    try {
      for (const backoff of this.delaysMs) {
        this.#pruneAttempts()
        if (this.#attempts.length >= this.delaysMs.length) break
        this.#attempts.push(this.now())
        await this.delay(backoff)
        try {
          const info = await this.native.start()
          const health = await this.native.getServiceHealth()
          this.#validateHandshake(info, health)
          await this.native.refreshDisplayTopology()
          const foreground = await this.native.getForegroundApplication()
          await this.activation.start(foreground)
          this.logger.write({
            level: 'information',
            eventName: 'NativeServiceRecovered',
            attempt: this.#attempts.length,
            serviceInstanceId: health.serviceInstanceId,
            serviceVersion: health.serviceVersion
          })
          this.callbacks.recovered()
          return
        } catch (error) {
          this.logger.write({
            level: 'error',
            eventName: 'NativeServiceRecoveryAttemptFailed',
            attempt: this.#attempts.length,
            ...describeError(error)
          })
        }
      }
      this.#terminal('DisplayService could not be restarted after bounded recovery attempts.')
    } finally {
      this.#recovering = false
    }
  }

  #validateHandshake(info: SystemInfo, health: ServiceHealth): void {
    if (info.protocolVersion !== PROTOCOL_VERSION || health.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `DisplayService protocol mismatch: expected ${PROTOCOL_VERSION}, ` +
          `received ${info.protocolVersion}/${health.protocolVersion}.`
      )
    }
    if (info.serviceVersion !== health.serviceVersion) {
      throw new Error('DisplayService version changed between startup and health checks.')
    }
    if (health.baselineCount !== 0) {
      throw new Error('A restarted DisplayService unexpectedly reported captured baselines.')
    }
    if (!health.watchdogArmed) throw new Error('DisplayService watchdog is not armed.')
  }

  #pruneAttempts(): void {
    const earliest = this.now() - this.attemptWindowMs
    while (this.#attempts.length > 0 && this.#attempts[0]! < earliest) {
      this.#attempts.shift()
    }
  }

  #terminal(message: string): void {
    this.logger.write({
      level: 'critical',
      eventName: 'NativeServiceRecoveryTerminated',
      message
    })
    this.callbacks.terminal(message)
  }
}
