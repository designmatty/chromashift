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

interface EndpointDisplayPort {
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
      reason: [...new Set(unsupported.flatMap((capability) => capability.reason ?? []))].join('; ') ||
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

  public constructor(private readonly endpoint: EndpointDisplayPort) {}

  public async getDisplays(): Promise<Display[]> {
    return this.#groupDisplays(await this.endpoint.getDisplays())
  }

  public getForegroundApplication(): Promise<ForegroundApplication | null> {
    return this.endpoint.getForegroundApplication()
  }

  public getVisibleApplications(): Promise<ForegroundApplication[]> {
    return this.endpoint.getVisibleApplications()
  }

  public async getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport> {
    const endpoints = await this.#resolveCurrentEndpoints(displayId)
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
    const endpoints = await this.#resolveCurrentEndpoints(displayId)
    const results = [] as BaselineCaptureResult[]
    for (const display of endpoints) results.push(await this.endpoint.captureBaseline(display.id))
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
    const results = [] as DisplayApplyResult[]
    for (const display of endpoints) {
      results.push(await this.endpoint.applyDisplaySettings(display.id, settings))
    }
    return { ...results[0]!, displayId, settings }
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
          physicalId(display).toLowerCase() === normalized || display.id.toLowerCase() === normalized
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
