import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import { afterEach, expect, it, vi } from 'vitest'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort, testDisplay } from '@main/testing/fake-native-display.js'
import { PreviewSyncSession, type PreviewSyncPort } from '@/features/profiles/preview-sync.js'
import { HoldToCompare } from '@/features/profiles/hold-to-compare.js'
import {
  previewUpdateRequestSchema,
  previewCompareRequestSchema,
  scopedPreviewRequestSchema,
  type ProductResult
} from '@shared/product-api.js'

const ok: ProductResult<null> = { ok: true, value: null }
afterEach(() => vi.useRealTimers())

async function fixture(missingTarget = false, kind: 'edit' | 'override' = 'edit') {
  const id = 'display:one'
  const original = { brightness: 43, saturation: 39 }
  const native = new FakeNativeDisplayPort(0, [testDisplay(id)])
  native.currentSettings.set(id, original)
  const saved: ColorProfile = {
    id: 'game',
    name: 'Game',
    enabled: true,
    applications: [],
    displays: missingTarget
      ? []
      : [{ displayId: id, color: { ...createNeutralColorSettings(), brightness: 54 } }]
  }
  const draft: ColorProfile = {
    ...saved,
    displays: [{ displayId: id, color: { ...createNeutralColorSettings(), brightness: 61 } }]
  }
  const cancel = vi.fn(async () => undefined)
  const controller = new PreviewSessionController(
    native,
    {
      beginPreview: async () => [],
      cancelPreview: cancel,
      confirmPreview: async () => undefined
    },
    () => undefined
  )
  await controller.start(saved, kind === 'override' ? 'override' : 'preview', saved)
  let lifetime: number | null = 1
  // Validate every update as main's IPC handler would, so a request shape main
  // rejects fails here instead of only on hardware.
  const schemaFailures: unknown[] = []
  const port: PreviewSyncPort = {
    getPanelLifetime: () => lifetime,
    startPreview: vi.fn(async (profile, kind) => {
      await controller.start(profile, kind, saved)
      return ok
    }),
    updatePreview: vi.fn(async (profileId, targets, profile): Promise<ProductResult<null>> => {
      const parsed = previewUpdateRequestSchema.safeParse({ profileId, targets, draft: profile })
      if (!parsed.success) {
        schemaFailures.push(parsed.error)
        return { ok: false, error: { code: 'INVALID_REQUEST', message: parsed.error.message } }
      }
      try {
        await controller.update(profileId, targets, profile)
        return ok
      } catch (error) {
        return { ok: false, error: { code: 'OPERATION_FAILED', message: String(error) } }
      }
    }),
    setPreviewCompare: vi.fn(
      async (profileId, showing, sessionId, lifetime): Promise<ProductResult<null>> => {
        const parsed = scopedPreviewRequestSchema(previewCompareRequestSchema).safeParse({
          request: { profileId, showing, sessionId },
          lifetime
        })
        if (!parsed.success) {
          schemaFailures.push(parsed.error)
          return { ok: false, error: { code: 'INVALID_REQUEST', message: parsed.error.message } }
        }
        try {
          await controller.setCompare(
            parsed.data.request.profileId,
            parsed.data.request.showing,
            undefined,
            parsed.data.request.sessionId
          )
          return ok
        } catch (error) {
          return { ok: false, error: { code: 'OPERATION_FAILED', message: String(error) } }
        }
      }
    ),
    cancelPreview: async () => {
      await controller.cancel()
      return ok
    }
  }
  const errors = vi.fn()
  const sync = new PreviewSyncSession(port, kind, errors)
  const shown = vi.fn()
  const compare = new HoldToCompare(shown)
  return {
    id,
    original,
    native,
    saved,
    draft,
    controller,
    port,
    sync,
    compare,
    errors,
    cancel,
    shown,
    schemaFailures,
    close: () => {
      lifetime = null
      sync.invalidate()
      void compare.release()
    }
  }
}

it.each([
  ['edit', false],
  ['edit', true],
  ['override', false],
  ['override', true]
] as const)(
  'runs draft -> saved -> draft in %s with missing saved target=%s',
  async (kind, missing) => {
    const f = await fixture(missing, kind)
    await f.sync.flush(f.draft, f.controller.state)
    const draftOutput = structuredClone(f.native.currentSettings.get(f.id))
    f.compare.press('pointer', () => f.sync.beginComparison(f.draft, f.controller.state))
    // flush joins the same queue without replacing the compare write.
    for (let turn = 0; turn < 60; turn++) await Promise.resolve()
    expect(f.native.currentSettings.get(f.id)).toEqual(
      missing ? f.original : f.saved.displays[0]!.color
    )
    expect(f.controller.state).toMatchObject({
      kind,
      draft: f.draft,
      targets: f.draft.displays,
      unsavedChanges: true,
      comparing: true
    })
    await f.compare.release()
    expect(f.native.currentSettings.get(f.id)).toEqual(draftOutput)
    expect(f.controller.state).toMatchObject({ draft: f.draft, unsavedChanges: true })
    expect(
      f.native.baselineCaptures.every(
        (capture) => JSON.stringify(capture.settings) === JSON.stringify(f.original)
      )
    ).toBe(true)
    expect(f.cancel).not.toHaveBeenCalled()
    expect(f.errors.mock.calls.every(([error]) => error === null)).toBe(true)
    expect(f.port.updatePreview).toHaveBeenCalledTimes(1)
    expect(f.port.setPreviewCompare).toHaveBeenCalledTimes(2)
    expect(f.schemaFailures).toEqual([])
  }
)

it('serializes release behind an in-flight saved write and cancels the old debounce', async () => {
  vi.useFakeTimers()
  const f = await fixture()
  const pending = f.draft
  f.sync.schedule(pending, f.controller.state)
  let finish!: () => void
  const update = f.port.setPreviewCompare!
  f.port.setPreviewCompare = vi.fn(async (id, showing, sessionId, lifetime) => {
    if (showing)
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    return update(id, showing, sessionId, lifetime)
  })
  f.compare.press('pointer', () => f.sync.beginComparison(f.draft, f.controller.state))
  for (let turn = 0; turn < 60; turn++) await Promise.resolve()
  expect(finish).toBeTypeOf('function')
  const release = f.compare.release()
  await vi.advanceTimersByTimeAsync(120)
  expect(f.compare.showingSaved).toBe(true)
  expect(f.port.setPreviewCompare).toHaveBeenCalledTimes(1)
  finish()
  await release
  expect(f.native.applied.map((call) => call.settings.brightness)).toEqual([54, 61, 54, 61])
  expect(f.port.updatePreview).toHaveBeenCalledTimes(1)
  expect(f.port.setPreviewCompare).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
  expect(f.schemaFailures).toEqual([])
})

it('panel hide invalidates queued compare writes and leaves prior-target rollback to main', async () => {
  const f = await fixture()
  await f.sync.flush(f.draft, f.controller.state)
  f.compare.press('pointer', () => f.sync.beginComparison(f.draft, f.controller.state))
  f.close()
  await f.sync.settle()
  await f.controller.cancelForPanelHide('close', () => undefined)
  expect(f.controller.state).toEqual({ state: 'inactive' })
  expect(f.native.currentSettings.get(f.id)).toEqual(f.original)
  expect(f.cancel).toHaveBeenCalledOnce()
  expect(f.schemaFailures).toEqual([])
})

it('while held, main retains the draft and reports unsaved changes', async () => {
  const f = await fixture()
  await f.sync.flush(f.draft, f.controller.state)
  const sessionId = (f.controller.state as { sessionId: number }).sessionId
  f.compare.press('pointer', () => f.sync.beginComparison(f.draft, f.controller.state))
  for (let turn = 0; turn < 80; turn++) await Promise.resolve()
  expect(f.controller.state).toMatchObject({
    state: 'active',
    kind: 'edit',
    sessionId,
    unsavedChanges: true,
    comparing: true,
    draft: f.draft
  })
  expect(f.controller.unsavedDraft).toEqual(f.draft)
  await f.compare.release()
  expect(f.controller.state).toMatchObject({ unsavedChanges: true, draft: f.draft, sessionId })
  expect(f.schemaFailures).toEqual([])
})

it('a press while a rollback is in flight shows nothing and writes nothing', async () => {
  const f = await fixture()
  await f.sync.flush(f.draft, f.controller.state)
  const applied = f.native.applied.length
  const rollback = f.sync.rollback()
  f.compare.press('pointer', () => f.sync.beginComparison(f.draft, f.controller.state))
  expect(f.compare.showingSaved).toBe(false)
  expect(f.shown).not.toHaveBeenCalled()
  await rollback
  await f.compare.release()
  expect(f.shown).not.toHaveBeenCalled()
  expect(f.port.updatePreview).toHaveBeenCalledTimes(1)
  expect(f.controller.state).toEqual({ state: 'inactive' })
  expect(f.native.applied.slice(applied).every((call) => call.settings.brightness !== 54)).toBe(
    true
  )
  expect(f.native.currentSettings.get(f.id)).toEqual(f.original)
  expect(f.schemaFailures).toEqual([])
})

it('rejects edits while held without ending the session or changing its draft', async () => {
  const f = await fixture()
  await f.sync.flush(f.draft, f.controller.state)
  await f.controller.setCompare(f.saved.id, true)
  const calls = f.native.calls.length
  await expect(f.controller.update(f.saved.id, f.saved.displays, f.saved)).rejects.toThrow(
    'Release Hold to compare'
  )
  expect(f.native.calls).toHaveLength(calls)
  expect(f.controller.state).toMatchObject({
    comparing: true,
    draft: f.draft,
    unsavedChanges: true
  })
  await f.controller.setCompare(f.saved.id, false)
  expect(f.native.currentSettings.get(f.id)).toEqual(f.draft.displays[0]!.color)
})

it.each([
  'cancel',
  'close',
  'handoff',
  'complete',
  'confirm',
  'dispose',
  'restoreAll',
  'replace',
  'topology'
] as const)(
  'clears comparison on %s through the existing serialized restoration paths',
  async (end) => {
    const f = await fixture()
    await f.sync.flush(f.draft, f.controller.state)
    await f.controller.setCompare(f.saved.id, true)
    if (end === 'cancel') await f.controller.cancel()
    if (end === 'close' || end === 'handoff') await f.controller.cancelForPanelHide(end)
    if (end === 'complete') await f.controller.completePreservingMode(f.saved.id)
    if (end === 'confirm') await f.controller.confirm(f.saved.id)
    if (end === 'dispose') await f.controller.dispose()
    if (end === 'restoreAll') {
      await f.native.restoreAllBaselines()
      await f.controller.restoreAllConfirmed()
    }
    if (end === 'replace') await f.controller.start({ ...f.saved, id: 'other' }, 'preview')
    if (end === 'topology') await f.controller.reapplyAfterDisplayTransition()
    expect(f.controller.state).not.toMatchObject({ comparing: true })
    if (end === 'topology') {
      expect(f.controller.state).toMatchObject({
        comparing: false,
        draft: f.draft,
        unsavedChanges: true
      })
      expect(f.native.currentSettings.get(f.id)).toEqual(f.draft.displays[0]!.color)
    } else if (end !== 'replace') {
      expect(f.controller.state).toEqual({ state: 'inactive' })
      expect(f.native.currentSettings.get(f.id)).toEqual(f.original)
    }
  }
)

it('main releases an override for handoff or minimize while retaining its kind, draft and hold', async () => {
  const f = await fixture(false, 'override')
  await f.sync.flush(f.draft, f.controller.state)
  for (const release of [
    () => f.controller.releaseComparison(),
    () => f.controller.cancelForPanelHide('handoff')
  ]) {
    await f.controller.setCompare(f.saved.id, true)
    await release()
    expect(f.controller.state).toMatchObject({
      comparing: false,
      kind: 'override',
      draft: f.draft,
      unsavedChanges: true
    })
    expect(f.native.currentSettings.get(f.id)).toEqual(f.draft.displays[0]!.color)
  }
})

it('rejects a queued compare when its opening is revoked before execution', async () => {
  const f = await fixture()
  await f.sync.flush(f.draft, f.controller.state)
  const calls = f.native.calls.length
  let current = true
  const comparing = f.controller.setCompare(f.saved.id, true, () => {
    if (!current) throw new Error('Stale opening')
  })
  current = false
  await expect(comparing).rejects.toThrow('Stale opening')
  expect(f.native.calls).toHaveLength(calls)
  expect(f.controller.state).not.toMatchObject({ comparing: true })
})

it('rejects stale presses and releases after same-profile session replacement', async () => {
  const f = await fixture()
  await f.sync.flush(f.draft, f.controller.state)
  const old = f.controller.state
  if (old.state !== 'active') throw new Error('Missing test session')
  await f.controller.cancel()
  await f.controller.start(f.draft, 'edit', f.saved)
  const calls = f.native.calls.length
  for (const showing of [true, false]) {
    await expect(
      f.controller.setCompare(f.saved.id, showing, undefined, old.sessionId)
    ).rejects.toThrow('session changed')
  }
  expect(f.native.calls).toHaveLength(calls)
  expect(f.controller.state).toMatchObject({
    comparing: false,
    draft: f.draft,
    unsavedChanges: true
  })
})

it('compares a removed draft target back to its saved colors then returns to Original settings', async () => {
  const f = await fixture()
  const draft = { ...f.saved, displays: [] }
  await f.controller.start(draft, 'edit', f.saved)
  await f.controller.setCompare(f.saved.id, true)
  expect(f.native.currentSettings.get(f.id)).toEqual(f.saved.displays[0]!.color)
  expect(f.controller.state).toMatchObject({ comparing: true, draft, unsavedChanges: true })
  await f.controller.setCompare(f.saved.id, false)
  expect(f.native.currentSettings.get(f.id)).toEqual(f.original)
  expect(f.controller.state).toMatchObject({ comparing: false, draft, unsavedChanges: true })
})

it('restores the whole display after a partial compare apply failure', async () => {
  const f = await fixture()
  await f.sync.flush(f.draft, f.controller.state)
  vi.spyOn(f.native, 'applyDisplaySettings').mockImplementationOnce(async () => {
    // Model a provider that changed one control before the second control failed.
    f.native.currentSettings.set(f.id, { brightness: 54, saturation: 99 })
    throw new Error('Second native control failed')
  })
  await expect(f.controller.setCompare(f.saved.id, true)).rejects.toThrow(
    'Second native control failed'
  )
  expect(f.controller.state).toEqual({ state: 'inactive' })
  expect(f.native.currentSettings.get(f.id)).toEqual(f.original)
  const calls = f.native.calls.length
  await expect(f.controller.setCompare(f.saved.id, false)).rejects.toThrow('No preview')
  expect(f.native.calls).toHaveLength(calls)
})

it('clears compare when restoration fails and retains the full draft for recovery', async () => {
  const f = await fixture(true)
  await f.sync.flush(f.draft, f.controller.state)
  f.native.failRestoreDisplayIds.add(f.id)
  await expect(f.controller.setCompare(f.saved.id, true)).rejects.toThrow('could not be restored')
  expect(f.controller.state).toMatchObject({
    comparing: false,
    draft: f.draft,
    unsavedChanges: true
  })
  f.native.failRestoreDisplayIds.clear()
  await f.controller.retryRestoration()
  expect(f.controller.state).toMatchObject({ comparing: false, draft: f.draft })
  expect(f.native.currentSettings.get(f.id)).toEqual(f.draft.displays[0]!.color)
})

it('invalidates compare without native writes and retries the draft after ownership validation', async () => {
  const f = await fixture(false, 'override')
  const draft = { ...f.saved, displays: [] }
  await f.controller.start(draft, 'override', f.saved)
  await f.controller.setCompare(f.saved.id, true)
  const calls = f.native.calls.length
  await f.controller.invalidateComparison()
  expect(f.native.calls).toHaveLength(calls)
  expect(f.controller.state).toMatchObject({ comparing: false, draft, unsavedChanges: true })
  await f.controller.reapplyAfterDisplayTransition()
  expect(f.native.currentSettings.get(f.id)).toEqual(f.original)
  expect(f.controller.state).toMatchObject({ comparing: false, draft })
})
