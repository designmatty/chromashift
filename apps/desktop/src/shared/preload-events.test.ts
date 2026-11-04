import { expect, it, vi } from 'vitest'
import { productIpcChannels, type ChromaShiftApi } from '@shared/product-api.js'

const bridge = vi.hoisted(() => ({
  api: null as ChromaShiftApi | null,
  listeners: new Map<string, (event: unknown, input: unknown) => void>()
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: ChromaShiftApi) => { bridge.api = api } },
  ipcRenderer: {
    on: (channel: string, listener: (event: unknown, input: unknown) => void) => {
      bridge.listeners.set(channel, listener)
    },
    removeAllListeners: (channel: string) => bridge.listeners.delete(channel)
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
