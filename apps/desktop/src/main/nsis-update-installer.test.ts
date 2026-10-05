import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NsisUpdateInstaller } from '@main/nsis-update-installer.js'
import { installerDownloadUrl } from '@shared/app-updates.js'

const fixture = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('electron-updater', () => ({
  default: {
    NsisUpdater: class {
      constructor(options: unknown) {
        return fixture.create(options)
      }
    }
  }
}))

const version = '0.1.0-preview.9'
const filename = `ChromaShift-${version}-x64-setup.exe`
const release = { version, downloadUrl: installerDownloadUrl(version) }
const payload = Buffer.from('signed installer fixture')
const sha512 = createHash('sha512').update(payload).digest('base64')
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-updater-test-'))
  directories.push(directory)
  const path = join(directory, filename)
  await writeFile(path, payload)
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: true,
    disableDifferentialDownload: false,
    logger: {},
    on: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: {
        version,
        path: filename,
        sha512,
        files: [{ url: filename, sha512 }]
      }
    })),
    downloadUpdate: vi.fn(async () => [path]),
    quitAndInstall: vi.fn()
  }
  fixture.create.mockReturnValue(updater)
  const readPublisher = vi.fn(async () => 'CN=Approved publisher')
  const installer = new NsisUpdateInstaller({
    executablePath: 'C:\\ChromaShift.exe',
    logger: { write: vi.fn() },
    readPublisher
  })
  return { installer, updater, readPublisher, path }
}

describe('NSIS update installation', () => {
  it('downloads from the canonical release feed after an organization transfer', async () => {
    const h = await harness()
    await h.installer.download(
      { version, downloadUrl: installerDownloadUrl(version, 'future-org/renamed-repo') },
      () => {}
    )
    expect(fixture.create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `https://github.com/future-org/renamed-repo/releases/download/v${version}/`
      })
    )
    expect(h.readPublisher.mock.calls).toEqual([['C:\\ChromaShift.exe'], [h.path]])
  })
  it('pins the exact release feed, checks the publisher, disables unguarded install-on-quit, and installs silently', async () => {
    const h = await harness()
    await h.installer.download(release, () => {})
    expect(fixture.create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://github.com/designmatty/chromashift/releases/download/v0.1.0-preview.9/',
        channel: 'latest'
      })
    )
    expect(h.updater.autoInstallOnAppQuit).toBe(false)
    expect(h.updater.allowDowngrade).toBe(false)
    expect(h.updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(h.readPublisher.mock.calls).toEqual([['C:\\ChromaShift.exe'], [h.path]])
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled()
    await h.installer.prepareInstall()
    h.installer.install()
    expect(h.updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('rejects manifest version or file mismatches before download', async () => {
    const h = await harness()
    h.updater.checkForUpdates.mockResolvedValueOnce({
      isUpdateAvailable: true,
      updateInfo: { version: '9.0.0', path: filename, sha512, files: [{ url: filename, sha512 }] }
    })
    await expect(h.installer.download(release, () => {})).rejects.toThrow('download and verify')
    expect(h.updater.downloadUpdate).not.toHaveBeenCalled()
    expect(() => h.installer.install()).toThrow('No verified update')
  })

  it('rejects invalid and different publisher signatures', async () => {
    const h = await harness()
    h.readPublisher.mockRejectedValueOnce(new Error('unsigned app'))
    await expect(h.installer.download(release, () => {})).rejects.toThrow('unsigned app')
    expect(h.updater.downloadUpdate).not.toHaveBeenCalled()
    h.readPublisher
      .mockResolvedValueOnce('CN=Approved publisher')
      .mockResolvedValueOnce('CN=Different publisher')
    await expect(h.installer.download(release, () => {})).rejects.toThrow('download and verify')
    expect(() => h.installer.install()).toThrow('No verified update')
  })

  it('rechecks the downloaded hash before shutdown and rejects cache tampering', async () => {
    const h = await harness()
    await h.installer.download(release, () => {})
    await writeFile(h.path, 'changed installer')
    await expect(h.installer.prepareInstall()).rejects.toThrow('downloaded update changed')
    expect(() => h.installer.install()).toThrow('No verified update')
  })
})
