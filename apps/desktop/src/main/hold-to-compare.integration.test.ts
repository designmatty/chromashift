import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import { afterEach, expect, it, vi } from 'vitest'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort, testDisplay } from '@main/testing/fake-native-display.js'
import { PreviewSyncSession, type PreviewSyncPort } from '@/features/profiles/preview-sync.js'
import { HoldToCompare } from '@/features/profiles/hold-to-compare.js'
import { previewUpdateRequestSchema, type ProductResult } from '@shared/product-api.js'

const ok: ProductResult<null> = { ok: true, value: null }
afterEach(() => vi.useRealTimers())

async function fixture(missingTarget = false) {
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
  await controller.start(saved, 'preview', saved)
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
    cancelPreview: async () => {
      await controller.cancel()
      return ok
    }
  }
  const errors = vi.fn()
  const sync = new PreviewSyncSession(port, 'edit', errors)
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

it.each([false, true])(
  'runs draft -> saved -> draft with missing saved target=%s',
  async (missing) => {
    const f = await fixture(missing)
    await f.sync.flush(f.draft, f.controller.state)
    const draftOutput = structuredClone(f.native.currentSettings.get(f.id))
    f.compare.press('pointer', () => f.sync.beginComparison(f.saved, f.draft, f.controller.state))
    // flush joins the same queue without replacing the compare write.
    for (let turn = 0; turn < 60; turn++) await Promise.resolve()
    expect(f.native.currentSettings.get(f.id)).toEqual(
      missing ? f.original : f.saved.displays[0]!.color
    )
    expect(f.controller.state).toMatchObject({ kind: 'edit' })
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
    expect(f.port.updatePreview).toHaveBeenCalledTimes(3)
    expect(f.schemaFailures).toEqual([])
  }
)

it('serializes release behind an in-flight saved write and cancels the old debounce', async () => {
  vi.useFakeTimers()
  const f = await fixture()
  const pending = f.draft
  f.sync.schedule(pending, f.controller.state)
  let finish!: () => void
  const update = f.port.updatePreview
  f.port.updatePreview = vi.fn(async (id, targets, profile, lifetime) => {
    if (targets[0]?.color.brightness === 54)
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    return update(id, targets, profile, lifetime)
  })
  f.compare.press('pointer', () => f.sync.beginComparison(f.saved, f.draft, f.controller.state))
  for (let turn = 0; turn < 60; turn++) await Promise.resolve()
  expect(finish).toBeTypeOf('function')
  const release = f.compare.release()
  await vi.advanceTimersByTimeAsync(120)
  expect(f.compare.showingSaved).toBe(true)
  expect(f.port.updatePreview).toHaveBeenCalledTimes(2)
  finish()
  await release
  expect(f.native.applied.map((call) => call.settings.brightness)).toEqual([54, 61, 54, 61])
  expect(f.port.updatePreview).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
  expect(f.schemaFailures).toEqual([])
})

it('panel hide invalidates queued compare writes and leaves prior-target rollback to main', async () => {
  const f = await fixture()
  await f.sync.flush(f.draft, f.controller.state)
  f.compare.press('pointer', () => f.sync.beginComparison(f.saved, f.draft, f.controller.state))
  f.close()
  await f.sync.settle()
  await f.controller.cancelForPanelHide('close', () => undefined)
  expect(f.controller.state).toEqual({ state: 'inactive' })
  expect(f.native.currentSettings.get(f.id)).toEqual(f.original)
  expect(f.cancel).toHaveBeenCalledOnce()
  expect(f.schemaFailures).toEqual([])
})

it('while held, main holds the saved displays and reports no unsaved changes until release', async () => {
  const f = await fixture()
  await f.sync.flush(f.draft, f.controller.state)
  const sessionId = (f.controller.state as { sessionId: number }).sessionId
  f.compare.press('pointer', () => f.sync.beginComparison(f.saved, f.draft, f.controller.state))
  for (let turn = 0; turn < 80; turn++) await Promise.resolve()
  expect(f.controller.state).toMatchObject({
    state: 'active',
    kind: 'edit',
    sessionId,
    unsavedChanges: false,
    draft: { name: f.draft.name, displays: f.saved.displays }
  })
  expect(f.controller.unsavedDraft).toBeNull()
  await f.compare.release()
  expect(f.controller.state).toMatchObject({ unsavedChanges: true, draft: f.draft, sessionId })
  expect(f.schemaFailures).toEqual([])
})

it('a press while a rollback is in flight shows nothing and writes nothing', async () => {
  const f = await fixture()
  await f.sync.flush(f.draft, f.controller.state)
  const applied = f.native.applied.length
  const rollback = f.sync.rollback()
  f.compare.press('pointer', () => f.sync.beginComparison(f.saved, f.draft, f.controller.state))
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
