import { expect, it, vi } from 'vitest'
import type { ColorProfile } from '@chromashift/core'
import type { PreviewState } from '@shared/product-api.js'
import { prepareUnsavedQuit } from '@main/unsaved-quit.js'
import { ShutdownCoordinator } from '@main/shutdown-coordinator.js'

const draft: ColorProfile = {
  id: 'game',
  name: 'Renamed game',
  enabled: true,
  applications: [],
  displays: []
}

it.each(['edit', 'override'] as const)(
  'offers all quit decisions for a dirty %s without a renderer',
  async (kind) => {
    for (const decision of ['update', 'discard', 'cancel'] as const) {
      const order: string[] = []
      const confirm = vi.fn(async (profile: ColorProfile) => {
        expect(profile).toEqual(draft)
        order.push('save')
      })
      const coordinator = new ShutdownCoordinator(
        {
          waitForIdle: async () => {
            order.push('idle')
          }
        },
        {
          running: true,
          stop: async () => {
            order.push('restore')
          }
        },
        {
          exit: () => {
            order.push('exit')
          }
        },
        { show: vi.fn(), showError: vi.fn() },
        { write: () => undefined },
        () =>
          prepareUnsavedQuit({
            settle: async () => {
              order.push('settle')
            },
            state: () => ({
              state: 'active',
              sessionId: 1,
              profileId: draft.id,
              kind,
              targets: [],
              draft,
              unsavedChanges: true
            }),
            decide: async (name) => {
              expect(name).toBe('Renamed game')
              order.push('dialog')
              return decision
            },
            confirm
          })
      )
      const first = coordinator.request('tray')
      expect(coordinator.request('application')).toBe(first)
      expect(await first).toBe(decision !== 'cancel')
      expect(confirm).toHaveBeenCalledTimes(decision === 'update' ? 1 : 0)
      expect(order).toEqual(
        decision === 'cancel'
          ? ['settle', 'dialog']
          : decision === 'update'
            ? ['settle', 'dialog', 'settle', 'save', 'idle', 'restore', 'exit']
            : ['settle', 'dialog', 'settle', 'idle', 'restore', 'exit']
      )
      if (decision === 'cancel') expect(coordinator.state).toBe('idle')
    }
  }
)

it.each<PreviewState>([
  { state: 'inactive' },
  {
    state: 'active',
    sessionId: 1,
    kind: 'preview',
    profileId: draft.id,
    targets: [],
    draft,
    unsavedChanges: false
  },
  {
    state: 'active',
    sessionId: 1,
    kind: 'edit',
    profileId: draft.id,
    targets: [],
    draft,
    unsavedChanges: false
  }
])('does not warn for clean sessions', async (preview) => {
  const decide = vi.fn()
  expect(
    await prepareUnsavedQuit({
      settle: async () => undefined,
      state: () => preview,
      decide,
      confirm: vi.fn()
    })
  ).toBe(true)
  expect(decide).not.toHaveBeenCalled()
})

it('keeps the app and helper alive when updating the profile fails', async () => {
  const stop = vi.fn()
  const exit = vi.fn()
  const showError = vi.fn()
  const coordinator = new ShutdownCoordinator(
    { waitForIdle: vi.fn() },
    { running: true, stop },
    { exit },
    { show: vi.fn(), showError },
    { write: () => undefined },
    () =>
      prepareUnsavedQuit({
        settle: async () => undefined,
        state: () => ({
          state: 'active',
          sessionId: 1,
          kind: 'edit',
          profileId: draft.id,
          targets: [],
          draft,
          unsavedChanges: true
        }),
        decide: async () => 'update',
        confirm: async () => {
          throw new Error('Disk full')
        }
      })
  )
  expect(await coordinator.request('application')).toBe(false)
  expect(stop).not.toHaveBeenCalled()
  expect(exit).not.toHaveBeenCalled()
  expect(showError).toHaveBeenCalledWith('Profile could not be updated', expect.any(String))
})
