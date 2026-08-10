import type { ColorProfile } from '@chromashift/core'
import type {
  BaselineCaptureResult,
  Display,
  DisplayApplyResult,
  DisplayCapabilityReport,
  DisplaySettings
} from '@chromashift/native-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PreviewSessionController,
  PreviewValidationError,
  type PreviewActivationPort,
  type PreviewNativePort
} from './preview-session-controller.js'

const display: Display = {
  id: 'display:one',
  name: 'Test display',
  windowsDisplayName: '\\\\.\\DISPLAY1',
  monitorDevicePath: 'monitor-path',
  manufacturer: 'TEST',
  productCode: '1234',
  serialNumber: '5678',
  adapter: { id: 'adapter:one', name: 'Test GPU', vendor: 'nvidia', deviceId: 'device' },
  connection: 'DisplayPort',
  primary: true,
  hdr: false,
  advancedColorSupported: true,
  bitsPerColorChannel: 8,
  refreshRate: 144
}

function report(saturationSupported = true): DisplayCapabilityReport {
  const unsupported = { supported: false, provider: 'unknown' as const, reason: 'Not available' }
  return {
    displayId: display.id,
    capabilities: {
      brightness: unsupported,
      contrast: unsupported,
      gamma: unsupported,
      saturation: saturationSupported
        ? { supported: true, provider: 'nvidia', min: 0, max: 100, default: 50 }
        : unsupported,
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

class FakeNative implements PreviewNativePort {
  public readonly applied: Array<{ displayId: string; settings: DisplaySettings }> = []
  public capabilityReport = report()

  public getDisplays(): Promise<Display[]> { return Promise.resolve([display]) }
  public getDisplayCapabilityReport(): Promise<DisplayCapabilityReport> {
    return Promise.resolve(this.capabilityReport)
  }
  public captureBaseline(displayId: string): Promise<BaselineCaptureResult> {
    return Promise.resolve({ displayId, state: 'captured' })
  }
  public applyDisplaySettings(displayId: string, settings: DisplaySettings): Promise<DisplayApplyResult> {
    this.applied.push({ displayId, settings })
    return Promise.resolve({ displayId, settings, applied: {} })
  }
}

class FakeActivation implements PreviewActivationPort {
  public readonly calls: string[] = []
  public beginPreview(): Promise<void> { this.calls.push('begin'); return Promise.resolve() }
  public cancelPreview(): Promise<void> { this.calls.push('cancel'); return Promise.resolve() }
  public confirmPreview(profileId: string): Promise<void> { this.calls.push(`confirm:${profileId}`); return Promise.resolve() }
}

class DeferredApplyNative extends FakeNative {
  public applyStarted!: () => void
  public releaseApply!: () => void
  public readonly applyStartedPromise = new Promise<void>((resolve) => { this.applyStarted = resolve })
  private readonly applyReleasedPromise = new Promise<void>((resolve) => { this.releaseApply = resolve })

  public override async applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    this.applied.push({ displayId, settings })
    this.applyStarted()
    await this.applyReleasedPromise
    return { displayId, settings, applied: {} }
  }
}

function profile(color: ColorProfile['color'] = { saturation: 75 }): ColorProfile {
  return {
    id: 'gaming',
    name: 'Gaming',
    enabled: true,
    color,
    applications: [],
    displays: [{ displayId: display.id }]
  }
}

afterEach(() => vi.useRealTimers())

describe('PreviewSessionController', () => {
  it('captures, applies, updates, and confirms a safe preview', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const states: string[] = []
    const controller = new PreviewSessionController(native, activation, (state) => states.push(state.state))

    await controller.start(profile(), 'edit')
    await controller.update('gaming', { saturation: 80 }, [display.id])
    await controller.confirm('gaming')

    expect(native.applied.map((entry) => entry.settings.saturation)).toEqual([75, 80])
    expect(activation.calls).toEqual(['begin', 'confirm:gaming'])
    expect(states).toEqual(['active', 'active', 'inactive'])
  })

  it('rejects unsupported controls before suspending normal activation', async () => {
    const native = new FakeNative()
    native.capabilityReport = report(false)
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)

    await expect(controller.start(profile(), 'preview')).rejects.toThrow(PreviewValidationError)
    expect(activation.calls).toEqual([])
    expect(native.applied).toEqual([])
  })

  it('keeps an explicit preview active until the user cancels it', async () => {
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(new FakeNative(), activation, () => undefined)
    await controller.start(profile(), 'preview')

    expect(controller.state).toMatchObject({ state: 'active', kind: 'preview' })
    await controller.cancel()

    expect(controller.state).toEqual({ state: 'inactive' })
    expect(activation.calls).toEqual(['begin', 'cancel'])
  })

  it('applies an empty update so removing the final override restores baseline state', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(
      native,
      new FakeActivation(),
      () => undefined
    )

    await controller.start(profile(), 'edit')
    await controller.update('gaming', {}, [display.id])

    expect(native.applied).toEqual([
      { displayId: display.id, settings: { saturation: 75 } },
      { displayId: display.id, settings: {} }
    ])
    expect(controller.state).toMatchObject({ state: 'active', color: {} })
  })

  it('starts an override with empty settings when the first change removes the final control', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(
      native,
      new FakeActivation(),
      () => undefined
    )

    await controller.start(profile({}), 'override')

    expect(native.applied).toEqual([{ displayId: display.id, settings: {} }])
    expect(controller.state).toMatchObject({
      state: 'active',
      kind: 'override',
      color: {}
    })
  })

  it('rolls back after an in-flight preview apply instead of allowing the apply to win the race', async () => {
    const native = new DeferredApplyNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)

    const starting = controller.start(profile(), 'edit')
    await native.applyStartedPromise
    const cancelling = controller.cancel()

    expect(activation.calls).toEqual(['begin'])
    native.releaseApply()
    await starting
    await cancelling

    expect(controller.state).toEqual({ state: 'inactive' })
    expect(activation.calls).toEqual(['begin', 'cancel'])
  })
})
