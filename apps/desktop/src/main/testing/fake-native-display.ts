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
 * The one fake for the native display seam, satisfying both consumer ports
 * (activation's NativeActivationPort and preview's PreviewNativePort). It
 * simulates baseline capture state, HDR, disconnects, per-display failures,
 * and concurrency, so tests configure knobs instead of hand-rolling adapters.
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
  public readonly disconnectedDisplayIds = new Set<string>()
  public readonly disconnectOnApplyDisplayIds = new Set<string>()
  public maxConcurrentCalls = 0
  public displays: Display[]
  public reports = new Map<string, DisplayCapabilityReport>()
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
      .map((display) => ({ ...display, hdr: this.hdrDisplayIds.has(display.id) || display.hdr }))
  }

  public getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport> {
    return Promise.resolve(this.reports.get(displayId) ?? testCapabilityReport(displayId))
  }

  public captureBaseline(displayId: string): Promise<BaselineCaptureResult> {
    return this.#call({ operation: 'capture', displayId }, async () => {
      this.#ensureSdr(displayId, 'baseline.capture')
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
        this.#baselineSettings.set(displayId, { ...this.currentSettings.get(displayId) })
        this.baselineCaptures.push({
          displayId,
          settings: { ...this.currentSettings.get(displayId) }
        })
      }
      this.#capturedDisplayIds.add(displayId)
      this.captured.push(displayId)
      return { displayId, state: alreadyCaptured ? 'alreadyCaptured' : 'captured' }
    })
  }

  public applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    return this.#call({ operation: 'apply', displayId, settings }, async () => {
      this.#ensureSdr(displayId, 'display.apply')
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
      this.applied.push({ displayId, settings })
      this.currentSettings.set(displayId, { ...this.#baselineSettings.get(displayId), ...settings })
      return { displayId, settings, applied: {} }
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

  #ensureSdr(displayId: string, command: string): void {
    if (
      this.hdrDisplayIds.has(displayId) ||
      this.displays.some((display) => display.id === displayId && display.hdr)
    ) {
      throw new NativeServiceError(
        'HDR_UNSAFE',
        `HDR is active on ${displayId}`,
        command,
        'test-request'
      )
    }
  }

  async #call<T>(call: NativeCall, operation: () => Promise<T>): Promise<T> {
    this.calls.push(call)
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
