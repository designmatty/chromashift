import {
  NativeServiceCompatibilityError,
  PROTOCOL_VERSION,
  type BaselineCaptureResult,
  type Display,
  type DisplayApplyResult,
  type DisplayCapabilityReport,
  type DisplayRestoreResult,
  type DisplaySettings,
  type DisplayTopologyRefreshResult,
  type ForegroundApplication,
  type RestoreAllResult,
  type ServiceHealth,
  type SystemInfo
} from '@chromashift/native-client'
import type { EndpointDisplayPort } from '@main/physical-display-client.js'
import type { RecoverableNativeServicePort } from '@main/native-service-recovery-controller.js'
import type { StructuredLogger } from '@main/structured-logger.js'

/** Keeps offline product reads available without admitting unnegotiated display writes. */
export class NativeServiceGate implements EndpointDisplayPort, RecoverableNativeServicePort {
  #negotiated = false
  #incompatible = false
  #configurationError: string | null = null

  public constructor(
    private readonly native: EndpointDisplayPort & RecoverableNativeServicePort,
    private readonly logger: StructuredLogger
  ) {}

  public get ready(): boolean {
    return this.#negotiated && this.#configurationError === null
  }
  public get canRecover(): boolean {
    return !this.#incompatible && this.#configurationError === null
  }
  public get unavailableReason(): string | null {
    return (
      this.#configurationError ??
      (this.#incompatible
        ? 'DisplayService incompatible. Reinstall matching versions, then restart ChromaShift.'
        : this.#negotiated
          ? null
          : 'DisplayService unavailable. Check Diagnostics for details.')
    )
  }
  public get potentialBaselineDisplayIds(): readonly string[] {
    return this.native.potentialBaselineDisplayIds
  }

  public blockConfiguration(message: string): void {
    this.#configurationError = message
  }
  public disconnected(): void {
    this.#negotiated = false
  }

  public async start(): Promise<SystemInfo> {
    this.assertRecoverable()
    this.#negotiated = false
    try {
      const info = await this.native.start()
      const health = await this.native.getServiceHealth()
      if (
        info.protocolVersion !== PROTOCOL_VERSION ||
        health.protocolVersion !== PROTOCOL_VERSION ||
        info.serviceVersion !== health.serviceVersion ||
        !health.watchdogArmed
      ) {
        throw new NativeServiceCompatibilityError()
      }
      this.#negotiated = true
      this.logger.write({
        level: 'information',
        eventName: 'NativeServiceHealthVerified',
        processId: health.processId,
        serviceVersion: health.serviceVersion,
        serviceInstanceId: health.serviceInstanceId,
        baselineOwnerId: health.baselineOwnerId,
        watchdogArmed: health.watchdogArmed
      })
      return info
    } catch (error) {
      if (error instanceof NativeServiceCompatibilityError) this.#incompatible = true
      throw error
    }
  }

  public getServiceHealth(): Promise<ServiceHealth> {
    return this.native.getServiceHealth()
  }
  public async refreshDisplayTopology(): Promise<DisplayTopologyRefreshResult> {
    this.assertReady()
    return this.native.refreshDisplayTopology()
  }
  public async getDisplays(): Promise<Display[]> {
    return this.ready ? this.native.getDisplays() : []
  }
  public async getForegroundApplication(): Promise<ForegroundApplication | null> {
    return this.ready ? this.native.getForegroundApplication() : null
  }
  public async getVisibleApplications(): Promise<ForegroundApplication[]> {
    return this.ready ? this.native.getVisibleApplications() : []
  }
  public async getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport> {
    this.assertReady()
    return this.native.getDisplayCapabilityReport(displayId)
  }
  public async captureBaseline(displayId: string): Promise<BaselineCaptureResult> {
    this.assertReady()
    return this.native.captureBaseline(displayId)
  }
  public async applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    this.assertReady()
    return this.native.applyDisplaySettings(displayId, settings)
  }
  public async restoreDisplay(displayId: string): Promise<DisplayRestoreResult> {
    this.assertReady()
    return this.native.restoreDisplay(displayId)
  }
  public async restoreAllBaselines(): Promise<RestoreAllResult> {
    this.assertReady()
    return this.native.restoreAllBaselines()
  }
  public assertReady(): void {
    if (!this.ready) throw new Error(this.unavailableReason!)
  }
  private assertRecoverable(): void {
    if (!this.canRecover) throw new Error(this.unavailableReason!)
  }
}
