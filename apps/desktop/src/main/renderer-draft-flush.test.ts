import type { IpcMainEvent, IpcMain, WebContents } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { flushRendererDrafts, RENDERER_DRAFT_FLUSH_TIMEOUT_MS } from '@main/renderer-draft-flush.js'
import { productIpcChannels } from '@shared/product-api.js'

afterEach(() => vi.useRealTimers())

function harness() {
  let receive!: (event: IpcMainEvent, input: unknown) => void
  const ipc = {
    on: vi.fn((_channel, listener) => {
      receive = listener
    }),
    removeListener: vi.fn()
  } as unknown as Pick<IpcMain, 'on' | 'removeListener'>
  const renderer = { isDestroyed: () => false, send: vi.fn() }
  const trusted = vi.fn()
  return {
    ipc,
    renderer,
    trusted,
    receive: (input: unknown, sender: unknown = renderer) =>
      receive({ sender } as IpcMainEvent, input)
  }
}

it('accepts only the requested renderer, trusted sender and matching validated response', async () => {
  const h = harness()
  const pending = flushRendererDrafts(h.ipc, [h.renderer], h.trusted)
  let complete = false
  void pending.then(() => {
    complete = true
  })
  const request = h.renderer.send.mock.calls[0]![1]
  expect(h.renderer.send.mock.calls[0]![0]).toBe(productIpcChannels.flushPreviewDraft)
  h.receive(request, {} as WebContents)
  h.receive({ ...request, extra: true })
  h.receive({ requestId: 'd9840c39-a481-49fb-8fbe-ecb1bcc25aaa' })
  h.trusted.mockImplementationOnce(() => {
    throw new Error('Untrusted frame')
  })
  h.receive(request)
  await Promise.resolve()
  expect(complete).toBe(false)
  h.receive(request)
  await pending
  expect(h.ipc.removeListener).toHaveBeenCalledOnce()
})

it('times out without a reply and ignores a late response', async () => {
  vi.useFakeTimers()
  const h = harness()
  const pending = flushRendererDrafts(h.ipc, [h.renderer], h.trusted)
  await vi.advanceTimersByTimeAsync(RENDERER_DRAFT_FLUSH_TIMEOUT_MS)
  await pending
  expect(h.ipc.removeListener).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('returns immediately with no renderer, destroyed renderers or a failed send', async () => {
  const h = harness()
  await flushRendererDrafts(h.ipc, [], h.trusted)
  await flushRendererDrafts(h.ipc, [{ ...h.renderer, isDestroyed: () => true }], h.trusted)
  expect(h.ipc.on).not.toHaveBeenCalled()
  h.renderer.send.mockImplementation(() => {
    throw new Error('Renderer exited')
  })
  await flushRendererDrafts(h.ipc, [h.renderer], h.trusted)
  expect(h.ipc.removeListener).toHaveBeenCalledOnce()
})
