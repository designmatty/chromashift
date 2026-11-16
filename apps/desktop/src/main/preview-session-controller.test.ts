import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LearnedGammaLimits } from '@main/learned-gamma-limits.js'
import { mapProductError } from '@main/product-ipc.js'
import { attachNativeEventRouter } from '@main/native-event-router.js'
import type { StructuredLogEvent } from '@main/structured-logger.js'
import {
  createNeutralColorSettings,
  type ColorProfile,
  type ColorSettings
} from '@chromashift/core'
import { NativeServiceError } from '@chromashift/native-client'
import type { DisplayApplyResult, DisplaySettings } from '@chromashift/native-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PreviewRestoreError,
  PreviewSessionController,
  type PreviewActivationPort
} from '@main/preview-session-controller.js'
import {
  FakeNativeDisplayPort,
  testCapabilityReport as report,
  testDisplay
} from '@main/testing/fake-native-display.js'

const display = testDisplay('display:one', false, 'Test display', true)
const secondDisplay = testDisplay('display:two', false, 'Second display', false)

class FakeNative extends FakeNativeDisplayPort {
  public constructor() {
    super(0, [display, secondDisplay])
  }
}

class FakeActivation implements PreviewActivationPort {
  public readonly calls: string[] = []
  public readonly retainedDisplayIds: Array<{
    operation: 'cancel' | 'confirm'
    displayIds: string[]
  }> = []
  public owned: readonly string[] = []
  public continueError: Error | undefined
  public beginPreview(): Promise<readonly string[]> {
    this.calls.push('begin')
    return Promise.resolve(this.owned)
  }
  public continuePreview(): Promise<readonly string[]> {
    this.calls.push('continue')
    return this.continueError === undefined
      ? Promise.resolve(this.owned)
      : Promise.reject(this.continueError)
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
  displays: Array<{ displayId: string; color: Partial<ColorSettings> }> = [
    { displayId: display.id, color: { saturation: 75 } }
  ]
): ColorProfile {
  return {
    id: 'gaming',
    name: 'Gaming',
    enabled: true,
    applications: [],
    displays: displays.map((target) => ({
      displayId: target.displayId,
      color: completeColor(target.color)
    }))
  }
}

function targets(...entries: Array<[string, Partial<ColorSettings>]>) {
  return entries.map(([displayId, color]) => ({
    displayId,
    color: completeColor(color)
  }))
}

function completeColor(overrides: Partial<ColorSettings> = {}): ColorSettings {
  return { ...createNeutralColorSettings(), ...overrides }
}

afterEach(() => vi.useRealTimers())

describe('PreviewSessionController', () => {
  it('tracks metadata-only dirtiness through promotion and full-draft updates', async () => {
    const native = new FakeNative()
    const saved = profile()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)
    await controller.start(saved, 'preview', saved)
    expect(controller.state).toMatchObject({ unsavedChanges: false })
    const renamed = { ...saved, name: 'Unsaved name' }
    const before = native.calls.length
    await controller.start(renamed, 'edit', saved)
    expect(controller.state).toMatchObject({ unsavedChanges: true, draft: renamed })
    await controller.update(saved.id, saved.displays, saved)
    expect(controller.state).toMatchObject({ unsavedChanges: false, draft: saved })
    expect(native.calls).toHaveLength(before)
  })

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
      { displayId: display.id, settings: completeColor({ saturation: 75 }) },
      { displayId: secondDisplay.id, settings: completeColor({ brightness: 30 }) }
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
      { displayId: display.id, settings: completeColor({ saturation: 75 }) },
      { displayId: secondDisplay.id, settings: completeColor({ brightness: 30 }) },
      { displayId: secondDisplay.id, settings: completeColor({ brightness: 45 }) }
    ])
    expect(controller.state).toMatchObject({
      targets: [
        { displayId: display.id, color: { saturation: 75 } },
        { displayId: secondDisplay.id, color: { brightness: 45 } }
      ]
    })
  })

  it('applies the neutral vector when every control is reset', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)

    await controller.start(profile(), 'edit')
    await controller.update('gaming', targets([display.id, {}]))

    expect(native.applied).toEqual([
      { displayId: display.id, settings: completeColor({ saturation: 75 }) },
      { displayId: display.id, settings: completeColor() }
    ])
    expect(native.restored).toEqual([])
    expect(controller.state).toMatchObject({
      state: 'active',
      targets: [{ displayId: display.id, color: completeColor() }]
    })
  })

  it('treats every assigned target as an applied target', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)

    await controller.start(profile([{ displayId: display.id, color: {} }]), 'override')

    expect(native.applied).toEqual([{ displayId: display.id, settings: completeColor() }])
    expect(native.captured).toEqual([display.id])
    expect(controller.state).toMatchObject({
      state: 'active',
      kind: 'override',
      targets: [{ displayId: display.id, color: completeColor() }]
    })
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

  it('retains a restore failure without skipping other displays or releasing activation', async () => {
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
    expect(activation.calls).toEqual(['begin'])
    expect(controller.state).toEqual({ state: 'restorePending', displayIds: [display.id] })
    native.failRestoreDisplayIds.clear()
    await controller.cancel()
    expect(activation.calls).toEqual(['begin', 'cancel'])
    expect(controller.state).toEqual({ state: 'inactive' })
  })

  it('retains unsupported values and lets the native boundary filter them', async () => {
    const native = new FakeNative()
    native.reports.set(display.id, report(display.id, false))
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)

    await expect(controller.start(profile(), 'preview')).resolves.toBeUndefined()
    expect(activation.calls).toEqual(['begin'])
    expect(native.applied).toEqual([
      { displayId: display.id, settings: completeColor({ saturation: 75 }) }
    ])
  })

  it('retains values independently when one display lacks a capability', async () => {
    const native = new FakeNative()
    native.reports.set(secondDisplay.id, report(secondDisplay.id, false))
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)

    await controller.start(profile(), 'edit')
    await expect(
      controller.update(
        'gaming',
        targets([display.id, { saturation: 75 }], [secondDisplay.id, { saturation: 30 }])
      )
    ).resolves.toBeUndefined()

    // The already-applied display keeps its previewed value.
    expect(controller.state).toMatchObject({
      targets: [
        { displayId: display.id, color: { saturation: 75 } },
        { displayId: secondDisplay.id, color: { saturation: 30 } }
      ]
    })
  })

  it('keeps a disconnected draft target quiescent', async () => {
    const native = new FakeNative()
    native.displays = [display]
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)

    await expect(
      controller.start(
        profile([{ displayId: secondDisplay.id, color: { saturation: 75 } }]),
        'preview'
      )
    ).resolves.toBeUndefined()
    expect(native.applied).toEqual([])
  })

  it('allows an explicit preview with no saved targets', async () => {
    const controller = new PreviewSessionController(
      new FakeNative(),
      new FakeActivation(),
      () => undefined
    )

    await expect(controller.start(profile([]), 'preview')).resolves.toBeUndefined()
    await expect(
      controller.start(profile([{ displayId: display.id, color: {} }]), 'preview')
    ).resolves.toBeUndefined()
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
    expect(native.applied).toEqual([
      { displayId: display.id, settings: completeColor({ saturation: 75 }) }
    ])
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
    const closing = controller.cancelForPanelHide('close')

    native.releaseApply()
    await starting
    await closing

    expect(controller.state).toEqual({ state: 'inactive' })
    expect(activation.calls).toEqual(['begin', 'cancel'])
  })

  it('keeps a mini-panel override when the app hands off to the mini panel', async () => {
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(new FakeNative(), activation, () => undefined)

    await controller.start(profile(), 'override')
    await controller.cancelForPanelHide('handoff')

    expect(controller.state).toMatchObject({ state: 'active', kind: 'override' })
    expect(activation.calls).toEqual(['begin'])
  })

  it.each(['edit', 'preview', 'override'] as const)(
    'reports close-time restore failures and keeps the %s session retryable',
    async (kind) => {
      const native = new FakeNative()
      const activation = new FakeActivation()
      const controller = new PreviewSessionController(native, activation, () => undefined)
      await controller.start(
        profile([
          { displayId: display.id, color: { saturation: 75 } },
          { displayId: secondDisplay.id, color: { brightness: 30 } }
        ]),
        kind
      )
      native.failRestoreDisplayIds.add(display.id)

      await expect(controller.cancelForPanelHide('close')).rejects.toBeInstanceOf(
        PreviewRestoreError
      )
      await expect(controller.cancelForPanelHide('close')).rejects.toMatchObject({
        failures: [expect.stringContaining(display.id)]
      })
      expect(native.restored).toEqual([secondDisplay.id])
      expect(controller.state).toEqual({ state: 'restorePending', displayIds: [display.id] })
      expect(activation.calls).toEqual(['begin'])

      native.failRestoreDisplayIds.clear()
      await expect(controller.cancelForPanelHide('close')).resolves.toBeUndefined()
      expect(native.restored).toContain(display.id)
      expect(controller.state).toEqual({ state: 'inactive' })
      expect(activation.calls).toEqual(['begin', 'cancel'])
    }
  )

  it('publishes only pending restores and rejects edits until restoration is confirmed', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const onStateChanged = vi.fn()
    const controller = new PreviewSessionController(native, activation, onStateChanged)
    const draft = profile([
      { displayId: display.id, color: { saturation: 75 } },
      { displayId: secondDisplay.id, color: { brightness: 30 } }
    ])
    await controller.start(draft, 'edit')
    native.failRestoreDisplayIds.add(display.id)
    onStateChanged.mockClear()

    await expect(controller.cancelForPanelHide('close')).rejects.toBeInstanceOf(PreviewRestoreError)

    expect(controller.state).toEqual({ state: 'restorePending', displayIds: [display.id] })
    expect(onStateChanged).toHaveBeenCalledExactlyOnceWith(controller.state)
    expect(activation.calls).toEqual(['begin'])
    native.calls.length = 0

    await expect(controller.update(draft.id, draft.displays)).rejects.toThrow('pending displays')
    await expect(controller.start(draft, 'edit')).rejects.toThrow('pending displays')
    expect(native.calls).toEqual([])
    native.failRestoreDisplayIds.clear()
    await controller.cancelForPanelHide('close')
    expect(native.restored).toEqual([secondDisplay.id, display.id])
  })

  it.each(['disconnected', 'hdr'] as const)(
    'releases a %s display to activation without a close-time restore failure',
    async (reason) => {
      const native = new FakeNative()
      const activation = new FakeActivation()
      const controller = new PreviewSessionController(native, activation, () => undefined)
      await controller.start(profile(), 'edit')
      if (reason === 'disconnected') native.disconnectedDisplayIds.add(display.id)
      else native.hdrDisplayIds.add(display.id)

      await expect(controller.cancelForPanelHide('close')).resolves.toBeUndefined()

      expect(native.restored).toEqual(reason === 'hdr' ? [display.id] : [])
      expect(controller.state).toEqual({ state: 'inactive' })
      expect(activation.retainedDisplayIds).toEqual([
        { operation: 'cancel', displayIds: reason === 'hdr' ? [] : [display.id] }
      ])
    }
  )

  it('reports a non-restored response on close and retries it without recapturing', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)
    await controller.start(profile(), 'edit')
    vi.spyOn(native, 'restoreDisplay').mockResolvedValueOnce({
      displayId: display.id,
      restored: false,
      error: 'Read-back did not match.'
    })

    await expect(controller.cancelForPanelHide('close')).rejects.toMatchObject({
      failures: [`${display.id}: Read-back did not match.`]
    })
    await expect(controller.cancelForPanelHide('close')).resolves.toBeUndefined()

    expect(native.captured).toEqual([display.id])
    expect(native.restored).toEqual([display.id])
    expect(activation.calls).toEqual(['begin', 'cancel'])
  })

  it.each([{ code: 'DISPLAY_NOT_FOUND' }])(
    'retains a deferred restore response on close: %j',
    async (result) => {
      const native = new FakeNative()
      const activation = new FakeActivation()
      const controller = new PreviewSessionController(native, activation, () => undefined)
      await controller.start(profile(), 'edit')
      vi.spyOn(native, 'restoreDisplay').mockResolvedValueOnce({
        displayId: display.id,
        restored: false,
        ...result
      })

      await expect(controller.cancelForPanelHide('close')).resolves.toBeUndefined()

      expect(controller.state).toEqual({ state: 'inactive' })
      expect(activation.retainedDisplayIds).toEqual([
        { operation: 'cancel', displayIds: [display.id] }
      ])
    }
  )

  it.each([{ reason: 'hdrActive' }, { code: 'HDR_UNSAFE' }])(
    'treats an unconfirmed HDR restore as a restore failure: %j',
    async (result) => {
      const native = new FakeNative()
      const failed = vi.fn(async () => undefined)
      const controller = new PreviewSessionController(
        native,
        new FakeActivation(),
        () => undefined,
        {
          restoreFailed: failed,
          restored: async () => undefined
        }
      )
      await controller.start(profile(), 'edit')
      vi.spyOn(native, 'restoreDisplay').mockResolvedValueOnce({
        displayId: display.id,
        restored: false,
        ...result
      })
      await expect(controller.cancelForPanelHide('close')).rejects.toBeInstanceOf(
        PreviewRestoreError
      )
      expect(controller.state).toEqual({ state: 'restorePending', displayIds: [display.id] })
      expect(failed).toHaveBeenCalledOnce()
    }
  )

  it.each(['edit', 'override'] as const)(
    'restores HDR immediately and preserves the %s draft and SDR output',
    async (kind) => {
      const native = new FakeNative()
      const original = { brightness: 48, saturation: 42 }
      native.currentSettings.set(display.id, original)
      const saved = profile(
        targets([display.id, { brightness: 60 }], [secondDisplay.id, { brightness: 65 }])
      )
      const draft = {
        ...saved,
        name: 'Unsaved draft',
        displays: targets(
          [display.id, { brightness: 30, saturation: 85 }],
          [secondDisplay.id, { brightness: 35 }]
        )
      }
      const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)
      await controller.start(draft, kind, saved)
      native.hdrDisplayIds.add(display.id)
      const before = native.calls.length
      await controller.reapplyAfterDisplayTransition()
      expect(native.calls.slice(before).filter((call) => call.displayId === display.id)).toEqual([
        { operation: 'restore', displayId: display.id }
      ])
      expect(native.currentSettings.get(display.id)).toEqual(original)
      expect(native.currentSettings.get(secondDisplay.id)?.brightness).toBe(35)
      expect(controller.unsavedDraft).toEqual(draft)
      expect(controller.state).toMatchObject({ state: 'active', kind, unsavedChanges: true, draft })
      native.hdrDisplayIds.clear()
      await controller.reapplyAfterDisplayTransition()
      expect(native.currentSettings.get(display.id)).toEqual(draft.displays[0]!.color)
      expect(controller.unsavedDraft).toEqual(draft)
      expect(
        native.baselineCaptures
          .filter((capture) => capture.displayId === display.id)
          .map((capture) => capture.settings)
      ).toEqual([original, original])
    }
  )

  it('discards to saved targets while HDR stays original, then applies saved values on HDR off', async () => {
    const native = new FakeNative()
    const saved = profile()
    const draft = profile(targets([display.id, { brightness: 30, saturation: 85 }]))
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)
    await controller.start(draft, 'edit', saved)
    native.hdrDisplayIds.add(display.id)
    await controller.update(saved.id, saved.displays, saved)
    expect(native.currentSettings.get(display.id)).toEqual({})
    expect(controller.state).toMatchObject({ state: 'active', unsavedChanges: false, draft: saved })
    native.hdrDisplayIds.clear()
    await controller.reapplyAfterDisplayTransition()
    expect(native.currentSettings.get(display.id)).toEqual(saved.displays[0]!.color)
  })

  it('does nothing on close when no session is active', async () => {
    const native = new FakeNative()
    const activation = new FakeActivation()
    const controller = new PreviewSessionController(native, activation, () => undefined)

    await controller.cancelForPanelHide('close')

    expect(native.calls).toEqual([])
    expect(activation.calls).toEqual([])
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
      { displayId: display.id, settings: completeColor({ saturation: 75 }) },
      { displayId: secondDisplay.id, settings: completeColor({ brightness: 30 }) },
      { displayId: secondDisplay.id, settings: completeColor({ brightness: 30 }) },
      { displayId: secondDisplay.id, settings: completeColor({ brightness: 45 }) }
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

  it('retains a preview when topology removes a capability', async () => {
    const native = new FakeNative()
    const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)
    await controller.start(profile(), 'edit')
    native.reports.set(display.id, report(display.id, false))

    await expect(controller.reapplyAfterDisplayTransition()).resolves.toBe(true)

    expect(native.applied).toHaveLength(2)
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

it('refreshes saved content without native calls, and discards metadata in place', async () => {
  const native = new FakeNative()
  const controller = new PreviewSessionController(native, new FakeActivation(), () => undefined)
  const saved = profile()
  const draft = { ...saved, name: 'Renamed draft' }
  await controller.start(draft, 'edit', saved)
  const before = native.calls.length
  await controller.profileSaved({ ...draft, id: 'other' })
  expect(controller.unsavedDraft).toEqual(draft)
  await controller.profileSaved(draft)
  expect(controller.unsavedDraft).toBeNull()
  const edited = { ...draft, name: 'Next rename' }
  await controller.update(edited.id, edited.displays, edited)
  expect(controller.unsavedDraft).toEqual(edited)
  await controller.update(draft.id, draft.displays, draft)
  expect(controller.state).toMatchObject({
    state: 'active',
    kind: 'edit',
    unsavedChanges: false,
    draft
  })
  expect(native.calls).toHaveLength(before)
})

it('restores the full preview display and keeps gamma rejection values and adapter diagnostics', async () => {
  const native = new FakeNative()
  const original = completeColor({ brightness: 43, contrast: 57, saturation: 62, hue: 8 })
  native.currentSettings.set(display.id, original)
  const source = new EventEmitter()
  const records: StructuredLogEvent[] = []
  attachNativeEventRouter(source, {
    activation: () => undefined,
    displayTransitions: () => undefined,
    recovery: () => undefined,
    isExiting: () => false,
    broadcastProductState: () => undefined,
    logger: { write: (record) => records.push(record) }
  })
  const diagnostic = {
    level: 'error',
    eventName: 'GammaSettingsRejected',
    displayId: display.id,
    displayName: display.name,
    provider: 'windows',
    adapterId: display.adapter.id,
    adapterName: display.adapter.name,
    adapterVendor: display.adapter.vendor,
    adapterDeviceId: display.adapter.deviceId,
    brightness: 95,
    contrast: 50,
    gamma: 2.5,
    code: 'GAMMA_WRITE_FAILED',
    nativeMessage: 'SetDeviceGammaRamp failed for DISPLAY1.'
  }
  vi.spyOn(native, 'applyDisplaySettings').mockImplementation(async () => {
    // Model a partly changed provider state. Rollback must restore every color field.
    native.currentSettings.set(display.id, { brightness: 95, saturation: 80 })
    source.emit('diagnostic', JSON.stringify(diagnostic))
    throw new NativeServiceError(
      'GAMMA_WRITE_FAILED',
      'This display rejected gamma 2.50 at brightness 95% (Test display).',
      'display.apply',
      'gamma-rejection'
    )
  })
  const activation = new FakeActivation()
  const preview = new PreviewSessionController(native, activation, () => undefined)
  const error = await preview
    .start(profile([{ displayId: display.id, color: { brightness: 95, gamma: 2.5 } }]), 'edit')
    .catch((error: unknown) => error)
  expect(mapProductError(error)).toEqual({
    code: 'OPERATION_FAILED',
    message: 'This display rejected gamma 2.50 at brightness 95% (Test display).'
  })
  expect(native.currentSettings.get(display.id)).toEqual(original)
  expect(native.restored).toEqual([display.id])
  expect(activation.calls).toEqual(['begin', 'cancel'])
  expect(preview.state).toEqual({ state: 'inactive' })
  expect(records).toContainEqual(diagnostic)
})

describe('replacing a preview in place (#78)', () => {
  const third = testDisplay('display:three', false, 'Third display', false)
  // display:one is in both profiles, display:two only in A, display:three only in B.
  const alpha = named('alpha', [
    [display.id, { saturation: 70 }],
    [secondDisplay.id, { brightness: 30 }]
  ])
  const beta = named('beta', [
    [display.id, { saturation: 80 }],
    [third.id, { brightness: 60 }]
  ])
  const originals = new Map([
    [display.id, completeColor({ brightness: 44 })],
    [secondDisplay.id, completeColor({ brightness: 47 })],
    [third.id, completeColor({ brightness: 49 })]
  ])

  function named(id: string, entries: Array<[string, Partial<ColorSettings>]>): ColorProfile {
    return { id, name: id, enabled: true, applications: [], displays: targets(...entries) }
  }

  function setup(options: { limits?: LearnedGammaLimits; transitionPending?: () => boolean } = {}) {
    const native = new FakeNativeDisplayPort(0, [display, secondDisplay, third])
    for (const [id, settings] of originals) native.currentSettings.set(id, { ...settings })
    options.limits?.setDisplaySource(native)
    const activation = new FakeActivation()
    const states = vi.fn()
    const recovery = { restoreFailed: vi.fn(async () => {}), restored: vi.fn(async () => {}) }
    const controller = new PreviewSessionController(
      native,
      activation,
      states,
      recovery,
      options.limits,
      undefined,
      options.transitionPending
    )
    const reset = () => {
      native.calls.length = 0
      native.restored.length = 0
      states.mockClear()
    }
    return { native, activation, states, recovery, controller, reset }
  }

  it('restores first instead of replacing while a display transition is pending', async () => {
    let pending = false
    const { native, activation, controller } = setup({ transitionPending: () => pending })
    await controller.start(alpha, 'preview')
    native.restored.length = 0
    pending = true

    await controller.start(beta, 'preview')

    expect(activation.calls).toEqual(['begin', 'cancel', 'begin'])
    expect(native.restored.slice(0, 2)).toEqual([display.id, secondDisplay.id])
    expect(controller.state).toMatchObject({ state: 'active', profileId: beta.id })
  })

  it.each([false, true])(
    'restores A completely when replacement preflight rejects; cleanup also fails: %s',
    async (cleanupFails) => {
      const directory = await mkdtemp(join(tmpdir(), 'chromashift-preview-swap-'))
      try {
        const limits = new LearnedGammaLimits(join(directory, 'limits.json'), {
          write: () => undefined
        })
        await limits.load()
        const { native, activation, recovery, controller, reset } = setup({ limits })
        await controller.start(alpha, 'preview')
        reset()
        // Learned-limit applicability reads capabilities before any replacement write.
        vi.spyOn(native, 'getDisplayCapabilityReport').mockRejectedValueOnce(
          new NativeServiceError(
            'DISPLAY_NOT_FOUND',
            'Display disconnected during replacement preflight.',
            'display.capabilities',
            'test-request'
          )
        )
        if (cleanupFails) native.failRestoreDisplayIds.add(display.id)

        const starting = controller.start(beta, 'preview')
        await (cleanupFails
          ? expect(starting).rejects.toBeInstanceOf(PreviewRestoreError)
          : expect(starting).rejects.toThrow('replacement preflight'))

        expect(native.calls.filter((call) => call.operation !== 'restore')).toEqual([])
        expect(native.calls).toEqual([
          { operation: 'restore', displayId: display.id },
          { operation: 'restore', displayId: secondDisplay.id }
        ])
        if (cleanupFails) {
          expect(controller.state).toEqual({ state: 'restorePending', displayIds: [display.id] })
          expect(recovery.restoreFailed).toHaveBeenCalledOnce()
          expect(activation.calls).toEqual(['begin'])
          native.failRestoreDisplayIds.clear()
          await controller.cancel()
        } else {
          expect(activation.calls).toEqual(['begin', 'cancel'])
        }
        expect(controller.state).toEqual({ state: 'inactive' })
        expectOriginals(native)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )

  function expectOriginals(native: FakeNativeDisplayPort): void {
    for (const [id, settings] of originals) expect(native.currentSettings.get(id)).toEqual(settings)
  }

  it('goes from A to B without releasing the hold or restoring a display both profiles target', async () => {
    const { native, activation, states, controller, reset } = setup()
    await controller.start(alpha, 'preview')
    reset()

    await controller.start(beta, 'preview')

    expect(activation.calls).toEqual(['begin', 'continue'])
    expect(native.calls).toEqual([
      { operation: 'restore', displayId: secondDisplay.id },
      { operation: 'capture', displayId: display.id },
      { operation: 'capture', displayId: third.id },
      { operation: 'apply', displayId: display.id, settings: beta.displays[0]!.color },
      { operation: 'apply', displayId: third.id, settings: beta.displays[1]!.color }
    ])
    expect(native.baselineCaptures.map((capture) => capture.displayId)).toEqual([
      display.id,
      secondDisplay.id,
      third.id
    ])
    expect(native.currentSettings.get(display.id)).toEqual(beta.displays[0]!.color)
    expect(native.currentSettings.get(secondDisplay.id)).toEqual(originals.get(secondDisplay.id))
    expect(native.currentSettings.get(third.id)).toEqual(beta.displays[1]!.color)
    expect(controller.state).toEqual({
      state: 'active',
      sessionId: 2,
      profileId: beta.id,
      kind: 'preview',
      comparing: false,
      draft: beta,
      unsavedChanges: false,
      targets: beta.displays
    })
    expect(states).toHaveBeenCalledExactlyOnceWith(controller.state)

    reset()
    await controller.cancel()
    expect(native.restored).toEqual([display.id, secondDisplay.id, third.id])
    expect(activation.calls).toEqual(['begin', 'continue', 'cancel'])
    expect(activation.retainedDisplayIds.at(-1)).toEqual({ operation: 'cancel', displayIds: [] })
    expectOriginals(native)
  })

  it('restores activation-owned baselines that the next preview does not target', async () => {
    const { native, activation, controller, reset } = setup()
    activation.owned = [secondDisplay.id]
    await controller.start(named('one-only', [[display.id, { saturation: 70 }]]), 'preview')
    reset()

    await controller.start(named('three-only', [[third.id, { brightness: 60 }]]), 'preview')

    expect(native.calls.filter((call) => call.operation === 'restore')).toEqual([
      { operation: 'restore', displayId: secondDisplay.id },
      { operation: 'restore', displayId: display.id }
    ])
    reset()
    await controller.cancel()
    expect(native.restored).toEqual([secondDisplay.id, display.id, third.id])
  })

  it('discards an unsaved Edit draft when it replaces the session with a preview', async () => {
    const { activation, controller } = setup()
    await controller.start(alpha, 'preview')
    const draft = { ...alpha, name: 'Unsaved alpha' }
    await controller.start(draft, 'edit', alpha)
    await controller.update(alpha.id, targets([display.id, { saturation: 90 }]), draft)
    expect(controller.unsavedDraft).not.toBeNull()

    await controller.start(beta, 'preview')

    expect(activation.calls).toEqual(['begin', 'continue'])
    expect(controller.unsavedDraft).toBeNull()
    expect(controller.state).toMatchObject({ kind: 'preview', profileId: beta.id, draft: beta })
  })

  it.each([
    { from: 'override', to: 'preview', next: beta },
    { from: 'preview', to: 'edit', next: beta },
    { from: 'preview', to: 'override', next: beta },
    { from: 'edit', to: 'edit', next: beta },
    { from: 'preview', to: 'preview', next: { ...alpha, displays: beta.displays } }
  ] as const)(
    'keeps the full teardown from $from to $to for $next.id',
    async ({ from, to, next }) => {
      const { native, activation, controller } = setup()
      await controller.start(alpha, from)
      native.restored.length = 0

      await controller.start(next, to)

      expect(activation.calls).toEqual(['begin', 'cancel', 'begin'])
      expect(native.restored.slice(0, 2)).toEqual([display.id, secondDisplay.id])
      expect(controller.state).toMatchObject({ state: 'active', kind: to, profileId: next.id })
    }
  )

  it.each(['validation', 'activation'] as const)(
    'restores A completely when the replacement fails %s before writing',
    async (stage) => {
      const { native, activation, controller, reset } = setup()
      await controller.start(alpha, 'preview')
      reset()
      if (stage === 'validation') {
        vi.spyOn(native, 'getDisplayCapabilityReport').mockRejectedValueOnce(
          new Error('capability report failed')
        )
      } else activation.continueError = new Error('A display transition is in progress.')

      await expect(controller.start(beta, 'preview')).rejects.toThrow(
        stage === 'validation' ? 'capability report failed' : 'A display transition is in progress.'
      )

      expect(controller.state).toEqual({ state: 'inactive' })
      expect(activation.calls).toEqual(
        stage === 'validation' ? ['begin', 'cancel'] : ['begin', 'continue', 'cancel']
      )
      expect(native.calls).toEqual([
        { operation: 'restore', displayId: display.id },
        { operation: 'restore', displayId: secondDisplay.id }
      ])
      expectOriginals(native)
    }
  )

  it('keeps tracking an A display whose restore fails and never applies B', async () => {
    const { native, activation, recovery, controller, reset } = setup()
    await controller.start(alpha, 'preview')
    reset()
    native.failRestoreDisplayIds.add(secondDisplay.id)

    await expect(controller.start(beta, 'preview')).rejects.toBeInstanceOf(PreviewRestoreError)

    expect(native.calls.filter((call) => call.operation !== 'restore')).toEqual([])
    expect(native.currentSettings.get(display.id)).toEqual(originals.get(display.id))
    expect(controller.state).toEqual({ state: 'restorePending', displayIds: [secondDisplay.id] })
    expect(recovery.restoreFailed).toHaveBeenCalledOnce()
    expect(activation.calls).toEqual(['begin', 'continue'])

    native.failRestoreDisplayIds.clear()
    await controller.cancel()
    expect(controller.state).toEqual({ state: 'inactive' })
    expect(activation.calls).toEqual(['begin', 'continue', 'cancel'])
    expect(recovery.restored).toHaveBeenCalledOnce()
    expectOriginals(native)
  })

  it.each([false, true])(
    'restores A and B displays after B fails to apply; an unconfirmed restore stays tracked: %s',
    async (restoreFails) => {
      const { native, activation, recovery, controller, reset } = setup()
      await controller.start(alpha, 'preview')
      reset()
      native.failApplyDisplayIds.add(third.id)
      if (restoreFails) native.failRestoreDisplayIds.add(display.id)

      const starting = controller.start(beta, 'preview')
      await (restoreFails
        ? expect(starting).rejects.toBeInstanceOf(PreviewRestoreError)
        : expect(starting).rejects.toThrow(`Unsupported on ${third.id}`))

      expect(native.calls.filter((call) => call.operation === 'restore')).toEqual([
        { operation: 'restore', displayId: secondDisplay.id },
        { operation: 'restore', displayId: display.id },
        { operation: 'restore', displayId: secondDisplay.id },
        { operation: 'restore', displayId: third.id }
      ])
      if (restoreFails) {
        expect(controller.state).toEqual({ state: 'restorePending', displayIds: [display.id] })
        expect(recovery.restoreFailed).toHaveBeenCalledOnce()
        expect(activation.calls).toEqual(['begin', 'continue'])
        native.failRestoreDisplayIds.clear()
        await controller.cancel()
      }
      expect(controller.state).toEqual({ state: 'inactive' })
      expect(activation.calls).toEqual(['begin', 'continue', 'cancel'])
      expectOriginals(native)
    }
  )

  it('keeps B for continuation after a native baseline restore failure, still tracking A', async () => {
    const { native, activation, recovery, controller, reset } = setup()
    await controller.start(alpha, 'preview')
    reset()
    const apply = native.applyDisplaySettings.bind(native)
    vi.spyOn(native, 'applyDisplaySettings').mockImplementation(async (id, settings) => {
      if (id !== display.id) return apply(id, settings)
      throw new NativeServiceError(
        'BASELINE_RESTORE_FAILED',
        'Baseline restore failed before apply.',
        'display.apply',
        'test-request'
      )
    })

    await expect(controller.start(beta, 'preview')).rejects.toBeInstanceOf(PreviewRestoreError)

    expect(controller.sessionRecoveryPending).toBe(true)
    expect(controller.state).toMatchObject({
      state: 'active',
      profileId: beta.id,
      kind: 'preview',
      targets: beta.displays
    })
    expect(recovery.restoreFailed).toHaveBeenCalledOnce()
    expect(activation.calls).toEqual(['begin', 'continue'])

    vi.mocked(native.applyDisplaySettings).mockImplementation(apply)
    reset()
    await controller.cancel()
    expect(native.restored).toEqual([display.id, secondDisplay.id, third.id])
    expect(activation.calls).toEqual(['begin', 'continue', 'cancel'])
    expectOriginals(native)
  })

  it('releases Hold to compare into A before replacing it, and rejects compares for A afterwards', async () => {
    const { native, controller } = setup()
    await controller.start(alpha, 'preview')
    const draft = { ...alpha, displays: targets([display.id, { saturation: 90 }]) }
    await controller.start(alpha, 'edit', alpha)
    await controller.update(alpha.id, draft.displays, draft)
    const oldSession = (controller.state as { sessionId: number }).sessionId
    await controller.setCompare(alpha.id, true)
    native.applied.length = 0

    await controller.start(beta, 'preview')

    expect(
      native.applied
        .filter((entry) => entry.displayId === display.id)
        .map((entry) => entry.settings.saturation)
    ).toEqual([90, 80])
    expect(controller.state).toMatchObject({ profileId: beta.id, comparing: false })
    await expect(
      controller.setCompare(alpha.id, true, () => undefined, oldSession)
    ).rejects.toThrow('different profile')
    await expect(controller.setCompare(beta.id, true, () => undefined, oldSession)).rejects.toThrow(
      'The preview session changed.'
    )
  })

  it('restores an HDR display A touched and defers an HDR display B targets', async () => {
    const { native, activation, controller, reset } = setup()
    await controller.start(alpha, 'preview')
    reset()
    native.hdrDisplayIds.add(secondDisplay.id)
    native.hdrDisplayIds.add(third.id)

    await controller.start(beta, 'preview')

    expect(native.calls).toEqual([
      { operation: 'restore', displayId: secondDisplay.id },
      { operation: 'capture', displayId: display.id },
      { operation: 'apply', displayId: display.id, settings: beta.displays[0]!.color }
    ])
    expect(controller.state).toMatchObject({ profileId: beta.id, targets: beta.displays })
    reset()
    await controller.cancel()
    expect(native.restored).toEqual([display.id])
    expect(activation.retainedDisplayIds.at(-1)).toEqual({ operation: 'cancel', displayIds: [] })
  })

  it('retains a disconnected A display without a restore failure and hands it back at the end', async () => {
    const { native, activation, recovery, controller } = setup()
    await controller.start(alpha, 'preview')
    native.disconnectedDisplayIds.add(secondDisplay.id)

    await controller.start(beta, 'preview')
    await controller.cancel()

    expect(recovery.restoreFailed).not.toHaveBeenCalled()
    expect(activation.calls).toEqual(['begin', 'continue', 'cancel'])
    expect(activation.retainedDisplayIds.at(-1)).toEqual({
      operation: 'cancel',
      displayIds: [secondDisplay.id]
    })
  })

  it('serializes queued replacements so the newest preview owns the session and the panel close', async () => {
    const { native, activation, controller } = setup()
    await controller.start(alpha, 'preview')
    const gamma = named('gamma', [[secondDisplay.id, { brightness: 20 }]])

    await Promise.all([controller.start(beta, 'preview'), controller.start(gamma, 'preview')])

    expect(activation.calls).toEqual(['begin', 'continue', 'continue'])
    expect(controller.state).toMatchObject({ sessionId: 3, profileId: gamma.id })
    expect(native.currentSettings.get(display.id)).toEqual(originals.get(display.id))
    expect(native.currentSettings.get(third.id)).toEqual(originals.get(third.id))
    await controller.cancelForPanelHide('close')
    expect(controller.state).toEqual({ state: 'inactive' })
    expect(activation.calls).toEqual(['begin', 'continue', 'continue', 'cancel'])
    expectOriginals(native)
  })
})
