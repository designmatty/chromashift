import {
  NativeServiceError,
  type BaselineCaptureResult,
  type Display,
  type DisplayApplyResult,
  type DisplayCapabilityReport,
  type DisplayRestoreResult,
  type DisplaySettings,
  type RestoreAllResult
} from '@chromashift/native-client'
import type { NativeActivationPort } from '@main/activation-coordinator.js'
import type { PreviewNativePort } from '@main/preview-session-controller.js'

export interface NativeCall {
  operation: 'capture' | 'apply' | 'restore' | 'restoreAll'
  displayId?: string
  settings?: DisplaySettings
}

export function testDisplay(id: string, hdr = false, name = id, primary?: boolean): Display {
  return {
    id,
    name,
    windowsDisplayName: '\\\\.\\DISPLAY1',
    monitorDevicePath: `monitor:${id}`,
    manufacturer: 'TST',
    productCode: '0001',
    serialNumber: id,
    adapter: {
      id: 'adapter:test',
      name: 'Test adapter',
      vendor: 'nvidia',
      deviceId: 'PCI\\VEN_10DE'
    },
    connection: 'DisplayPort',
    primary: primary ?? id === 'display:one',
    hdr,
    advancedColorSupported: true,
    bitsPerColorChannel: 8,
    refreshRate: 144
  }
}

export function testCapabilityReport(
  displayId: string,
  saturationSupported = true
): DisplayCapabilityReport {
  const unsupported = { supported: false, provider: 'unknown' as const, reason: 'Not available' }
  const supported = { supported: true, provider: 'nvidia' as const, min: 0, max: 100, default: 50 }
  return {
    displayId,
    capabilities: {
      brightness: supported,
      contrast: unsupported,
      gamma: unsupported,
      saturation: saturationSupported ? supported : unsupported,
      hue: unsupported,
      colorTemperature: unsupported
    },
    nativeState: {
      nvidia: {
        saturation: { supported: saturationSupported, current: 50 },
        hue: { supported: false }
      },
      amd: {
        brightness: { supported: false },
        contrast: { supported: false },
        saturation: { supported: false },
        hue: { supported: false },
        colorTemperature: { supported: false }
      }
    }
  }
}

/**
 * A typical NVIDIA display in SDR: Windows ramp brightness, contrast and gamma,
 * NVIDIA saturation and hue. The fake derives its HDR report from this.
 */
export function nvidiaCapabilityReport(
  displayId: string,
  vibranceAndHue = true
): DisplayCapabilityReport {
  const windows = { supported: true, provider: 'windows' as const, min: 0, max: 100, default: 50 }
  const nvidia = { supported: true, provider: 'nvidia' as const, min: 0, max: 100, default: 50 }
  const unsupported = { supported: false, provider: 'unknown' as const, reason: 'Not available' }
  const report = testCapabilityReport(displayId, vibranceAndHue)
  return {
    ...report,
    capabilities: {
      brightness: windows,
      contrast: windows,
      gamma: { ...windows, min: 0.3, max: 2.8, default: 1 },
      saturation: vibranceAndHue ? nvidia : unsupported,
      hue: vibranceAndHue ? { ...nvidia, default: 0 } : unsupported,
      colorTemperature: unsupported
    }
  }
}

const sdrOnlyUnderHdr = {
  supported: false,
  provider: 'unknown' as const,
  reason: 'Windows gamma ramps are SDR-only. This control applies when HDR is off.'
}
/**
 * A typical AMD display in SDR: ADLX brightness, contrast, saturation, hue and
 * color temperature, and Windows ramp gamma (#119).
 */
export function amdCapabilityReport(displayId: string): DisplayCapabilityReport {
  const amd = { supported: true, provider: 'amd' as const, min: -100, max: 100, default: 0 }
  const report = testCapabilityReport(displayId)
  return {
    ...report,
    capabilities: {
      brightness: amd,
      contrast: { ...amd, min: 0, max: 200, default: 100 },
      gamma: { supported: true, provider: 'windows', min: 0.3, max: 2.8, default: 1 },
      saturation: { ...amd, min: 0, max: 200, default: 100 },
      hue: { ...amd, min: -30, max: 30 },
      colorTemperature: { ...amd, min: 4000, max: 10000, default: 6500 }
    }
  }
}

/**
 * Mirrors CapabilityResolver under HDR: the Windows ramp controls, including
 * gamma, are SDR-only; NVIDIA saturation and hue and AMD ADLX controls keep
 * their provider capability (#89, #122); other adapters report nothing.
 */
export function hdrCapabilityReport(
  report: DisplayCapabilityReport,
  vendor: Display['adapter']['vendor']
): DisplayCapabilityReport {
  if (vendor === 'amd') {
    const amdOnly = (capability: DisplayCapabilityReport['capabilities']['saturation']) =>
      capability.provider === 'amd'
        ? capability
        : { supported: false, provider: 'unknown' as const, reason: 'No AMD provider.' }
    return {
      ...report,
      capabilities: {
        brightness: amdOnly(report.capabilities.brightness),
        contrast: amdOnly(report.capabilities.contrast),
        gamma: sdrOnlyUnderHdr,
        saturation: amdOnly(report.capabilities.saturation),
        hue: amdOnly(report.capabilities.hue),
        colorTemperature: amdOnly(report.capabilities.colorTemperature)
      }
    }
  }
  const nvidiaOnly = (capability: DisplayCapabilityReport['capabilities']['saturation']) =>
    vendor === 'nvidia' && capability.provider === 'nvidia'
      ? capability
      : { supported: false, provider: 'unknown' as const, reason: 'No NVIDIA provider.' }
  return {
    ...report,
    capabilities: {
      brightness: sdrOnlyUnderHdr,
      contrast: sdrOnlyUnderHdr,
      gamma: sdrOnlyUnderHdr,
      saturation: nvidiaOnly(report.capabilities.saturation),
      hue: nvidiaOnly(report.capabilities.hue),
      colorTemperature: { supported: false, provider: 'unknown', reason: 'No verified provider.' }
    }
  }
}

/**
 * The one fake for the native display seam, satisfying both consumer ports
 * (activation's NativeActivationPort and preview's PreviewNativePort). It
 * simulates baseline capture state, HDR, disconnects, per-display failures,
 * and concurrency, so tests configure knobs instead of hand-rolling adapters.
 * HDR follows the helper's #89 and #122 rules: capture is allowed, and apply
 * accepts only NVIDIA saturation and hue or AMD ADLX controls (never gamma),
 * refusing anything else before any write.
 */
export class FakeNativeDisplayPort implements NativeActivationPort, PreviewNativePort {
  public readonly calls: NativeCall[] = []
  public readonly applied: Array<{ displayId: string; settings: DisplaySettings }> = []
  public readonly captured: string[] = []
  public readonly restored: string[] = []
  /** Provider state, independent of product-neutral values, for exact rollback assertions. */
  public readonly currentSettings = new Map<string, DisplaySettings>()
  public readonly baselineCaptures: Array<{ displayId: string; settings: DisplaySettings }> = []
  public readonly failApplyDisplayIds = new Set<string>()
  public readonly failRestoreDisplayIds = new Set<string>()
  public readonly failRestoreAllDisplayIds = new Set<string>()
  public readonly hdrDisplayIds = new Set<string>()
  /**
   * Displays driven by AMD. Their default report is amdCapabilityReport; under
   * HDR every ADLX control applies and gamma stays SDR-only (#122).
   */
  public readonly amdDisplayIds = new Set<string>()
  /** Displays driven by Intel: capturable, but nothing applies under HDR. */
  public readonly intelDisplayIds = new Set<string>()
  /**
   * A provider write or read-back fails after the settings reach the display.
   * The helper then restores the whole display; if that restore also fails
   * (failRestoreDisplayIds), apply reports BASELINE_RESTORE_FAILED.
   */
  public readonly failApplyWriteDisplayIds = new Set<string>()
  /**
   * A transient NVIDIA read fails at capture, so the baseline holds the ramp but
   * no NVIDIA state. Like the helper, an HDR saturation/hue apply against that
   * baseline is refused with CAPABILITY_UNSUPPORTED before any write.
   */
  public readonly captureWithoutNvidiaDisplayIds = new Set<string>()
  public readonly disconnectedDisplayIds = new Set<string>()
  public readonly disconnectOnApplyDisplayIds = new Set<string>()
  public maxConcurrentCalls = 0
  public displays: Display[]
  public reports = new Map<string, DisplayCapabilityReport>()
  public readonly gammaRanges = new Map<string, { min: number; max: number }>()
  public readonly baselineHashes = new Map<string, string>()
  readonly #capturedHashes = new Map<string, string>()
  readonly #captureModes = new Map<string, 'sdr' | 'hdr'>()
  readonly #baselinesWithoutNvidia = new Set<string>()
  readonly #capturedDisplayIds = new Set<string>()
  readonly #baselineSettings = new Map<string, DisplaySettings>()
  #activeCalls = 0

  public constructor(
    private readonly delayMs = 0,
    displays: Display[] = [
      testDisplay('display:one'),
      testDisplay('display:two'),
      testDisplay('display:three')
    ]
  ) {
    this.displays = displays
  }

  public async getDisplays(): Promise<Display[]> {
    const byId = new Map(this.displays.map((display) => [display.id, display]))
    for (const hdrId of this.hdrDisplayIds) {
      if (!byId.has(hdrId)) byId.set(hdrId, testDisplay(hdrId, true))
    }
    return [...byId.values()]
      .filter((display) => !this.disconnectedDisplayIds.has(display.id))
      .map((display) => ({
        ...display,
        adapter: this.amdDisplayIds.has(display.id)
          ? { ...display.adapter, vendor: 'amd' as const }
          : this.intelDisplayIds.has(display.id)
            ? { ...display.adapter, vendor: 'intel' as const }
            : display.adapter,
        hdr: this.hdrDisplayIds.has(display.id) || display.hdr
      }))
  }

  public getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport> {
    const report =
      this.reports.get(displayId) ??
      (this.amdDisplayIds.has(displayId)
        ? amdCapabilityReport(displayId)
        : testCapabilityReport(displayId))
    return Promise.resolve(
      this.#isHdr(displayId) ? hdrCapabilityReport(report, this.#vendor(displayId)) : report
    )
  }

  public captureBaseline(displayId: string): Promise<BaselineCaptureResult> {
    return this.#call({ operation: 'capture', displayId }, async () => {
      if (this.disconnectedDisplayIds.has(displayId)) {
        throw new NativeServiceError(
          'DISPLAY_NOT_FOUND',
          `Display not found: ${displayId}`,
          'baseline.capture',
          'test-request'
        )
      }
      const alreadyCaptured = this.#capturedDisplayIds.has(displayId)
      if (!alreadyCaptured) {
        this.#capturedHashes.set(
          displayId,
          this.baselineHashes.get(displayId) ?? `baseline:${displayId}`
        )
        this.#baselineSettings.set(displayId, { ...this.currentSettings.get(displayId) })
        this.baselineCaptures.push({
          displayId,
          settings: { ...this.currentSettings.get(displayId) }
        })
      }
      this.#capturedDisplayIds.add(displayId)
      this.captured.push(displayId)
      if (!alreadyCaptured) {
        this.#captureModes.set(displayId, this.#isHdr(displayId) ? 'hdr' : 'sdr')
        if (this.captureWithoutNvidiaDisplayIds.has(displayId))
          this.#baselinesWithoutNvidia.add(displayId)
        else this.#baselinesWithoutNvidia.delete(displayId)
      }
      return {
        displayId,
        state: alreadyCaptured ? 'alreadyCaptured' : 'captured',
        colorMode: this.#captureModes.get(displayId)!,
        gammaRampHash: this.#capturedHashes.get(displayId)!
      }
    })
  }

  public applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    return this.#call({ operation: 'apply', displayId, settings }, async () => {
      if (this.#isHdr(displayId)) {
        this.#ensureHdrApply(displayId, settings)
        if (this.#baselinesWithoutNvidia.has(displayId)) {
          throw new NativeServiceError(
            'CAPABILITY_UNSUPPORTED',
            'NVIDIA saturation is unavailable for this display.',
            'display.apply',
            'test-request'
          )
        }
      }
      if (this.disconnectOnApplyDisplayIds.delete(displayId)) {
        this.disconnectedDisplayIds.add(displayId)
      }
      if (this.disconnectedDisplayIds.has(displayId)) {
        throw new NativeServiceError(
          'DISPLAY_NOT_FOUND',
          `Display not found: ${displayId}`,
          'display.apply',
          'test-request'
        )
      }
      if (this.failApplyDisplayIds.has(displayId)) {
        throw new NativeServiceError(
          'CAPABILITY_UNSUPPORTED',
          `Unsupported on ${displayId}`,
          'display.apply',
          'test-request'
        )
      }
      const range = this.gammaRanges.get(displayId)
      const requestedGamma = settings.gamma
      const acceptedGamma =
        requestedGamma === undefined || range === undefined
          ? requestedGamma
          : Math.max(range.min, Math.min(range.max, requestedGamma))
      const learnedGammaLimit =
        acceptedGamma !== requestedGamma
          ? {
              end: requestedGamma! > 1 ? ('max' as const) : ('min' as const),
              value: acceptedGamma!,
              brightness: settings.brightness ?? 50,
              colorMode: 'sdr' as const,
              baselineHash: this.#capturedHashes.get(displayId)!
            }
          : undefined
      settings = acceptedGamma === undefined ? settings : { ...settings, gamma: acceptedGamma }
      this.applied.push({ displayId, settings })
      this.currentSettings.set(displayId, { ...this.#baselineSettings.get(displayId), ...settings })
      if (this.failApplyWriteDisplayIds.has(displayId)) {
        // The helper's whole-display cleanup after a failed provider write.
        if (this.failRestoreDisplayIds.has(displayId)) {
          throw new NativeServiceError(
            'BASELINE_RESTORE_FAILED',
            `Restoration after a failed apply could not be confirmed for ${displayId}. ` +
              'The apply failed first with NVIDIA_VERIFY_FAILED.',
            'display.apply',
            'test-request'
          )
        }
        this.currentSettings.set(displayId, { ...this.#baselineSettings.get(displayId) })
        throw new NativeServiceError(
          'NVIDIA_VERIFY_FAILED',
          `NVIDIA read-back failed on ${displayId}`,
          'display.apply',
          'test-request'
        )
      }
      return { displayId, settings, applied: { gamma: acceptedGamma }, learnedGammaLimit }
    })
  }

  public restoreDisplay(displayId: string): Promise<DisplayRestoreResult> {
    return this.#call({ operation: 'restore', displayId }, async () => {
      if (this.failRestoreDisplayIds.has(displayId)) {
        throw new Error(`Restore failed on ${displayId}`)
      }
      if (this.disconnectedDisplayIds.has(displayId)) {
        throw new NativeServiceError(
          'DISPLAY_NOT_FOUND',
          `Display not found: ${displayId}`,
          'display.restore',
          'test-request'
        )
      }
      const wasCaptured = this.#capturedDisplayIds.delete(displayId)
      if (wasCaptured) {
        this.currentSettings.set(displayId, { ...this.#baselineSettings.get(displayId) })
        this.#baselineSettings.delete(displayId)
      }
      this.restored.push(displayId)
      return wasCaptured
        ? { displayId, restored: true }
        : { displayId, restored: false, reason: 'baselineNotCaptured' }
    })
  }

  public restoreAllBaselines(): Promise<RestoreAllResult> {
    return this.#call({ operation: 'restoreAll' }, async () => {
      const displays = [...this.#capturedDisplayIds].map((displayId) => {
        if (this.disconnectedDisplayIds.has(displayId)) {
          return {
            displayId,
            restored: false as const,
            code: 'DISPLAY_NOT_FOUND',
            error: `Display not found: ${displayId}`
          }
        }
        if (this.failRestoreAllDisplayIds.has(displayId)) {
          return { displayId, restored: false as const, error: `Restore failed on ${displayId}` }
        }
        this.#capturedDisplayIds.delete(displayId)
        this.currentSettings.set(displayId, { ...this.#baselineSettings.get(displayId) })
        this.#baselineSettings.delete(displayId)
        return { displayId, restored: true as const }
      })
      return { displays }
    })
  }

  #isHdr(displayId: string): boolean {
    return (
      this.hdrDisplayIds.has(displayId) ||
      this.displays.some((display) => display.id === displayId && display.hdr)
    )
  }

  #vendor(displayId: string): Display['adapter']['vendor'] {
    if (this.amdDisplayIds.has(displayId)) return 'amd'
    if (this.intelDisplayIds.has(displayId)) return 'intel'
    return this.displays.find((display) => display.id === displayId)?.adapter.vendor ?? 'nvidia'
  }

  /** The helper validates the whole HDR request before capture or any write. */
  #ensureHdrApply(displayId: string, settings: DisplaySettings): void {
    const vendor = this.#vendor(displayId)
    const sdrOnly =
      settings.gamma !== undefined ||
      (vendor !== 'amd' &&
        (settings.brightness !== undefined ||
          settings.contrast !== undefined ||
          settings.colorTemperature !== undefined))
    const empty = Object.values(settings).every((value) => value === undefined)
    if ((vendor !== 'nvidia' && vendor !== 'amd') || sdrOnly || empty)
      this.#hdrUnsafe(displayId, 'display.apply')
  }

  #hdrUnsafe(displayId: string, command: string): never {
    throw new NativeServiceError(
      'HDR_UNSAFE',
      `HDR is active on ${displayId}`,
      command,
      'test-request'
    )
  }

  async #call<T>(call: NativeCall, operation: () => Promise<T>): Promise<T> {
    this.calls.push(structuredClone(call))
    this.#activeCalls += 1
    this.maxConcurrentCalls = Math.max(this.maxConcurrentCalls, this.#activeCalls)
    try {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs))
      }
      return await operation()
    } finally {
      this.#activeCalls -= 1
    }
  }
}
