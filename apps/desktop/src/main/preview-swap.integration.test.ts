import {
  JsonProfileRepository,
  createNeutralColorSettings,
  type ColorProfile,
  type ColorSettings,
  type ProfileConfigurationStorage
} from '@chromashift/core'
import type {
  DisplayApplyResult,
  DisplayRestoreResult,
  DisplaySettings,
  NativeEvent,
  RestoreAllResult
} from '@chromashift/native-client'
import { describe, expect, it, vi } from 'vitest'
import { ActivationCoordinator } from '@main/activation-coordinator.js'
import { AutomaticActivationController } from '@main/automatic-activation-controller.js'
import { DisplayTransitionController } from '@main/display-transition-controller.js'
import { EmergencyRestoreController } from '@main/emergency-restore-controller.js'
import { PreviewRestoreError, PreviewSessionController } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort, testDisplay } from '@main/testing/fake-native-display.js'

// One display per class a preview-to-preview switch must handle (#78).
const one = 'display:one' // live, A and B
const two = 'display:two' // live and B
const three = 'display:three' // live only
const four = 'display:four' // A only
const five = 'display:five' // B only, and the queued automatic target
const ids = [one, two, three, four, five]
const color = (values: Partial<ColorSettings>): ColorSettings => ({
  ...createNeutralColorSettings(),
  ...values
})
const originals = new Map(
  ids.map((id, index) => [id, color({ brightness: 40 + index, saturation: 30 + index })])
)
const profileWith = (
  id: string,
  executable: string | null,
  displays: Array<[string, Partial<ColorSettings>]>
): ColorProfile => ({
  id,
  name: id,
  enabled: true,
  applications: executable === null ? [] : [{ executableName: executable }],
  displays: displays.map(([displayId, values]) => ({ displayId, color: color(values) }))
})
const empty = profileWith('default', null, [])
const live = profileWith('live', 'game.exe', [
  [one, { brightness: 62, saturation: 72 }],
  [two, { brightness: 64, saturation: 74 }],
  [three, { brightness: 66, saturation: 76 }]
])
const other = profileWith('other', 'other.exe', [
  [three, { brightness: 21, saturation: 81 }],
  [five, { brightness: 25, saturation: 85 }]
])
const alpha = profileWith('alpha', null, [
  [one, { brightness: 52, saturation: 58 }],
  [four, { brightness: 54, saturation: 59 }]
])
const beta = profileWith('beta', null, [
  [one, { brightness: 33, saturation: 91 }],
  [two, { brightness: 35, saturation: 92 }],
  [five, { brightness: 37, saturation: 93 }]
])

class MemoryStorage implements ProfileConfigurationStorage {
  public constructor(private contents: string) {}
  public async read(): Promise<string> {
    return this.contents
  }
  public async write(contents: string): Promise<void> {
    this.contents = contents
  }
}

/** Records every display's provider state after each native write, as a guard would sample it. */
class SampledNative extends FakeNativeDisplayPort {
  public readonly samples: Array<Map<string, DisplaySettings>> = []
  public beforeApply: ((displayId: string) => Promise<void>) | undefined

  public override async applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    await this.beforeApply?.(displayId)
    try {
      return await super.applyDisplaySettings(displayId, settings)
    } finally {
      this.#sample()
    }
  }

  public override async restoreDisplay(displayId: string): Promise<DisplayRestoreResult> {
    try {
      return await super.restoreDisplay(displayId)
    } finally {
      this.#sample()
    }
  }

  public override async restoreAllBaselines(): Promise<RestoreAllResult> {
    try {
      return await super.restoreAllBaselines()
    } finally {
      this.#sample()
    }
  }

  #sample(): void {
    this.samples.push(snapshot(this))
  }
}

function snapshot(native: FakeNativeDisplayPort): Map<string, DisplaySettings> {
  return new Map(ids.map((id) => [id, { ...native.currentSettings.get(id) }]))
}

function foreground(executable: string): NativeEvent {
  return {
    event: 'foregroundApplicationChanged',
    data: {
      application: {
        pid: 42,
        executable,
        path: null,
        title: executable,
        monitorDeviceName: '\\\\.\\DISPLAY1'
      }
    }
  }
}

function gate() {
  let open!: () => void
  let reached!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  const arrived = new Promise<void>((resolve) => {
    reached = resolve
  })
  return { open, arrived, wait: () => (reached(), opened) }
}

async function fixture(mode: 'manual' | 'automatic') {
  const native = new SampledNative(
    0,
    ids.map((id) => testDisplay(id))
  )
  for (const [id, settings] of originals) native.currentSettings.set(id, { ...settings })
  const repository = new JsonProfileRepository(
    new MemoryStorage(
      JSON.stringify({
        schemaVersion: 3,
        profiles: [empty, live, other, alpha, beta],
        settings: { defaultProfileId: 'default' }
      })
    )
  )
  const logger = { write: () => undefined }
  const coordinator = new ActivationCoordinator(repository, native, logger)
  const activation = new AutomaticActivationController(repository, coordinator, logger)
  await activation.start(mode === 'automatic' ? { executable: 'game.exe', path: null } : null)
  if (mode === 'manual') await activation.selectManualProfile('live')
  const recovery = { restoreFailed: vi.fn(async () => {}), restored: vi.fn(async () => {}) }
  // Wired lazily, as the runtime does: the transition controller is built afterwards.
  const preview = new PreviewSessionController(
    native,
    activation,
    () => undefined,
    recovery,
    undefined,
    undefined,
    () => transitions.pending
  )
  const transitions: DisplayTransitionController = new DisplayTransitionController(
    {
      refreshDisplayTopology: async () => ({
        generation: 2,
        displays: await native.getDisplays(),
        capabilityReports: [],
        baselines: coordinator.capturedDisplayIds.map((displayId) => ({
          displayId,
          state: 'connected' as const,
          ownership: 'validated' as const
        }))
      })
    },
    activation,
    preview,
    logger,
    60_000
  )
  native.calls.length = 0
  native.samples.length = 0
  return { native, activation, coordinator, preview, recovery, transitions }
}

/** Expected provider state for each display, with Original settings everywhere else. */
function expectDisplays(native: FakeNativeDisplayPort, ...profiles: ColorProfile[]): void {
  const expected = new Map(originals)
  for (const profile of profiles) {
    for (const target of profile.displays) expected.set(target.displayId, target.color)
  }
  expect(snapshot(native)).toEqual(expected)
}

function shows(sample: Map<string, DisplaySettings>, profile: ColorProfile): boolean {
  return profile.displays.some((target) => sameSettings(sample.get(target.displayId), target.color))
}

function sameSettings(left: DisplaySettings | undefined, right: DisplaySettings): boolean {
  const canonical = (settings: DisplaySettings | undefined) =>
    JSON.stringify(Object.entries(settings ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  return canonical(left) === canonical(right)
}

function expectOriginalCaptures(native: FakeNativeDisplayPort): void {
  for (const capture of native.baselineCaptures) {
    expect(capture.settings).toEqual(originals.get(capture.displayId))
  }
}

describe('replacing one preview with another (#78)', () => {
  it.each(['manual', 'automatic'] as const)(
    'goes from A to B in %s mode without passing through live values or recapturing modified output',
    async (mode) => {
      const { native, activation, preview } = await fixture(mode)
      await preview.start(alpha, 'preview')
      expectDisplays(native, alpha)
      native.calls.length = 0
      native.samples.length = 0
      const capturesBefore = native.baselineCaptures.length

      await preview.start(beta, 'preview')

      expect(native.samples.length).toBeGreaterThan(0)
      for (const sample of native.samples) expect(shows(sample, live)).toBe(false)
      // The display both profiles target changes once, straight from A to B.
      expect(native.samples.map((sample) => sample.get(one))).toEqual([
        alpha.displays[0]!.color,
        alpha.displays[0]!.color,
        beta.displays[0]!.color,
        beta.displays[0]!.color,
        beta.displays[0]!.color
      ])
      expect(native.calls).toEqual([
        { operation: 'restore', displayId: three },
        { operation: 'restore', displayId: four },
        { operation: 'capture', displayId: one },
        { operation: 'capture', displayId: two },
        { operation: 'capture', displayId: five },
        { operation: 'apply', displayId: one, settings: beta.displays[0]!.color },
        { operation: 'apply', displayId: two, settings: beta.displays[1]!.color },
        { operation: 'apply', displayId: five, settings: beta.displays[2]!.color }
      ])
      // display:one kept its pre-preview baseline; only restored or untouched output is captured.
      expect(
        native.baselineCaptures.slice(capturesBefore).map((capture) => capture.displayId)
      ).toEqual([two, five])
      expectOriginalCaptures(native)
      expectDisplays(native, beta)
      expect(activation.state.currentTarget).toEqual({ kind: 'profile', profileId: live.id })

      await preview.cancel()
      expectDisplays(native, live)
      expect(activation.state.mode).toEqual(
        mode === 'manual' ? { kind: 'manual', profileId: live.id } : { kind: 'automatic' }
      )
      expect(activation.state.currentTarget).toEqual({ kind: 'profile', profileId: live.id })

      // Restoring every held baseline reaches the true originals: nothing compounded.
      await activation.restoreBaseline()
      expectDisplays(native)
    }
  )

  it.each(['manual', 'automatic'] as const)(
    'ends exactly where rolling back A and starting B ends in %s mode, minus the live flash',
    async (mode) => {
      const run = async (path: 'fresh' | 'swap') => {
        const f = await fixture(mode)
        await f.preview.start(alpha, 'preview')
        // A foreground change while previewing queues the next automatic target.
        await f.activation.handleNativeEvent(foreground('other.exe'))
        f.native.samples.length = 0
        if (path === 'fresh') await f.preview.cancel()
        await f.preview.start(beta, 'preview')
        const switching = [...f.native.samples]
        const during = { displays: snapshot(f.native), preview: f.preview.state }
        const hold = { ...f.activation.state }
        await f.preview.cancel()
        return {
          switching,
          during,
          hold,
          after: {
            displays: snapshot(f.native),
            mode: f.activation.state.mode,
            target: f.activation.state.currentTarget
          }
        }
      }
      const fresh = await run('fresh')
      const swap = await run('swap')
      const gap = mode === 'automatic' ? other : live

      expect(fresh.switching.some((sample) => shows(sample, gap))).toBe(true)
      expect(swap.switching.some((sample) => shows(sample, gap) || shows(sample, live))).toBe(false)
      expect(swap.during).toEqual(fresh.during)
      expect(swap.after).toEqual(fresh.after)
      expect(swap.after.target).toEqual({ kind: 'profile', profileId: gap.id })
      // The documented difference: the swap never applied the queued target, so it stays queued.
      if (mode === 'automatic') {
        expect(fresh.hold).toMatchObject({
          currentTarget: { kind: 'profile', profileId: other.id },
          queuedTarget: null
        })
        expect(swap.hold).toMatchObject({
          currentTarget: { kind: 'profile', profileId: live.id },
          queuedTarget: { kind: 'profile', profileId: other.id }
        })
      }
    }
  )

  it('confirms B manually after a swap with every display B lacks at Original settings', async () => {
    const { native, activation, preview } = await fixture('automatic')
    await preview.start(alpha, 'preview')
    await preview.start(beta, 'preview')
    await preview.confirm(beta.id)
    expect(activation.state.mode).toEqual({ kind: 'manual', profileId: beta.id })
    expectDisplays(native, beta)
    expectOriginalCaptures(native)
  })

  it.each([false, true])(
    'restores A and B completely when B fails to apply; restore also fails: %s',
    async (restoreFails) => {
      const { native, preview, recovery } = await fixture('manual')
      await preview.start(alpha, 'preview')
      native.failApplyDisplayIds.add(five)
      if (restoreFails) native.failRestoreDisplayIds.add(one)
      native.samples.length = 0

      const starting = preview.start(beta, 'preview')
      await (restoreFails
        ? expect(starting).rejects.toBeInstanceOf(PreviewRestoreError)
        : expect(starting).rejects.toThrow(`Unsupported on ${five}`))

      if (restoreFails) {
        expect(preview.state).toEqual({ state: 'restorePending', displayIds: [one] })
        expect(recovery.restoreFailed).toHaveBeenCalledOnce()
        // The hold is kept while restoration is unconfirmed: nothing reapplies live.
        expect(native.samples.some((sample) => shows(sample, live))).toBe(false)
        expectDisplays(
          native,
          profileWith('unconfirmed', null, [[one, { brightness: 33, saturation: 91 }]])
        )
        native.failRestoreDisplayIds.clear()
        await preview.cancel()
        expect(recovery.restored).toHaveBeenCalledOnce()
      }
      expect(preview.state).toEqual({ state: 'inactive' })
      expectDisplays(native, live)
      expectOriginalCaptures(native)
    }
  )

  it('keeps automatic switching held while a foreground change arrives during the swap', async () => {
    const { native, activation, preview } = await fixture('automatic')
    await preview.start(alpha, 'preview')
    const paused = gate()
    native.beforeApply = async (displayId) => {
      if (displayId === five) await paused.wait()
    }
    native.samples.length = 0

    const swapping = preview.start(beta, 'preview')
    await paused.arrived
    await activation.handleNativeEvent(foreground('other.exe'))
    expect(activation.state.queuedTarget).toEqual({ kind: 'profile', profileId: other.id })
    paused.open()
    await swapping

    for (const sample of native.samples) {
      expect(shows(sample, live) || shows(sample, other)).toBe(false)
    }
    expectDisplays(native, beta)
    native.beforeApply = undefined
    await preview.cancel()
    expectDisplays(native, other)
    expect(activation.state.currentTarget).toEqual({ kind: 'profile', profileId: other.id })
  })

  it.each(['cancel', 'close', 'topology reapply', 'retry'] as const)(
    'runs a %s queued during the swap only after B finishes',
    async (operation) => {
      const { native, preview } = await fixture('manual')
      await preview.start(alpha, 'preview')
      const paused = gate()
      native.beforeApply = async (displayId) => {
        if (displayId === five) await paused.wait()
      }
      const swapping = preview.start(beta, 'preview')
      await paused.arrived
      let finished = false
      const queued = (
        operation === 'cancel'
          ? preview.cancel()
          : operation === 'close'
            ? preview.cancelForPanelHide('close')
            : operation === 'topology reapply'
              ? preview.reapplyAfterDisplayTransition()
              : preview.retryRestoration()
      ).then(() => {
        finished = true
      })
      await Promise.resolve()
      expect(finished).toBe(false)
      native.beforeApply = undefined
      paused.open()
      await swapping
      await queued

      if (operation === 'cancel' || operation === 'close') {
        expect(preview.state).toEqual({ state: 'inactive' })
        expectDisplays(native, live)
      } else {
        expect(preview.state).toMatchObject({ state: 'active', profileId: beta.id })
        expectDisplays(native, beta)
        await preview.cancel()
        expectDisplays(native, live)
      }
    }
  )

  it('restores A before starting B while a display transition is pending, as before', async () => {
    const { native, preview, transitions } = await fixture('manual')
    try {
      await preview.start(alpha, 'preview')
      native.samples.length = 0
      // A new endpoint could share a source with A's output, so B must not capture yet.
      transitions.handleDisplayEvent('displayAdded')

      await preview.start(beta, 'preview')

      expect(native.samples.some((sample) => shows(sample, live))).toBe(true)
      expectDisplays(native, beta)
      await transitions.flush()
      expect(transitions.pending).toBe(false)
      expectDisplays(native, beta)
      expectOriginalCaptures(native)
      await preview.cancel()
      expectDisplays(native, live)
    } finally {
      transitions.dispose()
    }
  })

  it('writes no live target when the helper exits while B applies, then restores on End preview', async () => {
    const { native, activation, coordinator, preview } = await fixture('manual')
    await preview.start(alpha, 'preview')
    const paused = gate()
    native.beforeApply = async (displayId) => {
      if (displayId === five) await paused.wait()
    }
    native.samples.length = 0

    const swapping = preview.start(beta, 'preview')
    await paused.arrived
    await activation.handleNativeServiceExit()
    native.beforeApply = undefined
    paused.open()
    await swapping

    expect(activation.state.enabled).toBe(false)
    expectDisplays(native, beta)
    await preview.cancel()
    // The hold ended with the helper, so ending the session restores without a live write.
    expect(native.samples.some((sample) => shows(sample, live))).toBe(false)
    expectDisplays(native)
    expect(coordinator.capturedDisplayIds).toEqual([])
    // Recovery starts activation afresh from Original settings.
    await activation.start(null)
    expectDisplays(native, live)
    expectOriginalCaptures(native)
  })

  it('restores every display through the emergency path when it arrives mid-swap', async () => {
    const { native, activation, preview } = await fixture('manual')
    await preview.start(alpha, 'preview')
    const paused = gate()
    native.beforeApply = async (displayId) => {
      if (displayId === five) await paused.wait()
    }
    const write = vi.fn()
    const emergency = new EmergencyRestoreController(
      preview,
      activation,
      { prepareRestore: () => () => activation.restoreBaseline() },
      { write }
    )

    const swapping = preview.start(beta, 'preview')
    await paused.arrived
    const restoring = emergency.request()
    native.beforeApply = undefined
    paused.open()
    await swapping

    await expect(restoring).resolves.toBe(true)
    expect(preview.state).toEqual({ state: 'inactive' })
    expectDisplays(native)
    expectOriginalCaptures(native)
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'EmergencyRestoreCompleted', restored: true })
    )
  })
})
