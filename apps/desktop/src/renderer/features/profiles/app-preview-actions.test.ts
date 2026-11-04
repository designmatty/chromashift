import { afterEach, expect, it, vi } from 'vitest'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import {
  commitAppPreview,
  deleteAppProfile,
  revertAppPreview,
  saveAppPreview
} from '@/features/profiles/app-preview-actions'
import { PreviewSyncSession, PREVIEW_SYNC_DEBOUNCE_MS } from '@/features/profiles/preview-sync'
import type { ProductState, PreviewState, ProductResult } from '@shared/product-api'

const profile: ColorProfile = {
  id: 'a',
  name: 'A',
  enabled: true,
  applications: [],
  displays: [{ displayId: 'display:one', color: createNeutralColorSettings() }]
}
const changed = structuredClone(profile)
changed.displays[0]!.color.brightness = 60
const ok: ProductResult<null> = { ok: true, value: null }
afterEach(() => vi.useRealTimers())

function fixture(kind: 'preview' | 'edit' | 'override' = 'override') {
  let preview: PreviewState = {
    state: 'active',
    kind,
    profileId: profile.id,
    targets: profile.displays
  }
  const calls: string[] = []
  const api = {
    getState: async () => ({ ok: true as const, value: { preview } as ProductState }),
    startPreview: async (draft: ColorProfile, kind: 'edit' | 'override') => {
      calls.push('start')
      preview = { state: 'active', kind, profileId: draft.id, targets: draft.displays }
      return ok
    },
    updatePreview: async (_id: string, targets: ColorProfile['displays']) => {
      calls.push('update')
      if (preview.state === 'active') preview = { ...preview, targets }
      return ok
    },
    cancelPreview: async () => {
      calls.push('cancel')
      preview = { state: 'inactive' }
      return ok
    },
    confirmPreview: vi.fn(async (draft: ColorProfile, activation: 'manual' | 'preserve') => {
      calls.push(`confirm:${activation}`)
      preview = { state: 'inactive' }
      return { ok: true as const, value: draft }
    }),
    saveProfile: vi.fn(async (draft: ColorProfile) => {
      calls.push('save')
      return { ok: true as const, value: draft }
    }),
    deleteProfile: async (id: string) => {
      calls.push(`delete:${id}`)
      return { ok: true as const, value: true }
    }
  }
  const sync = new PreviewSyncSession(api, 'edit', () => undefined)
  return { api, sync, calls, state: () => preview }
}

it.each(['debouncing', 'in flight'] as const)(
  'banner Discard settles an %s edit before cancel, with no later apply',
  async (timing) => {
    vi.useFakeTimers()
    const f = fixture()
    let release!: () => void
    if (timing === 'in flight') {
      const start = f.api.startPreview
      f.api.startPreview = async (...args) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return start(...args)
      }
    }
    f.sync.schedule(changed, f.state())
    if (timing === 'in flight') await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    const discarded = f.sync.rollback(true)
    if (timing === 'in flight') release()
    await discarded
    await vi.runAllTimersAsync()
    expect(f.calls.at(-1)).toBe('cancel')
    expect(f.state()).toEqual({ state: 'inactive' })
    if (timing === 'debouncing') expect(f.calls).toEqual(['cancel'])
  }
)

it.each(['debouncing', 'in flight'] as const)(
  'banner Update commits the latest draft during an %s edit',
  async (timing) => {
    vi.useFakeTimers()
    const f = fixture()
    let release!: () => void
    if (timing === 'in flight') {
      const start = f.api.startPreview
      f.api.startPreview = async (...args) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return start(...args)
      }
    }
    f.sync.schedule(changed, f.state())
    if (timing === 'in flight') await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    const committed = commitAppPreview(changed, () => f.sync.settle(), f.api)
    if (timing === 'in flight') release()
    expect(await committed).toEqual(changed)
    await vi.runAllTimersAsync()
    expect(f.api.confirmPreview).toHaveBeenCalledExactlyOnceWith(changed, 'preserve')
    expect(f.calls.at(-1)).toBe('confirm:preserve')
    expect(f.state()).toEqual({ state: 'inactive' })
  }
)

it('deleting B preserves the mini-panel override on A', async () => {
  const f = fixture()
  const before = f.state()
  await deleteAppProfile(
    'b',
    async () => {
      await f.sync.rollback(true)
    },
    f.api
  )
  expect(f.calls).toEqual(['delete:b'])
  expect(f.state()).toEqual(before)
})

it('deleting the session profile waits for successful rollback', async () => {
  const f = fixture()
  await deleteAppProfile(
    'A',
    async () => {
      await f.sync.rollback(true)
    },
    f.api
  )
  expect(f.calls).toEqual(['cancel', 'delete:A'])
})

it('a failed rollback prevents deletion', async () => {
  const f = fixture()
  await expect(
    deleteAppProfile(
      'a',
      async () => {
        throw new Error('restore failed')
      },
      f.api
    )
  ).rejects.toThrow('restore failed')
  expect(f.calls).toEqual([])
})

it.each(['debouncing', 'in flight'] as const)(
  'confirmed deletion discards an %s edit before deleting its profile',
  async (timing) => {
    vi.useFakeTimers()
    const f = fixture()
    let release!: () => void
    if (timing === 'in flight') {
      const start = f.api.startPreview
      f.api.startPreview = async (...args) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return start(...args)
      }
    }
    f.sync.schedule(changed, f.state())
    if (timing === 'in flight') await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    const deleted = deleteAppProfile(
      'a',
      async () => {
        await f.sync.rollback(true)
      },
      f.api
    )
    await Promise.resolve()
    if (timing === 'in flight') release()
    await deleted
    await vi.runAllTimersAsync()
    expect(f.calls.slice(-2)).toEqual(['cancel', 'delete:a'])
    expect(f.state()).toEqual({ state: 'inactive' })
  }
)

it.each(['debouncing', 'in flight'] as const)(
  'header Update on a non-live profile saves the latest %s draft and keeps its session',
  async (timing) => {
    vi.useFakeTimers()
    const f = fixture('preview')
    let release!: () => void
    if (timing === 'in flight') {
      const update = f.api.updatePreview
      f.api.updatePreview = async (...args) => {
        f.api.updatePreview = update
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return update(...args)
      }
    }
    f.sync.schedule(changed, f.state())
    if (timing === 'in flight') await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    const saved = saveAppPreview(changed, () => f.sync.settle(), f.api)
    if (timing === 'in flight') release()
    expect(await saved).toEqual(changed)
    await vi.runAllTimersAsync()
    expect(f.api.saveProfile).toHaveBeenCalledExactlyOnceWith(changed)
    expect(f.api.confirmPreview).not.toHaveBeenCalled()
    expect(f.calls).not.toContain('cancel')
    expect(f.calls.at(-1)).toBe('save')
    expect(f.state()).toEqual({
      state: 'active',
      kind: 'edit',
      profileId: profile.id,
      targets: changed.displays
    })
  }
)

it.each(['debouncing', 'in flight'] as const)(
  'header Discard on a non-live profile reverts a %s edit in its session without cancelling',
  async (timing) => {
    vi.useFakeTimers()
    const f = fixture('edit')
    let release!: () => void
    if (timing === 'in flight') {
      const update = f.api.updatePreview
      f.api.updatePreview = async (...args) => {
        f.api.updatePreview = update
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return update(...args)
      }
    }
    f.sync.schedule(changed, f.state())
    if (timing === 'in flight') await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    const reverted = revertAppPreview(profile, () => f.sync.settle(), f.api)
    if (timing === 'in flight') release()
    await reverted
    await vi.runAllTimersAsync()
    expect(f.calls).not.toContain('cancel')
    expect(f.calls.at(-1)).toBe('update')
    expect(f.state()).toEqual({
      state: 'active',
      kind: 'edit',
      profileId: profile.id,
      targets: profile.displays
    })
  }
)
