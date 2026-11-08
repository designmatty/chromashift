import {
  JsonProfileRepository,
  createNeutralColorSettings,
  type ColorProfile,
  type ColorSettings,
  type ProfileConfigurationStorage
} from '@chromashift/core'
import { describe, expect, it, vi } from 'vitest'
import { ActivationCoordinator } from '@main/activation-coordinator.js'
import { AutomaticActivationController } from '@main/automatic-activation-controller.js'
import { DisplayTransitionController } from '@main/display-transition-controller.js'
import { EmergencyRestoreController } from '@main/emergency-restore-controller.js'
import { PreviewRestoreError, PreviewSessionController } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort, testDisplay } from '@main/testing/fake-native-display.js'

const one = 'display:one'
const two = 'display:two'
const three = 'display:three'
const color = (values: Partial<ColorSettings>): ColorSettings => ({
  ...createNeutralColorSettings(),
  ...values
})
const originals = new Map([
  [one, color({ brightness: 44, saturation: 38 })],
  [two, color({ brightness: 47, saturation: 42 })],
  [three, color({ brightness: 49, saturation: 46 })]
])
const live: ColorProfile = {
  id: 'live',
  name: 'Live',
  enabled: true,
  applications: [{ executableName: 'game.exe' }],
  displays: [
    { displayId: one, color: color({ brightness: 62, saturation: 72 }) },
    { displayId: two, color: color({ brightness: 64, saturation: 78 }) }
  ]
}
const empty: ColorProfile = {
  id: 'default',
  name: 'Default',
  enabled: true,
  applications: [],
  displays: []
}
const partial: ColorProfile = {
  id: 'partial',
  name: 'Partial',
  enabled: true,
  applications: [],
  displays: [{ displayId: one, color: color({ brightness: 55, saturation: 59 }) }]
}
class MemoryStorage implements ProfileConfigurationStorage {
  public constructor(private contents: string) {}
  public async read(): Promise<string> {
    return this.contents
  }
  public async write(contents: string): Promise<void> {
    this.contents = contents
  }
}

async function fixture(mode: 'manual' | 'automatic' = 'manual') {
  const native = new FakeNativeDisplayPort(0, [
    testDisplay(one),
    testDisplay(two),
    testDisplay(three)
  ])
  for (const [id, settings] of originals) native.currentSettings.set(id, { ...settings })
  const repository = new JsonProfileRepository(
    new MemoryStorage(
      JSON.stringify({
        schemaVersion: 3,
        profiles: [empty, live, partial],
        settings: { defaultProfileId: 'default' }
      })
    )
  )
  const logger = { write: () => undefined }
  const coordinator = new ActivationCoordinator(repository, native, logger)
  const activation = new AutomaticActivationController(repository, coordinator, logger)
  await activation.start(mode === 'automatic' ? { executable: 'game.exe', path: null } : null)
  if (mode === 'manual') await activation.selectManualProfile('live')
  const stateChanged = vi.fn()
  const preview = new PreviewSessionController(native, activation, stateChanged)
  native.calls.length = 0
  return { native, activation, preview, coordinator, repository, stateChanged }
}

function expectLive(native: FakeNativeDisplayPort) {
  for (const target of live.displays) {
    expect(native.currentSettings.get(target.displayId)).toEqual(target.color)
  }
  expect(native.currentSettings.get(three)).toEqual(originals.get(three))
  // Successful resolver deduplication must not suppress either rollback write.
  expect(native.calls.filter((call) => call.operation === 'apply')).toEqual(
    live.displays.map((target) => ({
      operation: 'apply',
      displayId: target.displayId,
      settings: target.color
    }))
  )
}

function expectOriginalCaptures(native: FakeNativeDisplayPort) {
  for (const capture of native.baselineCaptures) {
    expect(capture.settings).toEqual(originals.get(capture.displayId))
  }
}

describe('true baseline preview with activation rollback', () => {
  it.each(['manual', 'automatic'] as const)(
    'emergency restore reaches Original settings after a transient preview teardown failure in %s mode',
    async (mode) => {
      const { native, activation, preview } = await fixture(mode)
      await preview.start(partial, 'preview')
      native.calls.length = 0
      vi.spyOn(native, 'restoreDisplay').mockRejectedValueOnce(
        new Error('transient restore failure')
      )
      const write = vi.fn()
      const emergency = new EmergencyRestoreController(
        preview,
        activation,
        { prepareRestore: () => () => activation.restoreBaseline() },
        { write }
      )

      await expect(emergency.request()).resolves.toBe(true)

      expect(preview.state).toEqual({ state: 'inactive' })
      expect(native.calls.filter((call) => call.operation === 'apply')).toEqual(
        live.displays.map((target) => ({
          operation: 'apply',
          displayId: target.displayId,
          settings: target.color
        }))
      )
      expect(native.calls.at(-1)).toEqual({ operation: 'restoreAll' })
      for (const [id, original] of originals)
        expect(native.currentSettings.get(id)).toEqual(original)
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'critical',
          eventName: 'EmergencyPreviewTeardownFailed'
        })
      )
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'EmergencyRestoreCompleted',
          restored: true
        })
      )
      expectOriginalCaptures(native)
    }
  )

  it.each(['manual', 'automatic'] as const)(
    'previews empty Default over a %s profile without capture, then reapplies every prior target',
    async (mode) => {
      const { native, activation, preview } = await fixture(mode)
      const previousMode = activation.state.mode
      await preview.start(empty, 'preview')
      expect(preview.state).toMatchObject({ state: 'active', kind: 'preview', targets: [] })
      expect(native.calls).toEqual([
        { operation: 'restore', displayId: one },
        { operation: 'restore', displayId: two }
      ])
      for (const [id, original] of originals)
        expect(native.currentSettings.get(id)).toEqual(original)
      native.calls.length = 0
      await preview.cancel()
      expectLive(native)
      expect(activation.state.mode).toEqual(previousMode)
      expect(preview.state).toEqual({ state: 'inactive' })
      expectOriginalCaptures(native)
    }
  )

  it('applies the assigned target while holding the other display at Original settings', async () => {
    const { native, preview } = await fixture()
    await preview.start(partial, 'preview')
    expect(native.calls).toEqual([
      { operation: 'restore', displayId: two },
      { operation: 'capture', displayId: one },
      { operation: 'apply', displayId: one, settings: partial.displays[0]!.color }
    ])
    expect(native.currentSettings.get(one)).toEqual(partial.displays[0]!.color)
    expect(native.currentSettings.get(two)).toEqual(originals.get(two))
    native.calls.length = 0
    await preview.cancel()
    expectLive(native)
    expectOriginalCaptures(native)
  })

  it('promotes empty Preview in place, then adds, removes and re-adds a target from Original settings', async () => {
    const { native, preview } = await fixture()
    await preview.start(empty, 'preview')
    native.calls.length = 0
    await preview.start(empty, 'edit')
    expect(native.calls).toEqual([])
    await preview.update(empty.id, partial.displays)
    expect(native.calls).toEqual([
      { operation: 'capture', displayId: one },
      { operation: 'apply', displayId: one, settings: partial.displays[0]!.color }
    ])
    native.calls.length = 0
    await preview.update(empty.id, [])
    expect(native.calls).toEqual([{ operation: 'restore', displayId: one }])
    expect(native.currentSettings.get(one)).toEqual(originals.get(one))
    await preview.update(empty.id, partial.displays)
    expect(native.currentSettings.get(one)).toEqual(partial.displays[0]!.color)
    expect(native.currentSettings.get(two)).toEqual(originals.get(two))
    native.calls.length = 0
    await preview.cancel()
    expectLive(native)
    expectOriginalCaptures(native)
  })

  it('performs no native writes or capture for an empty preview with no owned baseline', async () => {
    const { native, activation, preview } = await fixture()
    await activation.enableAutomatic()
    native.calls.length = 0
    await preview.start(empty, 'preview')
    await preview.cancel()
    expect(native.calls).toEqual([])
    expectOriginalCaptures(native)
  })

  it('rolls back the whole session after a transient restore failure during start', async () => {
    const { native, preview } = await fixture()
    const restore = native.restoreDisplay.bind(native)
    vi.spyOn(native, 'restoreDisplay')
      .mockImplementationOnce(async () => {
        throw new Error('restore failed')
      })
      .mockImplementation(restore)
    await expect(preview.start(empty, 'preview')).rejects.toBeInstanceOf(PreviewRestoreError)
    expect(preview.state).toEqual({ state: 'inactive' })
    expectLive(native)
    expectOriginalCaptures(native)
  })

  it('attempts all restores and retains a failed baseline when start rollback also fails', async () => {
    const { native, preview, coordinator } = await fixture()
    native.failRestoreDisplayIds.add(one)
    await expect(preview.start(empty, 'preview')).rejects.toBeInstanceOf(PreviewRestoreError)
    expect(native.calls.filter((call) => call.operation === 'restore')).toEqual([
      { operation: 'restore', displayId: one },
      { operation: 'restore', displayId: two },
      { operation: 'restore', displayId: one },
      { operation: 'restore', displayId: two }
    ])
    expect(coordinator.capturedDisplayIds).toContain(one)
    expect(preview.state).toEqual({ state: 'restorePending', displayIds: [one] })
    expect(native.calls.filter((call) => call.operation === 'apply')).toEqual([])
    native.failRestoreDisplayIds.clear()
    native.calls.length = 0
    await preview.cancel()
    expectLive(native)
    expectOriginalCaptures(native)
  })

  it('treats an unsuccessful native restore result as a whole-session preview failure', async () => {
    const { native, preview } = await fixture()
    vi.spyOn(native, 'restoreDisplay').mockResolvedValueOnce({
      displayId: one,
      restored: false,
      code: 'BASELINE_RESTORE_FAILED',
      error: 'read-back failed'
    })
    await expect(preview.start(empty, 'preview')).rejects.toBeInstanceOf(PreviewRestoreError)
    expect(preview.state).toEqual({ state: 'inactive' })
    expectLive(native)
    expectOriginalCaptures(native)
  })

  it('returns every display to the prior target when removing a target fails to restore', async () => {
    const { native, preview } = await fixture()
    await preview.start(partial, 'edit')
    native.calls.length = 0
    const restore = native.restoreDisplay.bind(native)
    vi.spyOn(native, 'restoreDisplay')
      .mockImplementationOnce(async () => {
        throw new Error('restore failed')
      })
      .mockImplementation(restore)
    await expect(preview.update(partial.id, [])).rejects.toBeInstanceOf(PreviewRestoreError)
    expect(preview.state).toEqual({ state: 'inactive' })
    expectLive(native)
    expectOriginalCaptures(native)
  })

  it('restores the whole session after a newly assigned target fails to apply', async () => {
    const { native, preview } = await fixture()
    await preview.start(empty, 'edit')
    native.calls.length = 0
    const apply = native.applyDisplaySettings.bind(native)
    vi.spyOn(native, 'applyDisplaySettings')
      .mockImplementationOnce(async () => {
        throw new Error('partial apply failed')
      })
      .mockImplementation(apply)
    await expect(preview.update(empty.id, partial.displays)).rejects.toThrow('partial apply failed')
    expect(preview.state).toEqual({ state: 'inactive' })
    expect(
      native.calls.filter((call) => call.operation === 'restore').map((call) => call.displayId)
    ).toEqual([one, two])
    expectLive(native)
    expectOriginalCaptures(native)
  })

  it.each(['disconnected', 'hdr'] as const)(
    'handles a missing %s display and reapplies after reconnect or HDR-off',
    async (state) => {
      const { native, preview, activation, coordinator } = await fixture()
      const deferred = state === 'hdr' ? native.hdrDisplayIds : native.disconnectedDisplayIds
      deferred.add(two)
      await preview.start(empty, 'preview')
      expect(native.calls).toEqual(
        state === 'hdr'
          ? [
              { operation: 'restore', displayId: two },
              { operation: 'restore', displayId: one }
            ]
          : [{ operation: 'restore', displayId: one }]
      )
      await preview.cancel()
      expect(coordinator.capturedDisplayIds.includes(two)).toBe(state === 'disconnected')
      expect(native.calls.filter((call) => call.displayId === two)).toEqual(
        state === 'hdr' ? [{ operation: 'restore', displayId: two }] : []
      )
      if (state === 'hdr') expect(native.currentSettings.get(two)).toEqual(originals.get(two))
      deferred.delete(two)
      native.calls.length = 0
      await activation.beginSystemTransition()
      await activation.completeSystemTransition(true)
      expectLive(native)
      expectOriginalCaptures(native)
    }
  )

  it('holds a retained missing target at Original settings when it reconnects during preview', async () => {
    const { native, preview } = await fixture()
    native.disconnectedDisplayIds.add(two)
    await preview.start(empty, 'preview')
    native.calls.length = 0
    native.disconnectedDisplayIds.delete(two)
    await preview.reapplyAfterDisplayTransition()
    expect(native.calls.filter((call) => call.operation !== 'restore')).toEqual([])
    expect(native.currentSettings.get(two)).toEqual(originals.get(two))
    native.calls.length = 0
    await preview.cancel()
    expectLive(native)
    expectOriginalCaptures(native)
  })

  it.each([
    { mode: 'manual' as const, failure: 'throws' },
    { mode: 'automatic' as const, failure: 'throws' },
    { mode: 'manual' as const, failure: 'unsuccessful result' },
    { mode: 'automatic' as const, failure: 'unsuccessful result' },
    { mode: 'manual' as const, failure: 'also fails during teardown' }
  ])(
    'rolls back the whole preview and reports a reconnect restore failure in $mode mode when restore $failure',
    async ({ mode, failure }) => {
      const { native, preview, activation, coordinator, stateChanged } = await fixture(mode)
      const previousMode = activation.state.mode
      native.disconnectedDisplayIds.add(two)
      await preview.start(empty, 'preview')
      expect(native.currentSettings.get(one)).toEqual(originals.get(one))
      expect(native.currentSettings.get(two)).toEqual(live.displays[1]!.color)
      native.disconnectedDisplayIds.delete(two)
      native.calls.length = 0
      const restore = native.restoreDisplay.bind(native)
      if (failure === 'also fails during teardown') native.failRestoreDisplayIds.add(two)
      else {
        vi.spyOn(native, 'restoreDisplay').mockImplementation(async (id) => {
          if (id !== two) return restore(id)
          vi.mocked(native.restoreDisplay).mockImplementation(restore)
          if (failure === 'throws') throw new Error('reconnect restore failed')
          return {
            displayId: id,
            restored: false,
            code: 'BASELINE_RESTORE_FAILED',
            error: 'read-back failed'
          }
        })
      }
      const write = vi.fn()
      const onPreviewFailed = vi.fn(() => {
        if (failure === 'also fails during teardown') {
          expect(preview.state).toEqual({ state: 'restorePending', displayIds: [two] })
          return
        }
        expect(preview.state).toEqual({ state: 'inactive' })
        expectLive(native)
      })
      const complete = vi.spyOn(activation, 'completeSystemTransition')
      const transitions = new DisplayTransitionController(
        {
          refreshDisplayTopology: async () => ({
            generation: 2,
            displays: await native.getDisplays(),
            capabilityReports: [],
            baselines: coordinator.capturedDisplayIds.map((displayId) => ({
              displayId,
              state: 'connected',
              ownership: 'validated'
            }))
          })
        },
        activation,
        preview,
        { write },
        60_000,
        () => undefined,
        onPreviewFailed
      )

      try {
        transitions.handleDisplayEvent('displayAdded')
        await transitions.flush()

        expect(onPreviewFailed).toHaveBeenCalledExactlyOnceWith(expect.any(PreviewRestoreError))
        const expectedState =
          failure === 'also fails during teardown'
            ? { state: 'restorePending', displayIds: [two] }
            : { state: 'inactive' }
        expect(stateChanged).toHaveBeenLastCalledWith(expectedState)
        expect(preview.state).toEqual(expectedState)
        expect(activation.state.mode).toEqual(previousMode)
        expect(complete).toHaveBeenCalledExactlyOnceWith(false, true)
        expect(write).toHaveBeenCalledWith(
          expect.objectContaining({ eventName: 'DisplayTransitionFailed' })
        )
        if (failure !== 'also fails during teardown') expectLive(native)
        expectOriginalCaptures(native)
        expect(native.maxConcurrentCalls).toBe(1)

        // Rollback must release the preview hold so future activation can proceed.
        native.failRestoreDisplayIds.clear()
        if (failure === 'also fails during teardown') await preview.cancel()
        await activation.enableAutomatic()
        expect(activation.state.currentTarget).toEqual(
          mode === 'manual'
            ? { kind: 'profile', profileId: empty.id }
            : { kind: 'profile', profileId: live.id }
        )
      } finally {
        transitions.dispose()
      }
    }
  )

  it.each(['cancel', 'cancelNonOverride', 'dispose'] as const)(
    'surfaces held-baseline restore failures during %s',
    async (end) => {
      const { native, preview } = await fixture()
      native.disconnectedDisplayIds.add(two)
      await preview.start(empty, 'preview')
      native.disconnectedDisplayIds.delete(two)
      native.failRestoreDisplayIds.add(two)
      native.calls.length = 0
      await expect(preview[end]()).rejects.toBeInstanceOf(PreviewRestoreError)
      expect(preview.state).toEqual({ state: 'restorePending', displayIds: [two] })
      expect(native.calls.filter((call) => call.operation === 'apply')).toEqual([])
      native.failRestoreDisplayIds.clear()
      await preview[end]()
      expect(preview.state).toEqual({ state: 'inactive' })
      expectLive(native)
      expectOriginalCaptures(native)
    }
  )

  it.each(['manual', 'automatic'] as const)(
    'keeps %s mode when committing an edit with a missing target',
    async (mode) => {
      const { native, preview, activation, repository } = await fixture(mode)
      const previousMode = activation.state.mode
      await preview.start(partial, 'edit')
      await repository.save(partial)
      native.calls.length = 0
      await preview.completePreservingMode(partial.id)
      expectLive(native)
      expect(activation.state.mode).toEqual(previousMode)
      expectOriginalCaptures(native)
    }
  )

  it('confirms empty Default through the existing manual-selection completion path', async () => {
    const { native, preview, activation } = await fixture()
    await preview.start(empty, 'preview')
    native.calls.length = 0
    await preview.confirm(empty.id)
    expect(activation.state.mode).toEqual({ kind: 'manual', profileId: 'default' })
    expect(native.calls.filter((call) => call.operation !== 'restore')).toEqual([])
    for (const [id, original] of originals) expect(native.currentSettings.get(id)).toEqual(original)
    expectOriginalCaptures(native)
  })

  it('commits a removed live target while preserving automatic mode', async () => {
    const { native, preview, activation, repository } = await fixture('automatic')
    const edited = { ...live, displays: partial.displays }
    await preview.start(edited, 'edit')
    await repository.save(edited)
    native.calls.length = 0
    await preview.completePreservingMode(live.id)
    expect(activation.state.mode).toEqual({ kind: 'automatic' })
    expect(native.currentSettings.get(one)).toEqual(partial.displays[0]!.color)
    expect(native.currentSettings.get(two)).toEqual(originals.get(two))
    expect(native.calls.filter((call) => call.operation === 'apply')).toEqual([
      { operation: 'apply', displayId: one, settings: partial.displays[0]!.color }
    ])
    expectOriginalCaptures(native)
  })

  it('restores HDR assigned and missing targets without capture or profile writes', async () => {
    const { native, preview } = await fixture()
    native.hdrDisplayIds.add(one)
    native.hdrDisplayIds.add(two)
    await preview.start(partial, 'preview')
    await preview.update(partial.id, [{ displayId: one, color: color({ brightness: 70 }) }])
    await preview.cancel()
    expect(native.calls).toEqual([
      { operation: 'restore', displayId: one },
      { operation: 'restore', displayId: two }
    ])
    expect(native.currentSettings.get(one)).toEqual(originals.get(one))
    expect(native.currentSettings.get(two)).toEqual(originals.get(two))
    expectOriginalCaptures(native)
  })
})
