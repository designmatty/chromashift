import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainEvent, WebContents } from 'electron'
import { previewDraftFlushSchema, productIpcChannels } from '@shared/product-api.js'

export const RENDERER_DRAFT_FLUSH_TIMEOUT_MS = 750

/** Missing or unresponsive renderers leave quit dependent on main-owned state. */
export async function flushRendererDrafts(
  ipc: Pick<IpcMain, 'on' | 'removeListener'>,
  renderers: readonly Pick<WebContents, 'isDestroyed' | 'send'>[],
  assertTrusted: (event: IpcMainEvent) => void
): Promise<void> {
  const pending = new Set(renderers.filter((renderer) => !renderer.isDestroyed()))
  if (pending.size === 0) return
  const request = previewDraftFlushSchema.parse({ requestId: randomUUID() })
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      ipc.removeListener(productIpcChannels.previewDraftFlushed, receive)
      resolve()
    }
    const receive = (event: IpcMainEvent, input: unknown): void => {
      if (!pending.has(event.sender)) return
      try {
        assertTrusted(event)
      } catch {
        return
      }
      const response = previewDraftFlushSchema.safeParse(input)
      if (!response.success || response.data.requestId !== request.requestId) return
      pending.delete(event.sender)
      if (pending.size === 0) finish()
    }
    const timer = setTimeout(finish, RENDERER_DRAFT_FLUSH_TIMEOUT_MS)
    ipc.on(productIpcChannels.previewDraftFlushed, receive)
    for (const renderer of pending) {
      try {
        renderer.send(productIpcChannels.flushPreviewDraft, request)
      } catch {
        pending.delete(renderer)
      }
    }
    if (pending.size === 0) finish()
  })
}
