import { expect, it, vi } from 'vitest'
import { productIpcChannels, type ChromaShiftApi } from '@shared/product-api.js'

const bridge = vi.hoisted(() => ({
  api: null as ChromaShiftApi | null,
  send: vi.fn(),
  invoke: vi.fn(),
  listeners: new Map<string, (event: unknown, input: unknown) => void>(),
  subscriptions: new Map<string, Set<(event: unknown, input: unknown) => void>>()
}))
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: ChromaShiftApi) => {
      bridge.api = api
    }
  },
  ipcRenderer: {
    send: bridge.send,
    invoke: bridge.invoke,
    on: (channel: string, listener: (event: unknown, input: unknown) => void) => {
      const subscriptions = bridge.subscriptions.get(channel) ?? new Set()
      subscriptions.add(listener)
      bridge.subscriptions.set(channel, subscriptions)
      bridge.listeners.set(channel, (event, input) => {
        for (const receive of subscriptions) receive(event, input)
      })
    },
    removeAllListeners: (channel: string) => {
      bridge.subscriptions.delete(channel)
      bridge.listeners.delete(channel)
    },
    removeListener: (channel: string, listener: (event: unknown, input: unknown) => void) => {
      const subscriptions = bridge.subscriptions.get(channel)
      subscriptions?.delete(listener)
      if (subscriptions?.size === 0) bridge.listeners.delete(channel)
    }
  }
}))

it('captures validated panel lifetimes and preserves an explicit old token across reopening', async () => {
  await import('../preload/index.js')
  const deliver = bridge.listeners.get(productIpcChannels.panelLifetimeChanged)!
  const closing = vi.fn()
  const unsubscribe = bridge.api!.onPanelClosing(closing)
  deliver({}, { lifetime: 21 })
  expect(bridge.api!.getPanelLifetime()).toBe(21)
  deliver({}, { lifetime: -1 })
  deliver({}, { lifetime: null, extra: true })
  expect(bridge.api!.getPanelLifetime()).toBe(21)
  expect(closing).not.toHaveBeenCalled()
  const captured = bridge.api!.getPanelLifetime()!
  deliver({}, { lifetime: null })
  expect(closing).toHaveBeenCalledOnce()
  expect(bridge.api!.getPanelLifetime()).toBeNull()
  bridge.invoke.mockClear()
  expect(await bridge.api!.cancelPreview()).toMatchObject({
    ok: false,
    error: { code: 'CONFLICT' }
  })
  expect(bridge.invoke).not.toHaveBeenCalled()
  deliver({}, { lifetime: 22 })
  bridge.invoke.mockResolvedValue({ ok: true, value: null })
  const profile = { id: 'game', name: 'Game', enabled: true, applications: [], displays: [] }
  await bridge.api!.startPreview(profile, 'edit', captured)
  expect(bridge.invoke).toHaveBeenLastCalledWith(productIpcChannels.startPreview, {
    lifetime: 21,
    request: { profile, kind: 'edit' }
  })
  await bridge.api!.updatePreview(profile.id, [], profile, captured)
  expect(bridge.invoke).toHaveBeenLastCalledWith(productIpcChannels.updatePreview, {
    lifetime: 21,
    request: { profileId: profile.id, targets: [], draft: profile }
  })
  await bridge.api!.cancelPreview(captured)
  expect(bridge.invoke).toHaveBeenLastCalledWith(productIpcChannels.cancelPreview, {
    lifetime: 21,
    request: {}
  })
  await bridge.api!.hideMiniPanel()
  expect(bridge.invoke).toHaveBeenLastCalledWith(productIpcChannels.hideMiniPanel, {
    lifetime: 22,
    request: {}
  })
  unsubscribe()
  deliver({}, { lifetime: null })
  expect(closing).toHaveBeenCalledOnce()
  expect(bridge.api!.getPanelLifetime()).toBeNull()
})

it('only delivers validated minimize notifications through the narrow preload callback', async () => {
  await import('../preload/index.js')
  const listener = vi.fn()
  bridge.api!.onAppPanelMinimized(listener)
  const deliver = bridge.listeners.get(productIpcChannels.appPanelMinimized)!
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    deliver({}, undefined)
    deliver({}, { unexpected: true })
    expect(listener).not.toHaveBeenCalled()
    deliver({}, {})
    expect(listener).toHaveBeenCalledExactlyOnceWith()
    expect(error).toHaveBeenCalledTimes(2)
  } finally {
    error.mockRestore()
  }
})

it('validates flush requests, waits for the draft and removes the listener on cleanup', async () => {
  await import('../preload/index.js')
  let finish!: () => void
  const listener = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const unsubscribe = bridge.api!.onFlushPreviewDraft(listener)
  const receive = bridge.listeners.get(productIpcChannels.flushPreviewDraft)!
  const request = { requestId: 'd9840c39-a481-49fb-8fbe-ecb1bcc25aaa' }
  receive({}, { ...request, unexpected: true })
  receive({}, { requestId: 1 })
  expect(listener).not.toHaveBeenCalled()
  receive({}, request)
  expect(listener).toHaveBeenCalledOnce()
  expect(bridge.send).not.toHaveBeenCalled()
  finish()
  await Promise.resolve()
  expect(bridge.send).toHaveBeenCalledExactlyOnceWith(
    productIpcChannels.previewDraftFlushed,
    request
  )
  unsubscribe()
  expect(bridge.listeners.has(productIpcChannels.flushPreviewDraft)).toBe(false)
})
