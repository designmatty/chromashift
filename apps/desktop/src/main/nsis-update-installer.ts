import electronUpdater from 'electron-updater'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { updateReleaseSchema, type UpdateRelease } from '@shared/app-updates.js'
import type { UpdateInstallerPort } from '@main/app-update-service.js'
import { readTrustedPublisher } from '@main/windows-update-signature.js'
import type { StructuredLogger } from '@main/structured-logger.js'

/** Uses the exact release selected by UpdateChecker, including preview releases. */
export class NsisUpdateInstaller implements UpdateInstallerPort {
  #updater: InstanceType<typeof electronUpdater.NsisUpdater> | undefined
  #download: { path: string; publisher: string; sha512: string } | undefined

  public constructor(
    private readonly options: {
      executablePath: string
      logger: StructuredLogger
      readPublisher?: typeof readTrustedPublisher
      createUpdater?: (
        options: ConstructorParameters<typeof electronUpdater.NsisUpdater>[0]
      ) => InstanceType<typeof electronUpdater.NsisUpdater>
    }
  ) {}

  public async download(
    release: UpdateRelease,
    onProgress: (percent: number) => void
  ): Promise<void> {
    updateReleaseSchema.parse(release)
    this.#updater = undefined
    this.#download = undefined
    const readPublisher = this.options.readPublisher ?? readTrustedPublisher
    const publisher = await readPublisher(this.options.executablePath)
    const createUpdater =
      this.options.createUpdater ?? ((options) => new electronUpdater.NsisUpdater(options))
    const updater = createUpdater({
      provider: 'generic',
      url: new URL('.', release.downloadUrl).toString(),
      channel: 'latest',
      useMultipleRangeRequest: false
    })
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = true
    updater.allowDowngrade = false
    updater.disableDifferentialDownload = true
    updater.disableWebInstaller = true
    updater.logger = null
    updater.on('error', (error) => {
      this.options.logger.write({
        level: 'warning',
        eventName: 'UpdateFailed',
        message: error.message
      })
    })
    updater.on('download-progress', (progress) => onProgress(progress.percent))
    try {
      const result = await updater.checkForUpdates()
      const info = result?.updateInfo
      const filename = `ChromaShift-${release.version}-x64-setup.exe`
      if (
        !result?.isUpdateAvailable ||
        info?.version !== release.version ||
        info.path !== filename ||
        info.files.length !== 1 ||
        info.files[0]?.url !== filename ||
        'packages' in info ||
        !/^[A-Za-z0-9+/]{86}==$/u.test(info.files[0]?.sha512 ?? '') ||
        info.sha512 !== info.files[0]?.sha512
      ) {
        throw new Error('The update metadata did not match the published Windows installer.')
      }
      const files = await updater.downloadUpdate()
      const installer = files[0]
      if (files.length !== 1 || installer === undefined)
        throw new Error('The update download was incomplete.')
      const downloadedPublisher = await readPublisher(installer)
      if (downloadedPublisher !== publisher)
        throw new Error('The update publisher did not match this installation.')
      this.#updater = updater
      this.#download = { path: installer, publisher, sha512: info.files[0]!.sha512 }
    } catch (error) {
      this.options.logger.write({
        level: 'warning',
        eventName: 'UpdateDownloadFailed',
        message: error instanceof Error ? error.message : String(error)
      })
      throw new Error(
        'Could not download and verify the update. Check your connection and try again.'
      )
    }
  }

  public async prepareInstall(): Promise<void> {
    const download = this.#download
    if (download === undefined) throw new Error('No verified update is ready to install.')
    const hash = createHash('sha512')
    for await (const chunk of createReadStream(download.path)) hash.update(chunk)
    const publisher = await (this.options.readPublisher ?? readTrustedPublisher)(download.path)
    if (hash.digest('base64') !== download.sha512 || publisher !== download.publisher) {
      this.#updater = undefined
      this.#download = undefined
      throw new Error('The downloaded update changed. Check for updates to download it again.')
    }
  }

  public install(): void {
    if (this.#updater === undefined) throw new Error('No verified update is ready to install.')
    this.#updater.quitAndInstall(true, true)
  }
}
