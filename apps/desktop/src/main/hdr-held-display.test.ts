// #89: a confirmed HDR hold retries on the next edit and never rejects an accepted draft.
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import { afterEach, expect, it, vi } from 'vitest'
import { PreviewRestoreError, PreviewSessionController } from '@main/preview-session-controller.js'
import { mapProductError } from '@main/product-ipc.js'
import {
  FakeNativeDisplayPort,
  nvidiaCapabilityReport,
  testDisplay
} from '@main/testing/fake-native-display.js'
import {
  commitAppPreview,
  revertAppPreview,
  saveAppPreview
} from '@/features/profiles/app-preview-actions.js'
import { PreviewSyncSession } from '@/features/profiles/preview-sync.js'
import { prepareUnsavedQuit } from '@main/unsaved-quit.js'
import type { ProductResult, ProductState } from '@shared/product-api.js'

const hdr = 'display:hdr'
const sdr = 'display:sdr'
function profile(saturation = 85): ColorProfile {
  return {
    id: 'review-held',
    name: 'Review held',
    enabled: true,
    applications: [],
    displays: [
      { displayId: hdr, color: { ...createNeutralColorSettings(), saturation } },
      { displayId: sdr, color: { ...createNeutralColorSettings(), brightness: 35 } }
    ]
  }
}
async function result<T>(request: Promise<T>): Promise<ProductResult<T>> {
  try {
    return { ok: true, value: await request }
  } catch (error) {
    return { ok: false, error: mapProductError(error) }
  }
}
async function fixture(kind: 'edit' | 'override' = 'edit') {
  const native = new FakeNativeDisplayPort(0, [testDisplay(hdr), testDisplay(sdr)])
  native.reports.set(hdr, nvidiaCapabilityReport(hdr))
  native.hdrDisplayIds.add(hdr)
  native.captureWithoutNvidiaDisplayIds.add(hdr)
  native.currentSettings.set(hdr, { brightness: 48, saturation: 43 })
  native.currentSettings.set(sdr, { brightness: 50 })
  const cancelled = vi.fn(async () => undefined)
  const recovery = {
    restoreFailed: vi.fn(async () => undefined),
    restored: vi.fn(async () => undefined)
  }
  const controller = new PreviewSessionController(
    native,
    {
      beginPreview: async () => [],
      continuePreview: async () => [],
      cancelPreview: cancelled,
      confirmPreview: async () => undefined
    },
    () => undefined,
    recovery
  )
  const saved = profile(60)
  const draft = profile()
  await controller.start(draft, kind, saved)
  const api = {
    getState: async () => ({
      ok: true as const,
      value: {
        preview: controller.state,
        chromaShift: { status: 'active' }
      } as ProductState
    }),
    startPreview: async (next: ColorProfile, nextKind: 'preview' | 'edit' | 'override') =>
      result(controller.start(next, nextKind, saved).then(() => null)),
    updatePreview: async (id: string, targets: ColorProfile['displays'], next?: ColorProfile) =>
      result(controller.update(id, targets, next).then(() => null)),
    cancelPreview: async () => result(controller.cancel().then(() => null)),
    setPreviewCompare: async (id: string, showing: boolean, sessionId: number) =>
      result(controller.setCompare(id, showing, undefined, sessionId).then(() => null)),
    saveProfile: vi.fn(async (next: ColorProfile) => {
      await controller.profileSaved(next)
      return { ok: true as const, value: next }
    }),
    confirmPreview: vi.fn(async (next: ColorProfile) => {
      await controller.completePreservingMode(next.id)
      return { ok: true as const, value: next }
    })
  }
  return { native, controller, saved, draft, api, recovery, cancelled }
}
afterEach(() => vi.useRealTimers())

it.each(['commit', 'save'] as const)(
  'app %s persists a draft while its HDR display stays held',
  async (action) => {
    const f = await fixture()
    const request =
      action === 'commit'
        ? commitAppPreview(f.draft, async () => undefined, f.api)
        : saveAppPreview(f.draft, async () => undefined, f.api)
    await expect(request).resolves.not.toThrow()
    const persist = action === 'commit' ? f.api.confirmPreview : f.api.saveProfile
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[0]).toEqual(f.draft)
  }
)

it('non-live Discard completes the renderer reset while the HDR display stays held', async () => {
  const f = await fixture()
  // Same sequence as MainApp.discardShownChanges: resetTo runs only after await.
  let localDraft = f.draft
  let reset = false
  const discard = async () => {
    await revertAppPreview(f.saved, async () => undefined, f.api)
    localDraft = f.saved
    reset = true
  }
  await discard()
  expect(reset).toBe(true)
  expect(localDraft).toEqual(f.saved)
  expect(f.controller.state).toMatchObject({
    state: 'active',
    draft: f.saved,
    unsavedChanges: false
  })
  expect(f.controller.unsavedDraft).toBeNull()
  // A later renderer flush of the reset draft keeps the session clean.
  const sync = new PreviewSyncSession(f.api, 'edit', () => undefined)
  await sync.flush(localDraft, f.controller.state)
  expect(f.controller.unsavedDraft).toBeNull()
})

it.each(['edit', 'override'] as const)(
  'a transient hold recaptures originals and applies on the next %s edit',
  async (kind) => {
    const f = await fixture(kind)
    f.native.captureWithoutNvidiaDisplayIds.clear()
    const start = f.native.calls.length
    const next = profile(95)
    await f.controller.update(next.id, next.displays, next)
    expect(f.native.calls.slice(start)).toEqual([
      { operation: 'capture', displayId: hdr },
      { operation: 'apply', displayId: hdr, settings: { saturation: 95, hue: 0 } }
    ])
    expect(f.native.baselineCaptures.at(-1)).toEqual({
      displayId: hdr,
      settings: { brightness: 48, saturation: 43 }
    })
    expect(f.native.currentSettings.get(sdr)).toMatchObject({ brightness: 35 })
  }
)

it('persistent refusals retry once per debounced edit without errors or SDR writes', async () => {
  const f = await fixture()
  vi.useFakeTimers()
  const errors: unknown[] = []
  const sync = new PreviewSyncSession(f.api, 'edit', (error) => errors.push(error))
  const start = f.native.calls.length
  for (let i = 0; i < 10; i++) {
    sync.schedule(profile(86 + i), f.controller.state)
    await vi.advanceTimersByTimeAsync(120)
  }
  await sync.settle()
  const calls = f.native.calls.slice(start)
  expect(calls).toHaveLength(30)
  expect(calls.every((call) => call.displayId === hdr)).toBe(true)
  expect(calls.filter((call) => call.operation === 'restore')).toHaveLength(10)
  expect(errors.filter(Boolean)).toHaveLength(0)
  expect(f.controller.unsavedDraft).toEqual(profile(95))
  expect(f.recovery.restoreFailed).not.toHaveBeenCalled()
  expect(
    f.native.baselineCaptures
      .filter((capture) => capture.displayId === hdr)
      .every((capture) => capture.settings.brightness === 48 && capture.settings.saturation === 43)
  ).toBe(true)
})

it.each(['transition', 'end', 'close', 'discard'] as const)(
  'unconfirmed retry hold blocks queued %s from recapturing modified output',
  async (operation) => {
    const f = await fixture()
    f.native.failRestoreDisplayIds.add(hdr)
    const start = f.native.baselineCaptures.length
    const update = f.controller.update(f.draft.id, profile(95).displays, profile(95))
    const rejection = expect(update).rejects.toBeInstanceOf(PreviewRestoreError)
    const queued =
      operation === 'transition'
        ? f.controller.reapplyAfterDisplayTransition()
        : operation === 'close'
          ? f.controller.cancelForPanelHide('close')
          : operation === 'discard'
            ? f.controller.update(f.saved.id, f.saved.displays, f.saved)
            : f.controller.cancel()
    const settled = Promise.allSettled([queued])
    await rejection
    await settled
    expect(f.native.baselineCaptures.slice(start)).toEqual([
      { displayId: hdr, settings: { brightness: 48, saturation: 43 } }
    ])
    expect(f.recovery.restoreFailed).toHaveBeenCalled()
    f.native.failRestoreDisplayIds.clear()
    await f.controller.cancel()
    expect(f.controller.state).toEqual({ state: 'inactive' })
  }
)

it.each(['end', 'close', 'handoff'] as const)(
  'a confirmed retry hold does not block %s',
  async (operation) => {
    const f = await fixture()
    const update = f.controller.update(f.draft.id, profile(95).displays, profile(95))
    const rejection = expect(update).resolves.toBeUndefined()
    const queued =
      operation === 'end'
        ? f.controller.cancel()
        : f.controller.cancelForPanelHide(operation === 'close' ? 'close' : 'handoff')
    await rejection
    await queued
    expect(f.controller.state).toEqual({ state: 'inactive' })
    expect(f.native.currentSettings.get(hdr)).toEqual({ brightness: 48, saturation: 43 })
  }
)

it('override handoff retains the held draft and compare does not change dirtiness', async () => {
  const f = await fixture('override')
  await expect(f.controller.update(f.draft.id, f.draft.displays, f.draft)).resolves.toBeUndefined()
  await f.controller.setCompare(f.draft.id, true)
  expect(f.controller.state).toMatchObject({
    comparing: true,
    unsavedChanges: true,
    draft: f.draft
  })
  await f.controller.cancelForPanelHide('handoff')
  expect(f.controller.state).toMatchObject({
    comparing: false,
    kind: 'override',
    unsavedChanges: true,
    draft: f.draft
  })
})

it('a held display does not block quit Update and keeps the exact draft', async () => {
  const f = await fixture()
  const sync = new PreviewSyncSession(f.api, 'edit', () => undefined)
  const decide = vi.fn(async () => 'update' as const)
  const confirm = vi.fn(async (next: ColorProfile) => {
    expect(next).toEqual(profile(95))
    await f.controller.completePreservingMode(next.id)
  })
  const allowed = await prepareUnsavedQuit({
    flushRendererDrafts: () => sync.flush(profile(95), f.controller.state),
    settle: () => f.controller.waitForIdle(),
    state: () => f.controller.state,
    decide,
    confirm
  })
  expect(allowed).toBe(true)
  expect(decide).toHaveBeenCalledOnce()
  expect(confirm).toHaveBeenCalledOnce()
  expect(f.controller.state).toEqual({ state: 'inactive' })
})
