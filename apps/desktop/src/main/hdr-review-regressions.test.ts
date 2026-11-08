import { describe, it, expect, vi } from 'vitest'
import {
  createNeutralColorSettings,
  JsonProfileRepository,
  manualActivationMode,
  type ColorProfile
} from '@chromashift/core'
import { NativeServiceError, type NativeEvent } from '@chromashift/native-client'
import { ActivationCoordinator } from '@main/activation-coordinator.js'
import { AutomaticActivationController } from '@main/automatic-activation-controller.js'
import { ChromaShiftController } from '@main/chroma-shift-controller.js'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort } from '@main/testing/fake-native-display.js'

const one = 'display:one'
const two = 'display:two'
const logger = { write: () => undefined }
const makeProfile = (
  id: string,
  ids: string[],
  brightness: number,
  executableName?: string
): ColorProfile => ({
  id,
  name: id,
  enabled: true,
  applications: executableName ? [{ executableName }] : [],
  displays: ids.map((displayId) => ({
    displayId,
    color: { ...createNeutralColorSettings(), brightness }
  }))
})
const repo = (profiles: ColorProfile[]) =>
  new JsonProfileRepository({
    read: async () =>
      JSON.stringify({ schemaVersion: 2, profiles, settings: { defaultProfileId: 'default' } }),
    write: async () => undefined
  })
const event = (executable: string): NativeEvent => ({
  event: 'foregroundApplicationChanged',
  data: {
    application: { pid: 100, executable, path: null, title: executable, monitorDeviceName: null }
  }
})

describe('review-90 deterministic proofs', () => {
  it('stays Safety blocked if HDR turns off and native baseline-first apply still cannot restore', async () => {
    const native = new FakeNativeDisplayPort()
    const repository = repo([makeProfile('default', [one], 30)])
    const coordinator = new ActivationCoordinator(repository, native, logger)
    const activation = new AutomaticActivationController(repository, coordinator, logger)
    const control = new ChromaShiftController(
      activation,
      {
        refreshTopology: async () => ({ baselines: [] })
      },
      { cancel: async () => undefined },
      {
        status: 'active',
        pendingOperation: null,
        intendedMode: { kind: 'automatic' },
        intendedTarget: { kind: 'profile', profileId: 'default' }
      },
      async () => undefined,
      logger
    )
    await activation.start(null)
    native.hdrDisplayIds.add(one)
    native.failRestoreDisplayIds.add(one)
    await coordinator.resetForDisplayTransition()
    const failure = await activation.enableAutomatic()
    await control.recordCompletedOutcome(failure)
    expect(control.chromaShiftState.status).toBe('safetyBlocked')
    native.hdrDisplayIds.clear()
    // BaselineManager.Apply calls RestoreEntry before profile writes and returns
    // this error if the same baseline write/read-back failure remains in SDR.
    vi.spyOn(native, 'applyDisplaySettings').mockRejectedValue(
      new NativeServiceError(
        'BASELINE_RESTORE_FAILED',
        'baseline-first restoration still fails',
        'display.apply',
        'test'
      )
    )
    const result = await control.retrySafetyCheck('manual')
    expect(result.failures).toContainEqual(
      expect.objectContaining({ operation: 'apply', code: 'BASELINE_RESTORE_FAILED' })
    )
    expect(control.chromaShiftState.status).toBe('safetyBlocked')
  })
  it('preserves a dirty draft after an HDR restore fails once and rollback succeeds', async () => {
    const native = new FakeNativeDisplayPort()
    const saved = makeProfile('saved', [one, two], 50)
    const draft = makeProfile('saved', [one, two], 30)
    const preview = new PreviewSessionController(
      native,
      {
        beginPreview: async () => [],
        cancelPreview: async () => undefined,
        confirmPreview: async () => undefined
      },
      () => undefined
    )
    await preview.start(draft, 'edit', saved)
    native.hdrDisplayIds.add(one)
    const restore = native.restoreDisplay.bind(native)
    vi.spyOn(native, 'restoreDisplay')
      .mockImplementationOnce(async () => {
        throw new NativeServiceError(
          'BASELINE_RESTORE_FAILED',
          'one-time read-back mismatch',
          'display.restore',
          'test'
        )
      })
      .mockImplementation(restore)
    await expect(preview.reapplyAfterDisplayTransition()).rejects.toThrow('could not be restored')
    expect.soft(preview.unsavedDraft).toEqual(draft)
    expect.soft(native.currentSettings.get(two)?.brightness).toBe(30)
    expect(preview.state).toMatchObject({ state: 'active', draft, unsavedChanges: true })
    const before = native.calls.length
    await preview.reapplyAfterDisplayTransition()
    await expect(preview.update(draft.id, draft.displays, draft)).rejects.toThrow(
      'pending displays'
    )
    expect(native.calls).toHaveLength(before)
    await expect(preview.retryRestoration()).resolves.toBe(true)
    expect(preview.unsavedDraft).toEqual(draft)
    expect(native.currentSettings.get(one)).toEqual({})
    expect(native.currentSettings.get(two)?.brightness).toBe(30)
    native.hdrDisplayIds.clear()
    await preview.reapplyAfterDisplayTransition()
    expect(native.currentSettings.get(one)?.brightness).toBe(30)
    expect(native.currentSettings.get(two)?.brightness).toBe(30)
    const changed = { ...draft, name: 'Still editable after Retry' }
    await preview.update(changed.id, changed.displays, changed)
    expect(preview.unsavedDraft).toEqual(changed)
  })

  it('does not apply SDR targets after an HDR restoration has failed in the same transition', async () => {
    const native = new FakeNativeDisplayPort()
    const initial = makeProfile('default', [one, two], 50)
    const next = makeProfile('next', [one, two], 30)
    const coordinator = new ActivationCoordinator(repo([initial, next]), native, logger)
    await coordinator.activate(null)
    native.hdrDisplayIds.add(one)
    native.failRestoreDisplayIds.add(one)
    const before = native.calls.length
    const result = await coordinator.activate(null, manualActivationMode(next.id))
    expect(result.failures).toContainEqual(
      expect.objectContaining({ operation: 'restore', displayId: one })
    )
    expect(native.calls.slice(before).filter((c) => c.operation === 'apply')).toEqual([])
  })

  it('cancels already queued foreground writes after an HDR restoration fails', async () => {
    const native = new FakeNativeDisplayPort()
    const initial = makeProfile('default', [one, two], 50)
    const next = makeProfile('next', [one, two], 30, 'Next.exe')
    const last = makeProfile('last', [two], 40, 'Last.exe')
    const repository = repo([initial, next, last])
    const coordinator = new ActivationCoordinator(repository, native, logger)
    const activation = new AutomaticActivationController(repository, coordinator, logger)
    const control = new ChromaShiftController(
      activation,
      {
        refreshTopology: async () => ({ baselines: [] })
      },
      { cancel: async () => undefined },
      {
        status: 'active',
        pendingOperation: null,
        intendedMode: { kind: 'automatic' },
        intendedTarget: { kind: 'profile', profileId: 'default' }
      },
      async () => undefined,
      logger
    )
    activation.subscribeOutcomes((outcome) => {
      void control.recordCompletedOutcome(outcome)
    })
    await activation.start(null)
    native.hdrDisplayIds.add(one)
    native.failRestoreDisplayIds.add(one)
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const restore = native.restoreDisplay.bind(native)
    vi.spyOn(native, 'restoreDisplay').mockImplementationOnce(async (id) => {
      enter()
      await released
      return restore(id)
    })
    const a = activation.handleNativeEvent(event('Next.exe'))
    await entered
    const b = activation.handleNativeEvent(event('Last.exe'))
    const before = native.calls.length
    release()
    await Promise.all([a, b])
    expect(control.chromaShiftState.status).toBe('safetyBlocked')
    expect(
      native.calls
        .slice(before)
        .filter((c) => c.operation === 'apply' && c.settings?.brightness === 40)
    ).toEqual([])
  })

  it('confirms tracked restorations before recovery can write any profile targets', async () => {
    const native = new FakeNativeDisplayPort()
    const repository = repo([makeProfile('default', [one, two], 30)])
    const coordinator = new ActivationCoordinator(repository, native, logger)
    await coordinator.activate(null)
    native.hdrDisplayIds.add(one)
    native.failRestoreDisplayIds.add(one)
    await coordinator.resetForDisplayTransition()
    await coordinator.activate(null)
    native.hdrDisplayIds.clear()
    native.failRestoreAllDisplayIds.add(one)
    const before = native.calls.length
    const result = await coordinator.activate(null, undefined, { recovery: true })
    expect(result.failures).toContainEqual(
      expect.objectContaining({ operation: 'restoreAll', displayId: one })
    )
    expect(native.calls.slice(before)).toEqual([{ operation: 'restoreAll' }])
    await coordinator.activate(null)
    expect(native.calls).toHaveLength(before + 1)
    native.failRestoreDisplayIds.clear()
    native.failRestoreAllDisplayIds.clear()
    await coordinator.activate(null, undefined, { recovery: true })
    expect(native.currentSettings.get(one)?.brightness).toBe(30)
    expect(native.currentSettings.get(two)?.brightness).toBe(30)
    expect(coordinator.restorationBlocked).toBe(false)
  })

  it('stops the remaining displays and queued activation when native Apply cannot restore its baseline', async () => {
    const native = new FakeNativeDisplayPort()
    const repository = repo([
      makeProfile('default', [one, two], 30),
      makeProfile('next', [two], 40)
    ])
    const coordinator = new ActivationCoordinator(repository, native, logger)
    const apply = vi
      .spyOn(native, 'applyDisplaySettings')
      .mockRejectedValueOnce(
        new NativeServiceError(
          'BASELINE_RESTORE_FAILED',
          'baseline-first restore failed',
          'display.apply',
          'test'
        )
      )
    const failed = coordinator.activate(null)
    const queued = coordinator.activate(null, manualActivationMode('next'))
    expect((await failed).failures).toContainEqual(
      expect.objectContaining({ operation: 'apply', code: 'BASELINE_RESTORE_FAILED' })
    )
    expect((await queued).failures).toContainEqual(
      expect.objectContaining({ code: 'RESTORE_PENDING' })
    )
    expect(apply).toHaveBeenCalledExactlyOnceWith(
      one,
      makeProfile('default', [one], 30).displays[0]!.color
    )
    expect(native.currentSettings.has(two)).toBe(false)
  })

  it('rejects a preview queued while an activation restore fails', async () => {
    const native = new FakeNativeDisplayPort()
    const repository = repo([
      makeProfile('default', [one, two], 50),
      makeProfile('next', [two], 30, 'Next.exe')
    ])
    const coordinator = new ActivationCoordinator(repository, native, logger)
    const activation = new AutomaticActivationController(repository, coordinator, logger)
    await activation.start(null)
    native.failRestoreDisplayIds.add(one)
    let release!: () => void
    let enter!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const restore = native.restoreDisplay.bind(native)
    vi.spyOn(native, 'restoreDisplay').mockImplementationOnce(async (id) => {
      enter()
      await gate
      return restore(id)
    })
    const foreground = activation.handleNativeEvent(event('Next.exe'))
    await entered
    const beginning = activation.beginPreview()
    const rejected = expect(beginning).rejects.toThrow('pending displays')
    const before = native.calls.length
    release()
    await foreground
    await rejected
    expect(native.calls.slice(before).filter((call) => call.operation === 'apply')).toEqual([])
    await expect(activation.beginPreview()).rejects.toThrow('pending displays')
  })
})
