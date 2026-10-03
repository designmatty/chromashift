import { describe, expect, it, vi } from 'vitest'
import { AppUpdateService, type UpdateInstallerPort } from '@main/app-update-service.js'
import { ShutdownCoordinator } from '@main/shutdown-coordinator.js'
import { installerDownloadUrl } from '@shared/app-updates.js'

const release = { version: '0.1.0-preview.9', downloadUrl: installerDownloadUrl('0.1.0-preview.9') }
const check = { checkedAt: '2026-10-03T21:00:00.000Z', release }

function harness() {
  const checker = { check: vi.fn(async () => check) }
  const installer = {
    download: vi.fn<UpdateInstallerPort['download']>(async () => {}),
    prepareInstall: vi.fn(async () => {}),
    install: vi.fn()
  }
  const requestExit = vi.fn(async () => false)
  const service = new AppUpdateService({ checker, installer, requestExit })
  return { service, checker, installer, requestExit }
}

describe('in-app updates', () => {
  it('downloads automatically after a check, retains progress, and coalesces requests', async () => {
    const h = harness()
    let finish: (() => void) | undefined
    h.installer.download.mockImplementation((selectedRelease, progress) => {
      expect(selectedRelease).toEqual(release)
      progress(42)
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const pending = h.service.check()
    expect(h.service.check()).toBe(pending)
    await vi.waitFor(() =>
      expect(h.service.getStatus()).toMatchObject({ phase: 'downloading', percent: 42, release })
    )
    await expect(h.service.install()).rejects.toThrow('finish downloading')
    finish!()
    expect(await pending).toMatchObject({ phase: 'ready', percent: 100, release })
    expect(await h.service.check()).toMatchObject({ phase: 'ready' })
    expect(h.checker.check).toHaveBeenCalledOnce()
    expect(h.installer.install).not.toHaveBeenCalled()
    expect(h.service.installOnExit()).toBe(false)
  })

  it('waits for signature and hash revalidation, queued writes, and confirmed restoration before installation', async () => {
    const order: string[] = []
    const h = harness()
    h.installer.prepareInstall.mockImplementation(async () => {
      order.push('verify')
    })
    h.installer.install.mockImplementation(() => {
      order.push('install')
    })
    const shutdown = new ShutdownCoordinator(
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
          expect(h.service.installOnExit()).toBe(true)
        }
      },
      { show: () => {}, showError: () => {} },
      { write: () => {} }
    )
    h.requestExit.mockImplementation(() => shutdown.request('application'))
    await h.service.check()
    const pending = h.service.install()
    expect(h.service.install()).toBe(pending)
    expect(await pending).toBe(true)
    expect(order).toEqual(['verify', 'idle', 'restore', 'install'])
    expect(h.service.installOnExit()).toBe(false)
  })

  it('keeps the app and verified download available when restoration fails, then permits retry', async () => {
    const h = harness()
    const stop = vi
      .fn()
      .mockRejectedValueOnce(new Error('restore failed'))
      .mockResolvedValue(undefined)
    const shutdown = new ShutdownCoordinator(
      { waitForIdle: async () => {} },
      { running: true, stop },
      {
        exit: () => {
          h.service.installOnExit()
        }
      },
      { show: () => {}, showError: () => 'cancel' },
      { write: () => {} }
    )
    h.requestExit.mockImplementation(() => shutdown.request('application'))
    await h.service.check()
    expect(await h.service.install()).toBe(false)
    expect(h.service.getStatus()).toMatchObject({
      phase: 'ready',
      error: expect.stringContaining('display restoration')
    })
    expect(h.installer.install).not.toHaveBeenCalled()
    expect(h.service.installOnExit()).toBe(false)
    expect(await h.service.install()).toBe(true)
    expect(h.installer.install).toHaveBeenCalledOnce()
  })

  it('never installs during verification or exits when verification fails', async () => {
    const h = harness()
    let fail: ((error: Error) => void) | undefined
    h.installer.prepareInstall.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject
        })
    )
    await h.service.check()
    const pending = h.service.install()
    expect(h.service.installOnExit()).toBe(false)
    fail!(new Error('hash changed'))
    await expect(pending).rejects.toThrow('Could not verify the downloaded update')
    expect(h.requestExit).not.toHaveBeenCalled()
    expect(h.installer.install).not.toHaveBeenCalled()
    expect(h.service.getStatus().phase).toBe('error')
  })

  it('retries failed downloads and offers check-only mode in development', async () => {
    const h = harness()
    h.installer.download.mockRejectedValueOnce(new Error('download failed'))
    expect(await h.service.check()).toMatchObject({ phase: 'error', error: 'download failed' })
    expect(await h.service.check()).toMatchObject({ phase: 'ready' })
    const development = new AppUpdateService({ checker: h.checker, requestExit: h.requestExit })
    expect(await development.check()).toMatchObject({
      phase: 'available',
      installationSupported: false
    })
    await expect(development.install()).rejects.toThrow('finish downloading')
  })
})
