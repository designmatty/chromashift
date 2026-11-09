import { createHash } from 'node:crypto'
import type { LearnedGammaLimits } from '@main/learned-gamma-limits.js'
import type {
  BaselineCaptureResult,
  Capability,
  Display,
  DisplayApplyResult,
  DisplayCapabilityReport,
  DisplayRestoreResult,
  DisplaySettings,
  ForegroundApplication,
  RestoreAllResult
} from '@chromashift/native-client'

const capabilityNames = [
  'brightness',
  'contrast',
  'gamma',
  'saturation',
  'hue',
  'colorTemperature'
] as const

export interface EndpointDisplayPort {
  getDisplays(): Promise<Display[]>
  getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport>
  getForegroundApplication(): Promise<ForegroundApplication | null>
  getVisibleApplications(): Promise<ForegroundApplication[]>
  captureBaseline(displayId: string): Promise<BaselineCaptureResult>
  applyDisplaySettings(displayId: string, settings: DisplaySettings): Promise<DisplayApplyResult>
  restoreDisplay(displayId: string): Promise<DisplayRestoreResult>
  restoreAllBaselines(): Promise<RestoreAllResult>
}

class PhysicalDisplayNotFoundError extends Error {
  public readonly code = 'DISPLAY_NOT_FOUND'

  public constructor(displayId: string) {
    super(`Display not found: ${displayId}`)
    this.name = 'PhysicalDisplayNotFoundError'
  }
}

function physicalId(display: Display): string {
  return display.physicalId ?? display.id
}

function aggregateCapability(capabilities: readonly Capability[]): Capability {
  const unsupported = capabilities.filter((capability) => !capability.supported)
  if (unsupported.length > 0) {
    return {
      supported: false,
      provider: unsupported.every((capability) => capability.provider === unsupported[0]!.provider)
        ? unsupported[0]!.provider
        : 'unknown',
      reason:
        [...new Set(unsupported.flatMap((capability) => capability.reason ?? []))].join('; ') ||
        'Unavailable on one or more current connections.'
    }
  }

  const mins = capabilities.flatMap((capability) =>
    capability.min === undefined || capability.min === null ? [] : [capability.min]
  )
  const maxes = capabilities.flatMap((capability) =>
    capability.max === undefined || capability.max === null ? [] : [capability.max]
  )
  const defaults = capabilities.flatMap((capability) =>
    capability.default === undefined || capability.default === null ? [] : [capability.default]
  )
  const providers = new Set(capabilities.map((capability) => capability.provider))
  const result: Capability = {
    supported: true,
    provider: providers.size === 1 ? capabilities[0]!.provider : 'unknown'
  }
  if (mins.length === capabilities.length) result.min = Math.max(...mins)
  if (maxes.length === capabilities.length) result.max = Math.min(...maxes)
  if (defaults.length === capabilities.length && new Set(defaults).size === 1) {
    result.default = defaults[0]
  }
  return result
}

/**
 * Presents one product display per physical panel while retaining endpoint IDs
 * for native ownership and exact baseline restoration. A profile write fans out
 * to every currently active endpoint for the panel (for example DP and HDMI).
 */
export class PhysicalDisplayClient {
  readonly #physicalToEndpoints = new Map<string, Set<string>>()
  readonly #endpointToPhysical = new Map<string, string>()
  readonly #baselineHashes = new Map<string, string>()
  readonly #endpointBaselineHashes = new Map<string, string>()

  public constructor(
    private readonly endpoint: EndpointDisplayPort,
    private readonly limits?: LearnedGammaLimits
  ) {
    limits?.setDisplaySource(this)
  }

  public async getDisplays(): Promise<Display[]> {
    return this.#groupDisplays(await this.endpoint.getDisplays())
  }

  public getForegroundApplication(): Promise<ForegroundApplication | null> {
    return this.endpoint.getForegroundApplication()
  }

  public getVisibleApplications(): Promise<ForegroundApplication[]> {
    return this.endpoint.getVisibleApplications()
  }

  public forgetBaselines(): void {
    this.#baselineHashes.clear()
    this.#endpointBaselineHashes.clear()
    this.limits?.forgetAllBaselines()
  }

  public async getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport> {
    const endpoints = await this.#resolveCurrentEndpoints(displayId)
    return this.#capabilityReport(displayId, endpoints)
  }

  // One fresh enumeration for the entire scan, with no per-panel re-enumeration.
  public async getGammaLimitSupport(): Promise<Map<string, boolean>> {
    const endpoints = await this.endpoint.getDisplays()
    const support = new Map<string, boolean>()
    for (const display of this.#groupDisplays(endpoints)) {
      if (display.hdr) continue
      const report = await this.#capabilityReport(
        display.id,
        endpoints.filter(
          (endpoint) => physicalId(endpoint).toLowerCase() === display.id.toLowerCase()
        )
      )
      if (report.capabilities.gamma.supported)
        support.set(display.id.toLowerCase(), report.capabilities.brightness.supported)
    }
    return support
  }

  async #capabilityReport(
    displayId: string,
    endpoints: readonly Display[]
  ): Promise<DisplayCapabilityReport> {
    const reports = await Promise.all(
      endpoints.map((display) => this.endpoint.getDisplayCapabilityReport(display.id))
    )
    const representative = reports[0]!
    return {
      displayId,
      capabilities: Object.fromEntries(
        capabilityNames.map((name) => [
          name,
          aggregateCapability(reports.map((report) => report.capabilities[name]))
        ])
      ) as DisplayCapabilityReport['capabilities'],
      nativeState: representative.nativeState
    }
  }

  public async captureBaseline(displayId: string): Promise<BaselineCaptureResult> {
    this.limits?.forgetBaseline(displayId)
    this.#baselineHashes.delete(displayId.toLowerCase())
    const endpoints = await this.#resolveCurrentEndpoints(displayId)
    const results = [] as BaselineCaptureResult[]
    for (const display of endpoints) results.push(await this.endpoint.captureBaseline(display.id))
    for (const result of results) {
      const hash = result.gammaRampHash ?? result.amdGammaRampHash
      if (hash !== undefined) this.#endpointBaselineHashes.set(result.displayId, hash)
    }
    const hashes = results.map((result) => result.gammaRampHash ?? result.amdGammaRampHash)
    if (hashes.every((hash) => hash !== undefined)) {
      const hash = createHash('sha256').update(JSON.stringify(hashes)).digest('hex')
      this.#baselineHashes.set(displayId.toLowerCase(), hash)
      await this.limits?.observeBaseline(displayId, hash)
    }
    if (this.limits !== undefined) {
      const report = await this.#capabilityReport(displayId, endpoints)
      this.limits.observeCapabilities(
        displayId,
        endpoints.some((display) => display.hdr),
        report.capabilities
      )
    }
    return {
      ...results[0]!,
      displayId,
      state: results.every((result) => result.state === 'alreadyCaptured')
        ? 'alreadyCaptured'
        : 'captured'
    }
  }

  public async applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    const endpoints = await this.#resolveCurrentEndpoints(displayId)
    const baselineHash = this.#baselineHashes.get(displayId.toLowerCase())
    if (baselineHash !== undefined) await this.limits?.observeBaseline(displayId, baselineHash)
    const reports = await Promise.all(
      endpoints.map((display) => this.endpoint.getDisplayCapabilityReport(display.id))
    )
    const commonCapabilities = Object.fromEntries(
      capabilityNames.map((name) => [
        name,
        aggregateCapability(reports.map((report) => report.capabilities[name]))
      ])
    ) as DisplayCapabilityReport['capabilities']
    const projected = Object.fromEntries(
      capabilityNames.flatMap((name) =>
        commonCapabilities[name].supported && settings[name] !== undefined
          ? [[name, settings[name]]]
          : []
      )
    ) as DisplaySettings
    // Clamp after projection so learning and lookup use native's effective brightness.
    this.limits?.observeCapabilities(
      displayId,
      endpoints.some((display) => display.hdr),
      commonCapabilities
    )
    const clamped = this.limits?.clampSettings(displayId, projected)
    if (clamped?.gamma !== undefined) projected.gamma = clamped.gamma

    const windowsGammaProviders = (['brightness', 'contrast', 'gamma'] as const).every(
      (name) => commonCapabilities[name].provider === 'windows'
    )
    if (
      windowsGammaProviders &&
      projected.brightness === 50 &&
      projected.contrast === 50 &&
      projected.gamma === 1
    ) {
      delete projected.brightness
      delete projected.contrast
      delete projected.gamma
    }

    // A panel can have several endpoints. If a later endpoint learns a tighter
    // limit, bring earlier endpoints to the same accepted value before returning.
    let result: DisplayApplyResult | undefined
    for (let pass = 0; pass < 52; pass++) {
      let changed = false
      for (const display of endpoints) {
        result = await this.endpoint.applyDisplaySettings(display.id, projected)
        if (result.learnedGammaLimit !== undefined) {
          if (
            this.limits !== undefined &&
            result.learnedGammaLimit.baselineHash !== this.#endpointBaselineHashes.get(display.id)
          )
            throw new Error('The learned gamma limit does not match the captured baseline.')
          if (this.limits !== undefined) {
            if (baselineHash === undefined)
              throw new Error('Gamma learning requires a confirmed captured baseline.')
            await this.limits.learn(displayId, result.learnedGammaLimit, baselineHash)
          }
        }
        if (result.applied.gamma !== undefined && projected.gamma !== result.applied.gamma) {
          projected.gamma = result.applied.gamma
          changed = true
        }
      }
      if (!changed || endpoints.length === 1)
        return {
          ...result!,
          displayId,
          settings: { ...projected },
          applied: { ...result!.applied, gamma: projected.gamma }
        }
    }
    throw new Error('Gamma limits did not converge across display connections.')
  }

  public async restoreDisplay(displayId: string): Promise<DisplayRestoreResult> {
    const endpointIds = await this.#resolveKnownEndpointIds(displayId)
    const results = [] as DisplayRestoreResult[]
    let firstError: unknown
    for (const endpointId of endpointIds) {
      try {
        results.push(await this.endpoint.restoreDisplay(endpointId))
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError !== undefined) throw firstError
    const failure = results.find(
      (result) => !result.restored && result.reason !== 'baselineNotCaptured'
    )
    if (failure !== undefined) return { ...failure, displayId }
    this.#baselineHashes.delete(displayId.toLowerCase())
    this.limits?.forgetBaseline(displayId)
    const restored = results.find((result) => result.restored)
    return restored === undefined
      ? { displayId, restored: false, reason: 'baselineNotCaptured' }
      : { ...restored, displayId }
  }

  public async restoreAllBaselines(): Promise<RestoreAllResult> {
    const result = await this.endpoint.restoreAllBaselines()
    const grouped = new Map<string, DisplayRestoreResult[]>()
    for (const display of result.displays) {
      const id = this.#endpointToPhysical.get(display.displayId) ?? display.displayId
      const group = grouped.get(id) ?? []
      group.push(display)
      grouped.set(id, group)
    }
    return {
      displays: [...grouped].map(([displayId, results]) => {
        const failure = results.find(
          (result) => !result.restored && result.reason !== 'baselineNotCaptured'
        )
        if (failure !== undefined) return { ...failure, displayId }
        this.#baselineHashes.delete(displayId.toLowerCase())
        this.limits?.forgetBaseline(displayId)
        const restored = results.find((entry) => entry.restored)
        return restored === undefined
          ? { displayId, restored: false as const, reason: 'baselineNotCaptured' }
          : { ...restored, displayId }
      })
    }
  }

  async #resolveCurrentEndpoints(displayId: string): Promise<Display[]> {
    const displays = await this.endpoint.getDisplays()
    this.#remember(displays)
    const normalized = displayId.toLowerCase()
    const matches = displays.filter(
      (display) =>
        physicalId(display).toLowerCase() === normalized || display.id.toLowerCase() === normalized
    )
    if (matches.length === 0) throw new PhysicalDisplayNotFoundError(displayId)
    return matches.sort((left, right) => left.id.localeCompare(right.id))
  }

  async #resolveKnownEndpointIds(displayId: string): Promise<string[]> {
    const displays = await this.endpoint.getDisplays()
    this.#remember(displays)
    const normalized = displayId.toLowerCase()
    const current = displays
      .filter(
        (display) =>
          physicalId(display).toLowerCase() === normalized ||
          display.id.toLowerCase() === normalized
      )
      .map((display) => display.id)
    const known = new Set([...(this.#physicalToEndpoints.get(normalized) ?? []), ...current])
    if (known.size === 0) throw new PhysicalDisplayNotFoundError(displayId)
    return [...known].sort()
  }

  #groupDisplays(displays: readonly Display[]): Display[] {
    this.#remember(displays)
    const groups = new Map<string, Display[]>()
    for (const display of displays) {
      const id = physicalId(display)
      const group = groups.get(id) ?? []
      group.push(display)
      groups.set(id, group)
    }
    return [...groups].map(([id, endpoints]) => {
      const ordered = [...endpoints].sort((left, right) => {
        if (left.primary !== right.primary) return left.primary ? -1 : 1
        return left.id.localeCompare(right.id)
      })
      const representative = ordered[0]!
      const connections = [...new Set(ordered.map((display) => display.connection))].sort()
      return {
        ...representative,
        id,
        physicalId: id,
        endpointIds: ordered.map((display) => display.id),
        connection: connections.join(' + '),
        primary: ordered.some((display) => display.primary),
        hdr: ordered.some((display) => display.hdr),
        advancedColorSupported: ordered.some((display) => display.advancedColorSupported),
        bitsPerColorChannel: Math.max(...ordered.map((display) => display.bitsPerColorChannel)),
        refreshRate: Math.max(...ordered.map((display) => display.refreshRate))
      }
    })
  }

  #remember(displays: readonly Display[]): void {
    for (const display of displays) {
      const id = physicalId(display).toLowerCase()
      this.#endpointToPhysical.set(display.id, id)
      const endpoints = this.#physicalToEndpoints.get(id) ?? new Set<string>()
      endpoints.add(display.id)
      this.#physicalToEndpoints.set(id, endpoints)
    }
  }
}
