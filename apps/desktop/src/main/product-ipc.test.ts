import { describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerProductIpcHandlers } from '@main/product-ipc.js'
import { DiagnosticsService } from '@main/diagnostics-service.js'
import { UpdateChecker } from '@main/update-checker.js'
import { AppUpdateService } from '@main/app-update-service.js'
import { productIpcChannels } from '@shared/product-api.js'

function harness() {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>
  >()
  const copy = vi.fn()
  const download = vi.fn(async () => false)
  const clear = vi.fn()
  const write = vi.fn()
  const trusted = vi.fn()
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json([]))
  const installUpdate = vi.fn(async () => true)
  registerProductIpcHandlers(
    {
      handle: (name: string, handler: typeof handlers extends Map<string, infer T> ? T : never) =>
        handlers.set(name, handler)
    } as unknown as IpcMain,
    () => undefined,
    trusted,
    async () => true,
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => [],
    new DiagnosticsService({
      read: () => [],
      copy,
      download,
      clear,
      context: () => ({}),
      logger: { write }
    }),
    new AppUpdateService({
      checker: new UpdateChecker({ currentVersion: '0.1.0-preview.8', fetch }),
      requestExit: installUpdate
    })
  )
  const invoke = (name: string, input: unknown = {}) =>
    handlers.get(name)!({} as IpcMainInvokeEvent, input)
  return { copy, download, clear, write, trusted, invoke, fetch, installUpdate }
}

describe('update IPC security', () => {
  it('validates senders before reading status, requesting releases, or opening the installer', async () => {
    const h = harness()
    h.trusted.mockImplementation(() => {
      throw new Error('Untrusted renderer')
    })
    for (const name of ['getUpdateStatus', 'checkForUpdates', 'installUpdate'] as const) {
      await expect(h.invoke(productIpcChannels[name])).rejects.toThrow('Untrusted renderer')
    }
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.installUpdate).not.toHaveBeenCalled()
  })

  it('rejects renderer-selected URLs and works without a native controller', async () => {
    const h = harness()
    for (const name of ['getUpdateStatus', 'checkForUpdates', 'installUpdate'] as const) {
      expect(
        await h.invoke(productIpcChannels[name], { url: 'https://attacker.example' })
      ).toMatchObject({
        ok: false,
        error: { code: 'INVALID_REQUEST' }
      })
    }
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.installUpdate).not.toHaveBeenCalled()
    expect(await h.invoke(productIpcChannels.getUpdateStatus)).toMatchObject({
      ok: true,
      value: { phase: 'idle' }
    })
    h.fetch.mockRejectedValueOnce(new TypeError('offline'))
    expect(await h.invoke(productIpcChannels.checkForUpdates)).toMatchObject({
      ok: true,
      value: { phase: 'error', error: expect.stringContaining('Could not reach GitHub') }
    })
    expect(await h.invoke(productIpcChannels.installUpdate)).toMatchObject({ ok: false })
  })
})

describe('diagnostic IPC security', () => {
  it('checks the renderer before reading logs, copying, downloading, or recording an event', async () => {
    const h = harness()
    h.trusted.mockImplementation(() => {
      throw new Error('Untrusted renderer')
    })
    for (const name of [
      'getDiagnostics',
      'copyDiagnostics',
      'downloadDiagnostics',
      'clearDiagnostics',
      'recordProfileReorder'
    ] as const) {
      await expect(h.invoke(productIpcChannels[name])).rejects.toThrow('Untrusted renderer')
    }
    expect(h.copy).not.toHaveBeenCalled()
    expect(h.download).not.toHaveBeenCalled()
    expect(h.clear).not.toHaveBeenCalled()
    expect(h.write).not.toHaveBeenCalled()
  })

  it('rejects renderer-chosen paths and arbitrary logging fields', async () => {
    const h = harness()
    for (const name of ['copyDiagnostics', 'downloadDiagnostics', 'clearDiagnostics'] as const) {
      expect(await h.invoke(productIpcChannels[name], { path: 'C:\\private.jsonl' })).toMatchObject(
        { ok: false, error: { code: 'INVALID_REQUEST' } }
      )
    }
    const valid = {
      phase: 'started',
      interactionId: 'aef45b59-728e-4ce8-b411-68d08f32305d',
      clientTimestamp: '2026-10-02T01:08:01.560Z',
      profileId: 'gaming',
      input: 'pointer',
      fromIndex: 1,
      toIndex: 1,
      selectedProfileId: null,
      previewingProfileId: null
    }
    for (const invalid of [
      { ...valid, eventName: 'Forged' },
      { ...valid, toIndex: -1 },
      { ...valid, profileIds: Array(1001).fill('gaming') }
    ]) {
      expect(await h.invoke(productIpcChannels.recordProfileReorder, invalid)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_REQUEST' }
      })
    }
    expect(h.copy).not.toHaveBeenCalled()
    expect(h.download).not.toHaveBeenCalled()
    expect(h.clear).not.toHaveBeenCalled()
    expect(h.write).not.toHaveBeenCalled()
    expect(await h.invoke(productIpcChannels.recordProfileReorder, valid)).toEqual({
      ok: true,
      value: null
    })
    expect(h.write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'ProfileReorderStarted',
        interactionId: valid.interactionId
      })
    )
  })

  it('returns only success and cancellation values, without exposing filesystem locations', async () => {
    const h = harness()
    expect(await h.invoke(productIpcChannels.copyDiagnostics)).toEqual({ ok: true, value: null })
    expect(await h.invoke(productIpcChannels.downloadDiagnostics)).toEqual({
      ok: true,
      value: false
    })
    expect(h.copy).toHaveBeenCalledWith('')
  })

  it('clears through the main-owned logger and returns failures through the product error surface', async () => {
    const h = harness()
    expect(await h.invoke(productIpcChannels.clearDiagnostics)).toEqual({ ok: true, value: null })
    expect(h.clear).toHaveBeenCalledTimes(1)
    h.clear.mockImplementation(() => {
      throw new Error('Could not clear the logs. Please try again.')
    })
    expect(await h.invoke(productIpcChannels.clearDiagnostics)).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_FAILED', message: 'Could not clear the logs. Please try again.' }
    })
  })
})
