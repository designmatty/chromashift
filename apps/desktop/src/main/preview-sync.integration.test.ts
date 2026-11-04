import { createNeutralColorSettings, JsonProfileRepository, type ColorProfile } from '@chromashift/core'
import { afterEach, expect, it, vi } from 'vitest'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { PreviewRestoreError } from '@main/preview-session-controller.js'
import { ProductController } from '@main/product-controller.js'
import { defaultUserPreferences } from '@main/app-settings.js'
import { FakeNativeDisplayPort, testDisplay } from '@main/testing/fake-native-display.js'
import {
  PreviewSyncSession,
  PREVIEW_SYNC_DEBOUNCE_MS
} from '@/features/profiles/preview-sync.js'
import { emptyPreviewMessage, shouldPreviewProfile } from '@/features/profiles/app-preview-state.js'
import type { PreviewState, ProductError, ProductResult } from '@shared/product-api.js'

const profile: ColorProfile = {
  id: 'gaming',
  name: 'Gaming',
  enabled: true,
  applications: [],
  displays: [
    { displayId: 'display:abc', color: { ...createNeutralColorSettings(), brightness: 84 } }
  ]
}
const ok: ProductResult<null> = { ok: true, value: null }
afterEach(() => vi.useRealTimers())
it('app rollback reports PreviewRestoreError even when teardown has published inactive', async () => {
  const native = new FakeNativeDisplayPort(0, [testDisplay('display:abc')])
  const controller = new PreviewSessionController(native, {
    beginPreview: async () => undefined,
    cancelPreview: async () => undefined,
    confirmPreview: async () => undefined
  }, () => undefined)
  await controller.start(profile, 'preview')
  native.failRestoreDisplayIds.add('display:abc')
  const errors: (ProductError | null)[] = []
  const sync = new PreviewSyncSession({
    startPreview: async () => ok,
    updatePreview: async () => ok,
    cancelPreview: async () => {
      try {
        await controller.cancel()
        return ok
      } catch (error) {
        expect(error).toBeInstanceOf(PreviewRestoreError)
        return { ok: false, error: { code: 'OPERATION_FAILED', message: (error as Error).message } }
      }
    }
  }, 'edit', (error) => errors.push(error))
  await expect(sync.rollback(true)).rejects.toMatchObject({ message: expect.stringContaining('Some displays could not be restored.') })
  expect(controller.state).toEqual({ state: 'inactive' })
  expect(errors).toEqual([{ code: 'OPERATION_FAILED', message: expect.stringContaining('Some displays could not be restored.') }])
})
it('promotes a clicked preview before applying edits without restoring or recapturing', async () => {
  vi.useFakeTimers()
  const native = new FakeNativeDisplayPort(0, [testDisplay('display:abc')])
  const controller = new PreviewSessionController(native, {
    beginPreview: async () => undefined,
    cancelPreview: async () => undefined,
    confirmPreview: async () => undefined
  }, () => undefined)
  const sync = new PreviewSyncSession({
    startPreview: async (draft, kind) => { await controller.start(draft, kind); return ok },
    updatePreview: async (id, targets) => { await controller.update(id, targets); return ok },
    cancelPreview: async () => { await controller.cancel(); return ok }
  }, 'edit', () => undefined)
  // Sidebar navigation settles the previous draft before starting the clicked
  // profile outside the draft synchronizer.
  await sync.rollback()
  await controller.start(profile, 'preview')
  const clicked = controller.state
  const changed = structuredClone(profile)
  changed.displays[0]!.color.brightness = 61
  sync.schedule(changed, clicked)
  await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
  expect(controller.state).toMatchObject({ kind: 'edit', targets: [{ color: { brightness: 61 } }] })
  expect(native.captured).toEqual(['display:abc'])
  expect(native.restored).toEqual([])
  expect(native.applied.map((entry) => entry.settings.brightness)).toEqual([84, 61])
})

it.each(['pending', 'completed'] as const)(
  'restarts an override edited with a stale session after %s rollback',
  async (timing) => {
    vi.useFakeTimers()
    const errors: (ProductError | null)[] = []
    const native = new FakeNativeDisplayPort(0, [testDisplay('display:abc')])
    let releaseCancel!: () => void
    const cancelling = new Promise<void>((resolve) => {
      releaseCancel = resolve
    })
    const controller = new PreviewSessionController(
      native,
      {
        beginPreview: async () => undefined,
        cancelPreview: () => cancelling,
        confirmPreview: async () => undefined
      },
      () => undefined
    )
    const overrideSession = new PreviewSyncSession(
      {
        startPreview: async (draft, kind) => {
          await controller.start(draft, kind)
          return ok
        },
        updatePreview: async (profileId, targets) => {
          await controller.update(profileId, targets)
          return ok
        },
        cancelPreview: async () => {
          await controller.cancel()
          return ok
        }
      },
      'override',
      (error) => errors.push(error)
    )
    await controller.start(profile, 'override')
    const staleSession = controller.state
    const rollback = overrideSession.rollback()
    if (timing === 'completed') {
      releaseCancel()
      await rollback
    }
    const changed = structuredClone(profile)
    changed.displays[0]!.color.brightness = 61
    overrideSession.schedule(changed, staleSession)
    await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    if (timing === 'pending') {
      expect(native.applied.map((entry) => entry.settings.brightness)).toEqual([84])
    }
    releaseCancel()
    await rollback
    await vi.runAllTimersAsync()

    expect(errors.filter((error) => error !== null)).toEqual([])
    expect(controller.state).toMatchObject({
      state: 'active',
      kind: 'override',
      targets: [{ color: { brightness: 61 } }]
    })
  }
)

it('previews a new profile at neutral values and promotes its first edit in place', async () => {
  vi.useFakeTimers()
  const native = new FakeNativeDisplayPort(0, [
    testDisplay('display:one'),
    testDisplay('display:two')
  ])
  const previewController = new PreviewSessionController(
    native,
    {
      beginPreview: async () => undefined,
      cancelPreview: async () => undefined,
      confirmPreview: async () => undefined
    },
    () => undefined
  )
  const outcome = { status: 'activated' as const, resolution: null, failures: [], deferredDisplayIds: [] }
  let stored: string | null = null
  const product = new ProductController(
    new JsonProfileRepository({
      read: async () => stored,
      write: async (contents) => {
        stored = contents
      }
    }),
    {
      getDisplays: () => native.getDisplays(),
      getDisplayCapabilityReport: (id) => native.getDisplayCapabilityReport(id),
      getForegroundApplication: async () => null,
      getVisibleApplications: async () => []
    },
    {
      state: { enabled: true, mode: { kind: 'automatic' }, currentTarget: null },
      chromaShiftState: {
        status: 'active',
        pendingOperation: null,
        intendedMode: { kind: 'automatic' },
        intendedTarget: { kind: 'profile', profileId: 'default' },
        transitionInProgress: false
      },
      selectManualProfile: async () => outcome,
      enableAutomatic: async () => outcome,
      restoreBaseline: async () => outcome,
      pause: async () => outcome,
      resume: async () => outcome,
      retrySafetyCheck: async () => outcome,
      reconcileAutomaticIntent: async () => undefined,
      refreshAfterConfigurationChange: async () => undefined
    },
    previewController,
    { pick: async () => null, describe: async () => null },
    { get: async () => defaultUserPreferences, save: async (value) => value, apply: () => undefined },
    { refreshTray: async () => undefined, stateChanged: () => undefined }
  )
  const sessions: PreviewState[] = []
  const sync = new PreviewSyncSession(
    {
      startPreview: async (draft, kind) => {
        await previewController.start(draft, kind)
        sessions.push(previewController.state)
        return ok
      },
      updatePreview: async (id, targets) => {
        await previewController.update(id, targets)
        sessions.push(previewController.state)
        return ok
      },
      cancelPreview: async () => {
        await previewController.cancel()
        return ok
      }
    },
    'edit',
    () => undefined
  )

  const created = await product.createProfile('New profile')
  expect(created.displays.map((target) => target.color)).toEqual([
    createNeutralColorSettings(),
    createNeutralColorSettings()
  ])
  const state = await product.getState()
  expect(shouldPreviewProfile(state, created)).toBe(true)
  expect(emptyPreviewMessage(state, created)).toBeNull()

  await previewController.start(created, 'preview')
  const clicked = previewController.state
  const changed = structuredClone(created)
  changed.displays[0]!.color.brightness = 61
  sync.schedule(changed, clicked)
  await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)

  expect(sessions.every((session) => session.state === 'active')).toBe(true)
  expect(previewController.state).toMatchObject({
    state: 'active',
    profileId: created.id,
    kind: 'edit',
    targets: [{ displayId: 'display:one', color: { brightness: 61 } }, { displayId: 'display:two' }]
  })
  expect(native.captured).toEqual(['display:one', 'display:two'])
  expect(native.restored).toEqual([])
})
