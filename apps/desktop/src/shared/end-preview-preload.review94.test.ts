import { beforeEach, expect, it, vi } from 'vitest'
import { productIpcChannels, type ChromaShiftApi } from '@shared/product-api.js'

const bridge = vi.hoisted(() => ({
  api: null as ChromaShiftApi | null,
  listeners: new Map<string, (event: unknown, input: unknown) => void>()
}))
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: ChromaShiftApi) => {
      bridge.api = api
    }
  },
  ipcRenderer: {
    on: (channel: string, listener: (event: unknown, input: unknown) => void) =>
      bridge.listeners.set(channel, listener)
  }
}))

beforeEach(() => {
  vi.resetModules()
  bridge.listeners.clear()
})

async function setup() {
  await import('../preload/index.js')
  return {
    api: bridge.api!,
    lifetime: (lifetime: number | null) =>
      bridge.listeners.get(productIpcChannels.panelLifetimeChanged)!({}, { lifetime }),
    request: (lifetime: number) =>
      bridge.listeners.get(productIpcChannels.endPreviewRequested)!(
        {},
        { lifetime, sessionId: 1, profileId: 'game' }
      )
  }
}

it('REVIEW94: buffers a valid request before subscription and replaces the single listener without replay', async () => {
  const h = await setup()
  h.lifetime(21)
  h.request(21)
  const first = vi.fn()
  const second = vi.fn()
  h.api.onEndPreviewRequested(first)
  expect(first).toHaveBeenCalledExactlyOnceWith({ lifetime: 21, sessionId: 1, profileId: 'game' })
  h.api.onEndPreviewRequested(second)
  expect(second).not.toHaveBeenCalled()
  h.request(21)
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledExactlyOnceWith({ lifetime: 21, sessionId: 1, profileId: 'game' })
})

it('REVIEW94: drops an old opening request buffered before the renderer subscribes', async () => {
  const h = await setup()
  h.lifetime(21)
  h.request(21)
  h.lifetime(null)
  h.lifetime(22)
  const receive = vi.fn()
  h.api.onEndPreviewRequested(receive)
  expect(receive).not.toHaveBeenCalled()
  h.request(21)
  expect(receive).not.toHaveBeenCalled()
  h.request(22)
  expect(receive).toHaveBeenCalledExactlyOnceWith({ lifetime: 22, sessionId: 1, profileId: 'game' })
})
