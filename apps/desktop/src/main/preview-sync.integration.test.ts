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
