import { describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerProductIpcHandlers } from '@main/product-ipc.js'
import { DiagnosticsService } from '@main/diagnostics-service.js'
import { UpdateChecker } from '@main/update-checker.js'
import { AppUpdateService } from '@main/app-update-service.js'
import { productIpcChannels } from '@shared/product-api.js'
import { PreviewRestoreError } from '@main/preview-session-controller.js'
import { PanelController } from '@main/panel-controller.js'
import type { ProductController } from '@main/product-controller.js'

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
  const hideMiniPanel = vi.fn(async () => undefined)
  const getController = vi.fn<() => ProductController | undefined>(() => undefined)
  const panels = new PanelController(
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined
  )
  panels.openMiniPanel()
  registerProductIpcHandlers(
    {
      handle: (name: string, handler: typeof handlers extends Map<string, infer T> ? T : never) =>
        handlers.set(name, handler)
    } as unknown as IpcMain,
    getController,
    trusted,
    async () => true,
    () => {},
    hideMiniPanel,
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
    }),
    {
      get: () => panels.getPanelLifetime('mini'),
      assert: (_event, lifetime) => panels.assertPanelLifetime('mini', lifetime)
    }
  )
  const invoke = (name: string, input: unknown = {}) =>
    handlers.get(name)!({} as IpcMainInvokeEvent, input)
  return {
    copy,
    download,
    clear,
    write,
    trusted,
    invoke,
    fetch,
    installUpdate,
    hideMiniPanel,
    panels,
    getController
  }
}

describe('preview lifetime IPC', () => {
  it('sender-checks and validates editor-open and per-display learned-limit reset', async () => {
    const h = harness()
    const profile = { id: 'game', name: 'Game', enabled: true, applications: [], displays: [] }
    const product = {
      openProfile: vi.fn(async () => profile),
      resetLearnedLimits: vi.fn(async () => undefined)
    }
    h.getController.mockReturnValue(product as unknown as ProductController)
    expect(await h.invoke(productIpcChannels.openProfile, { profileId: 'game' })).toEqual({
      ok: true,
      value: profile
    })
    expect(
      await h.invoke(productIpcChannels.resetLearnedLimits, { displayId: 'display:one' })
    ).toEqual({ ok: true, value: null })
    expect(h.trusted).toHaveBeenCalledTimes(2)
    expect(
      await h.invoke(productIpcChannels.resetLearnedLimits, { displayId: 'not-a-stable-id' })
    ).toMatchObject({ ok: false })
    expect(
      await h.invoke(productIpcChannels.resetLearnedLimits, {
        displayId: 'display:one',
        path: 'profiles.json'
      })
    ).toMatchObject({ ok: false })
    expect(product.resetLearnedLimits).toHaveBeenCalledTimes(1)
    h.trusted.mockImplementation(() => {
      throw new Error('Untrusted renderer')
    })
    await expect(
      h.invoke(productIpcChannels.resetLearnedLimits, { displayId: 'display:one' })
    ).rejects.toThrow('Untrusted renderer')
    expect(product.resetLearnedLimits).toHaveBeenCalledTimes(1)
  })
  it('rejects stale starts, updates, commits and cancels after close and after reopening', async () => {
    const h = harness()
    const product = {
      startPreview: vi.fn(async () => undefined),
      updatePreview: vi.fn(async () => undefined),
      confirmPreview: vi.fn(),
      cancelPreview: vi.fn(async () => undefined)
    }
    h.getController.mockReturnValue(product as unknown as ProductController)
    const lifetime = h.panels.getPanelLifetime('mini')!
    const profile = { id: 'game', name: 'Game', enabled: true, applications: [], displays: [] }
    const requests = [
      [productIpcChannels.startPreview, { profile, kind: 'override' }],
      [productIpcChannels.updatePreview, { profileId: profile.id, targets: [] }],
      [productIpcChannels.confirmPreview, { profile, activation: 'preserve' }],
      [productIpcChannels.cancelPreview, {}],
      [productIpcChannels.hideMiniPanel, {}]
    ] as const
    h.panels.endPanelLifetime('mini')
    for (const reopen of [false, true]) {
      if (reopen) h.panels.openMiniPanel()
      for (const [channel, request] of requests) {
        expect(await h.invoke(channel, { lifetime, request })).toMatchObject({
          ok: false,
          error: { code: 'CONFLICT' }
        })
      }
    }
    for (const method of Object.values(product)) expect(method).not.toHaveBeenCalled()
    expect(
      await h.invoke(productIpcChannels.startPreview, {
        lifetime: h.panels.getPanelLifetime('mini'),
        request: { profile, kind: 'override' }
      })
    ).toEqual({ ok: true, value: null })
    expect(product.startPreview).toHaveBeenCalledOnce()
  })

  it('requires validated lifetime envelopes and a trusted sender', async () => {
    const h = harness()
    for (const input of [
      {},
      { lifetime: -1, request: {} },
      { lifetime: 1, request: {}, extra: true }
    ]) {
      expect(await h.invoke(productIpcChannels.cancelPreview, input)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_REQUEST' }
      })
    }
    h.trusted.mockImplementation(() => {
      throw new Error('Untrusted renderer')
    })
    await expect(
      h.invoke(productIpcChannels.cancelPreview, {
        lifetime: h.panels.getPanelLifetime('mini'),
        request: {}
      })
    ).rejects.toThrow('Untrusted renderer')
    expect(h.getController).not.toHaveBeenCalled()
  })
})

describe('mini-panel close IPC', () => {
  it('waits for rollback and returns restoration failure instead of silent success', async () => {
    const h = harness()
    let reject!: (error: Error) => void
    h.hideMiniPanel.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail
        })
    )
    const settled = vi.fn()
    const closing = h
      .invoke(productIpcChannels.hideMiniPanel, {
        lifetime: h.panels.getPanelLifetime('mini'),
        request: {}
      })
      .then((result) => {
        settled()
        return result
      })
    await Promise.resolve()
    expect(h.hideMiniPanel).toHaveBeenCalledOnce()
    expect(settled).not.toHaveBeenCalled()
    reject(new PreviewRestoreError(['display:one: restore failed']))
    expect(await closing).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_FAILED', details: ['display:one: restore failed'] }
    })
  })

  it('rejects untrusted and invalid close requests before rollback', async () => {
    const h = harness()
    expect(await h.invoke(productIpcChannels.hideMiniPanel, { reason: 'handoff' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' }
    })
    h.trusted.mockImplementation(() => {
      throw new Error('Untrusted renderer')
    })
    await expect(h.invoke(productIpcChannels.hideMiniPanel)).rejects.toThrow('Untrusted renderer')
    expect(h.hideMiniPanel).not.toHaveBeenCalled()
  })
})

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
      value: {
        phase: 'error',
        error: expect.stringContaining('Could not reach the update service')
      }
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
