import { expect, it, vi } from 'vitest'
import { productIpcChannels, type ChromaShiftApi } from '@shared/product-api.js'

const bridge = vi.hoisted(() => ({
  api: null as ChromaShiftApi | null,
  send: vi.fn(),
  listeners: new Map<string, (event: unknown, input: unknown) => void>()
}))
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: ChromaShiftApi) => {
      bridge.api = api
    }
  },
  ipcRenderer: {
    send: bridge.send,
    on: (channel: string, listener: (event: unknown, input: unknown) => void) => {
      bridge.listeners.set(channel, listener)
    },
    removeAllListeners: (channel: string) => bridge.listeners.delete(channel),
    removeListener: (channel: string) => bridge.listeners.delete(channel)
  }
}))

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
