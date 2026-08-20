import type { ColorProfile, ColorSettings } from '@chromashift/core'
import { NativeServiceError } from '@chromashift/native-client'
import type {
  BaselineCaptureResult,
  Display,
  DisplayApplyResult,
  DisplayCapabilityReport,
  DisplayRestoreResult,
  DisplaySettings
} from '@chromashift/native-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PreviewSessionController,
  PreviewValidationError,
  type PreviewActivationPort,
  type PreviewNativePort
} from './preview-session-controller.js'

function makeDisplay(id: string, name: string, primary = false): Display {
  return {
    id,
    name,
    windowsDisplayName: `\\\\.\\${name}`,
    monitorDevicePath: `${id}-path`,
    manufacturer: 'TEST',
    productCode: '1234',
    serialNumber: '5678',
    adapter: { id: 'adapter:one', name: 'Test GPU', vendor: 'nvidia', deviceId: 'device' },
    connection: 'DisplayPort',
    primary,
    hdr: false,
    advancedColorSupported: true,
    bitsPerColorChannel: 8,
    refreshRate: 144
  }
}

const display = makeDisplay('display:one', 'Test display', true)
const secondDisplay = makeDisplay('display:two', 'Second display')

function report(displayId: string, saturationSupported = true): DisplayCapabilityReport {
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

class FakeNative implements PreviewNativePort {
  public readonly applied: Array<{ displayId: string; settings: DisplaySettings }> = []
  public readonly captured: string[] = []
  public readonly restored: string[] = []
  public readonly failRestoreDisplayIds = new Set<string>()
  public displays: Display[] = [display, secondDisplay]
  public reports = new Map<string, DisplayCapabilityReport>([
    [display.id, report(display.id)],
    [secondDisplay.id, report(secondDisplay.id)]
  ])

  public getDisplays(): Promise<Display[]> {
    return Promise.resolve(this.displays)
  }

  public getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport> {
    return Promise.resolve(this.reports.get(displayId) ?? report(displayId))
  }

  public captureBaseline(displayId: string): Promise<BaselineCaptureResult> {
    this.captured.push(displayId)
    return Promise.resolve({ displayId, state: 'captured' })
  }

  public applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    this.applied.push({ displayId, settings })
    return Promise.resolve({ displayId, settings, applied: {} })
  }

  public restoreDisplay(displayId: string): Promise<DisplayRestoreResult> {
    if (this.failRestoreDisplayIds.has(displayId)) {
      return Promise.reject(new Error(`Restore failed on ${displayId}`))
    }
    this.restored.push(displayId)
    return Promise.resolve({ displayId, restored: true })
  }
}

class FakeActivation implements PreviewActivationPort {
  public readonly calls: string[] = []
  public readonly retainedDisplayIds: Array<{
    operation: 'cancel' | 'confirm'
    displayIds: string[]
  }> = []
  public beginPreview(): Promise<void> {
    this.calls.push('begin')
    return Promise.resolve()
  }
  public cancelPreview(retainedDisplayIds: readonly string[] = []): Promise<void> {
    this.calls.push('cancel')
    this.retainedDisplayIds.push({ operation: 'cancel', displayIds: [...retainedDisplayIds] })
    return Promise.resolve()
  }
  public confirmPreview(
    profileId: string,
    retainedDisplayIds: readonly string[] = []
  ): Promise<void> {
    this.calls.push(`confirm:${profileId}`)
    this.retainedDisplayIds.push({ operation: 'confirm', displayIds: [...retainedDisplayIds] })
    return Promise.resolve()
  }
}

class DeferredApplyNative extends FakeNative {
  public applyStarted!: () => void
  public releaseApply!: () => void
  public readonly applyStartedPromise = new Promise<void>((resolve) => {
    this.applyStarted = resolve
  })
  private readonly applyReleasedPromise = new Promise<void>((resolve) => {
    this.releaseApply = resolve
  })

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

class DisconnectOnDemandNative extends FakeNative {
  public disconnectOnNextApply = false

  public override applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    if (this.disconnectOnNextApply) {
      this.disconnectOnNextApply = false
      this.displays = this.displays.filter((item) => item.id !== displayId)
      return Promise.reject(
        new NativeServiceError(
          'DISPLAY_NOT_FOUND',
          `Display not found: ${displayId}`,
          'display.apply',
          'test-request'
        )
      )
    }
    return super.applyDisplaySettings(displayId, settings)
  }
}

function profile(
  displays: ColorProfile['displays'] = [{ displayId: display.id, color: { saturation: 75 } }]
): ColorProfile {
  return {
    id: 'gaming',
    name: 'Gaming',
    enabled: true,
    applications: [],
    displays
  }
}

function targets(...entries: Array<[string, ColorSettings]>) {
  return entries.map(([displayId, color]) => ({ displayId, color }))
}

afterEach(() => vi.useRealTimers())

describe('PreviewSessionController', () => {
  it('captures, applies, updates, and confirms a safe preview', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const states: string[] = []
    const controller = new PreviewSessionController(native, activation, (state) =>
      states.push(state.state)
    )

    await controller.start(profile(), 'edit')
    await controller.update('gaming', targets([display.id, { saturation: 80 }]))
    await controller.confirm('gaming')

    expect(native.applied.map((entry) => entry.settings.saturation)).toEqual([75, 80])
    expect(native.restored).toEqual([display.id])
    expect(activation.calls).toEqual(['begin', 'confirm:gaming'])
    expect(states).toEqual(['active', 'active', 'inactive'])
  })

  it('previews independent settings on two displays in one session', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)

    await controller.start(
      profile([
        { displayId: display.id, color: { saturation: 75 } },
        { displayId: secondDisplay.id, color: { brightness: 30 } }
      ]),
      'edit'
    )

    expect(native.applied).toEqual([
      { displayId: display.id, settings: { saturation: 75 } },
      { displayId: secondDisplay.id, settings: { brightness: 30 } }
    ])
    expect(controller.state).toMatchObject({
      state: 'active',
      targets: [
        { displayId: display.id, color: { saturation: 75 } },
        { displayId: secondDisplay.id, color: { brightness: 30 } }
      ]
    })
  })

  it('keeps the rest of the draft when the edited display changes', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)

    await controller.start(profile(), 'edit')
    await controller.update(
      'gaming',
      targets([display.id, { saturation: 75 }], [secondDisplay.id, { brightness: 30 }])
    )
    await controller.update(
      'gaming',
      targets([display.id, { saturation: 75 }], [secondDisplay.id, { brightness: 45 }])
    )

    // display:one was applied once and never re-applied while only display:two changed.
    expect(native.applied).toEqual([
      { displayId: display.id, settings: { saturation: 75 } },
      { displayId: secondDisplay.id, settings: { brightness: 30 } },
      { displayId: secondDisplay.id, settings: { brightness: 45 } }
    ])
    expect(controller.state).toMatchObject({
      targets: [
        { displayId: display.id, color: { saturation: 75 } },
        { displayId: secondDisplay.id, color: { brightness: 45 } }
      ]
    })
  })

  it('restores a display whose overrides are all removed and issues no empty apply write', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)

    await controller.start(profile(), 'edit')
    await controller.update('gaming', targets([display.id, {}]))

    expect(native.applied).toEqual([{ displayId: display.id, settings: { saturation: 75 } }])
    expect(native.restored).toEqual([display.id])
    expect(controller.state).toMatchObject({ state: 'active', targets: [] })
  })

  it('starts a session on a draft that overrides nothing', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)

    await controller.start(profile([{ displayId: display.id, color: {} }]), 'override')

    expect(native.applied).toEqual([])
    expect(native.captured).toEqual([])
    expect(controller.state).toMatchObject({ state: 'active', kind: 'override', targets: [] })
  })

  it('restores every display the session touched on cancel', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)

    await controller.start(profile(), 'edit')
    await controller.update(
      'gaming',
      targets([display.id, { saturation: 80 }], [secondDisplay.id, { brightness: 30 }])
    )
    // Drop the second display from the draft again; it must still be rolled back.
    await controller.update('gaming', targets([display.id, { saturation: 80 }]))
    await controller.cancel()

    expect(native.restored).toEqual([secondDisplay.id, display.id, secondDisplay.id])
    expect(controller.state).toEqual({ state: 'inactive' })
    expect(activation.calls).toEqual(['begin', 'cancel'])
  })

  it('surfaces a restore failure without skipping the other displays or the rollback', async () => {
    const native = new FakeNative()
    native.failRestoreDisplayIds.add(display.id)
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)

    await controller.start(
      profile([
        { displayId: display.id, color: { saturation: 75 } },
        { displayId: secondDisplay.id, color: { brightness: 30 } }
      ]),
      'edit'
    )

    await expect(controller.cancel()).rejects.toThrow(/could not be restored/)
    expect(native.restored).toEqual([secondDisplay.id])
    expect(activation.calls).toEqual(['begin', 'cancel'])
    expect(activation.retainedDisplayIds).toContainEqual({
      operation: 'cancel',
      displayIds: [display.id]
    })
    expect(controller.state).toEqual({ state: 'inactive' })
  })

  it('rejects an unsupported control before suspending normal activation', async () => {
    const native = new FakeNative()
    native.reports.set(display.id, report(display.id, false))
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)

    await expect(controller.start(profile(), 'preview')).rejects.toThrow(PreviewValidationError)
    expect(activation.calls).toEqual([])
    expect(native.applied).toEqual([])
  })

  it('isolates a capability rejection to the affected display', async () => {
    const native = new FakeNative()
    native.reports.set(secondDisplay.id, report(secondDisplay.id, false))
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)

    await controller.start(profile(), 'edit')
    await expect(
      controller.update(
        'gaming',
        targets([display.id, { saturation: 75 }], [secondDisplay.id, { saturation: 30 }])
      )
    ).rejects.toThrow(/Second display cannot preview Saturation/)

    // The already-applied display keeps its previewed value.
    expect(controller.state).toMatchObject({
      targets: [{ displayId: display.id, color: { saturation: 75 } }]
    })
  })

  it('rejects a draft targeting a display that is no longer connected', async () => {
    const native = new FakeNative()
    native.displays = [display]
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)

    await expect(
      controller.start(
        profile([{ displayId: secondDisplay.id, color: { saturation: 75 } }]),
        'preview'
      )
    ).rejects.toThrow(/no longer connected/)
  })

  it('requires a display and a control before an explicit preview', async () => {
    const controller = new PreviewSessionController(
      new FakeNative(),
      new FakeActivation(),
      () => undefined
    )

    await expect(controller.start(profile([]), 'preview')).rejects.toThrow(
      /Select at least one display/
    )
    await expect(
      controller.start(profile([{ displayId: display.id, color: {} }]), 'preview')
    ).rejects.toThrow(/Enable at least one color control/)
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

  it('promotes an unchanged same-profile preview to edit without touching the displays', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const states: Array<{ state: string; kind?: string }> = []
    const controller = new PreviewSessionController(native, activation, (state) =>
      states.push({ state: state.state, kind: state.state === 'active' ? state.kind : undefined })
    )
    const draft = profile()

    await controller.start(draft, 'preview')
    await controller.start(draft, 'edit')
    await controller.start(draft, 'edit')

    expect(controller.state).toMatchObject({ state: 'active', kind: 'edit', profileId: 'gaming' })
    expect(native.captured).toEqual([display.id])
    expect(native.applied).toEqual([{ displayId: display.id, settings: { saturation: 75 } }])
    expect(native.restored).toEqual([])
    expect(activation.calls).toEqual(['begin'])
    expect(states).toEqual([
      { state: 'active', kind: 'preview' },
      { state: 'active', kind: 'edit' }
    ])
  })

  it('uses the restore-safe transition when an edit draft differs from its preview', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)

    await controller.start(profile(), 'preview')
    await controller.start(profile([{ displayId: display.id, color: { saturation: 80 } }]), 'edit')

    expect(native.restored).toEqual([display.id])
    expect(native.captured).toEqual([display.id, display.id])
    expect(native.applied.map((entry) => entry.settings.saturation)).toEqual([75, 80])
    expect(activation.calls).toEqual(['begin', 'cancel', 'begin'])
    expect(controller.state).toMatchObject({ state: 'active', kind: 'edit' })
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
    expect(native.restored).toEqual([display.id])
    expect(activation.calls).toEqual(['begin', 'cancel'])
  })

  it('cancels an edit that finishes starting after the app panel closes', async () => {
    const native = new DeferredApplyNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)

    const starting = controller.start(profile(), 'edit')
    await native.applyStartedPromise
    const closing = controller.cancelNonOverride()

    native.releaseApply()
    await starting
    await closing

    expect(controller.state).toEqual({ state: 'inactive' })
    expect(activation.calls).toEqual(['begin', 'cancel'])
  })

  it('keeps a mini-panel override when the app panel closes', async () => {
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(new FakeNative(), activation, () => undefined)

    await controller.start(profile(), 'override')
    await controller.cancelNonOverride()

    expect(controller.state).toMatchObject({ state: 'active', kind: 'override' })
    expect(activation.calls).toEqual(['begin'])
  })

  it('revalidates capabilities and reapplies an active session after a display transition', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)
    await controller.start(profile(), 'edit')

    await expect(controller.reapplyAfterDisplayTransition()).resolves.toBe(true)

    expect(native.captured).toEqual([display.id, display.id])
    expect(native.applied.map((entry) => entry.settings.saturation)).toEqual([75, 75])
  })

  it('keeps an active edit deferred when its display disconnects during a transition', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)
    await controller.start(profile(), 'edit')
    native.displays = [secondDisplay]

    await expect(controller.reapplyAfterDisplayTransition()).resolves.toBe(true)

    expect(native.captured).toEqual([display.id])
    expect(native.applied).toHaveLength(1)
    expect(controller.state).toMatchObject({
      state: 'active',
      kind: 'edit',
      targets: [{ displayId: display.id, color: { saturation: 75 } }]
    })
  })

  it('keeps an active edit when the display disconnects between transition refresh and apply', async () => {
    const native = new DisconnectOnDemandNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)
    await controller.start(profile(), 'edit')
    native.disconnectOnNextApply = true

    await expect(controller.reapplyAfterDisplayTransition()).resolves.toBe(true)
    await expect(controller.cancel()).resolves.toBeUndefined()

    expect(controller.state).toEqual({ state: 'inactive' })
    expect(activation.retainedDisplayIds).toContainEqual({
      operation: 'cancel',
      displayIds: [display.id]
    })
  })

  it('continues editing connected targets while another target is disconnected', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)
    await controller.start(
      profile([
        { displayId: display.id, color: { saturation: 75 } },
        { displayId: secondDisplay.id, color: { brightness: 30 } }
      ]),
      'edit'
    )
    native.displays = [secondDisplay]
    await controller.reapplyAfterDisplayTransition()

    await expect(
      controller.update(
        'gaming',
        targets([display.id, { saturation: 75 }], [secondDisplay.id, { brightness: 45 }])
      )
    ).resolves.toBeUndefined()

    expect(native.applied).toEqual([
      { displayId: display.id, settings: { saturation: 75 } },
      { displayId: secondDisplay.id, settings: { brightness: 30 } },
      { displayId: secondDisplay.id, settings: { brightness: 30 } },
      { displayId: secondDisplay.id, settings: { brightness: 45 } }
    ])
    expect(controller.state).toMatchObject({
      targets: [
        { displayId: display.id, color: { saturation: 75 } },
        { displayId: secondDisplay.id, color: { brightness: 45 } }
      ]
    })
  })

  it('removes a disconnected target without attempting an unavailable restore', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)
    await controller.start(
      profile([
        { displayId: display.id, color: { saturation: 75 } },
        { displayId: secondDisplay.id, color: { brightness: 30 } }
      ]),
      'edit'
    )
    native.displays = [secondDisplay]
    await controller.reapplyAfterDisplayTransition()

    await expect(
      controller.update('gaming', targets([secondDisplay.id, { brightness: 30 }]))
    ).resolves.toBeUndefined()
    await expect(controller.cancel()).resolves.toBeUndefined()

    expect(native.restored).toEqual([secondDisplay.id])
    expect(activation.retainedDisplayIds).toContainEqual({
      operation: 'cancel',
      displayIds: [display.id]
    })
  })

  it('cancels cleanly while a touched display is disconnected and retains its baseline', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)
    await controller.start(profile(), 'edit')
    native.displays = [secondDisplay]

    await expect(controller.cancel()).resolves.toBeUndefined()

    expect(native.restored).toEqual([])
    expect(activation.calls).toEqual(['begin', 'cancel'])
    expect(activation.retainedDisplayIds).toContainEqual({
      operation: 'cancel',
      displayIds: [display.id]
    })
    expect(controller.state).toEqual({ state: 'inactive' })
  })

  it('saves cleanly while a touched display is disconnected and retains its baseline', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)
    await controller.start(profile(), 'edit')
    native.displays = [secondDisplay]

    await expect(controller.confirm('gaming')).resolves.toBeUndefined()

    expect(native.restored).toEqual([])
    expect(activation.calls).toEqual(['begin', 'confirm:gaming'])
    expect(activation.retainedDisplayIds).toContainEqual({
      operation: 'confirm',
      displayIds: [display.id]
    })
    expect(controller.state).toEqual({ state: 'inactive' })
  })

  it('refuses to reapply a preview when HDR or topology removes its capability', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)
    await controller.start(profile(), 'edit')
    native.reports.set(display.id, report(display.id, false))

    await expect(controller.reapplyAfterDisplayTransition()).rejects.toThrow(
      'cannot preview Saturation'
    )

    expect(native.applied).toHaveLength(1)
  })

  it('restores touched displays when a session is saved while preserving activation', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)

    await controller.start(profile(), 'edit')
    await controller.completePreservingMode('gaming')

    expect(native.restored).toEqual([display.id])
    expect(activation.calls).toEqual(['begin', 'cancel'])
    expect(controller.state).toEqual({ state: 'inactive' })
  })
})
