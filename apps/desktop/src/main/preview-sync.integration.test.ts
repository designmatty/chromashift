import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import { afterEach, expect, it, vi } from 'vitest'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort, testDisplay } from '@main/testing/fake-native-display.js'
import {
  PreviewSyncSession,
  PREVIEW_SYNC_DEBOUNCE_MS
} from '@/features/profiles/preview-sync.js'
import type { ProductError, ProductResult } from '@shared/product-api.js'

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
