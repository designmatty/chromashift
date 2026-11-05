import { afterEach, expect, it, vi } from 'vitest'
import type {} from '@/env.js'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort, testDisplay } from '@main/testing/fake-native-display.js'
import { usePreviewDraft, type PreviewDraft } from '@/features/profiles/use-preview-draft.js'
import { PREVIEW_SYNC_DEBOUNCE_MS } from '@/features/profiles/preview-sync.js'
import { appSessionDraft, initialAppView } from '@/features/profiles/app-preview-state.js'
import type { ProductState } from '@shared/product-api.js'

// Run the real hook's effects without a browser dependency. Each surface gets
// independent hook storage; rerenders run only changed effects and their cleanup.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>
}))
vi.mock('react', () => {
  function effect(work: () => void | (() => void), deps?: unknown[]): void {
    const index = hooks.cursor++
    const previous = hooks.slots[index] as
      { deps?: unknown[]; cleanup?: void | (() => void) } | undefined
    if (deps && previous?.deps && deps.every((value, i) => Object.is(value, previous.deps![i])))
      return
    hooks.effects.push(() => {
      previous?.cleanup?.()
      hooks.slots[index] = { deps, cleanup: work() }
    })
  }
  return {
    useState(initial: unknown) {
      const index = hooks.cursor++
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === 'function' ? initial() : initial
      const slots = hooks.slots
      return [
        slots[index],
        (value: unknown) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value
        }
      ]
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++
      hooks.slots[index] ??= { current: initial }
      return hooks.slots[index]
    },
    useEffect: effect,
    useLayoutEffect: effect
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps a mini override unchanged on app hydration and only syncs subsequent user edits', async () => {
  vi.useFakeTimers()
  const saved: ColorProfile = {
    id: 'game',
    name: 'Game',
    enabled: true,
    applications: [],
    displays: [{ displayId: 'display:one', color: createNeutralColorSettings() }]
  }
  const native = new FakeNativeDisplayPort(0, [testDisplay('display:one')])
  const controller = new PreviewSessionController(
    native,
    {
      beginPreview: async () => [],
      cancelPreview: async () => undefined,
      confirmPreview: async () => undefined
    },
    () => undefined
  )
  const startPreview = vi.fn(async (draft, kind) => {
    await controller.start(draft, kind, saved)
    return { ok: true, value: null }
  })
  const updatePreview = vi.fn(async (id, targets, draft) => {
    await controller.update(id, targets, draft)
    return { ok: true, value: null }
  })
  const cancelPreview = vi.fn(async () => {
    await controller.cancel()
    return { ok: true, value: null }
  })
  let flush = async () => undefined as void
  vi.stubGlobal('window', {
    chromaShift: {
      startPreview,
      updatePreview,
      cancelPreview,
      onFlushPreviewDraft: (callback: typeof flush) => {
        flush = callback
        return () => undefined
      }
    }
  })
  const miniSlots: unknown[] = []
  const appSlots: unknown[] = []
  function render(slots: unknown[], kind: 'edit' | 'override'): PreviewDraft {
    hooks.slots = slots
    hooks.cursor = 0
    hooks.effects = []
    const product = {
      preview: controller.state,
      configuration: { profiles: [saved] },
      chromaShift: { intendedTarget: { kind: 'profile', profileId: saved.id } }
    } as ProductState
    const draft = usePreviewDraft({
      kind,
      session: controller.state,
      enabled: true,
      onError: () => undefined,
      initialDraft: () => appSessionDraft(product),
      initialDirty: () => controller.state.state === 'active',
      ...(kind === 'edit' ? { savedProfile: saved } : {})
    })
    for (const effect of hooks.effects) effect()
    return draft
  }
  const changed = structuredClone(saved)
  changed.displays[0]!.color.brightness = 60
  render(miniSlots, 'override').updateDraft(changed)
  render(miniSlots, 'override')
  await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
  render(miniSlots, 'override')
  await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
  expect(startPreview).toHaveBeenCalledTimes(1)
  expect(updatePreview).toHaveBeenCalledTimes(0)
  const before = native.calls.slice()
  const originalSession = controller.state
  expect(initialAppView({ preview: originalSession } as ProductState, 'settings')).toBe('profiles')
  const app = render(appSlots, 'edit')
  expect(app.draft).toEqual(changed)
  expect(app.dirty).toBe(true)
  await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
  render(appSlots, 'edit')
  await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
  await flush()
  expect(startPreview).toHaveBeenCalledTimes(1)
  expect(updatePreview).toHaveBeenCalledTimes(0)
  expect(cancelPreview).toHaveBeenCalledTimes(0)
  expect(controller.state).toEqual(originalSession)
  expect(native.calls).toEqual(before)
  const edited = structuredClone(changed)
  edited.displays[0]!.color.brightness = 61
  app.updateDraft(edited)
  render(appSlots, 'edit')
  await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
  render(appSlots, 'edit')
  await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
  expect(startPreview).toHaveBeenCalledTimes(2)
  expect(updatePreview).toHaveBeenCalledTimes(1)
  expect(cancelPreview).toHaveBeenCalledTimes(0)
  expect(native.calls.slice(before.length).map((call) => call.operation)).toEqual(['apply'])
})
