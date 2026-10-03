import type { AppUpdateStatus, UpdateRelease } from '@shared/app-updates.js'
import type { UpdateChecker } from '@main/update-checker.js'

export interface UpdateInstallerPort {
  download(release: UpdateRelease, onProgress: (percent: number) => void): Promise<void>
  prepareInstall(): Promise<void>
  install(): void
}

/** Owns the download and install intent across renderer destruction and reopening. */
export class AppUpdateService {
  #status: AppUpdateStatus
  #pendingCheck: Promise<AppUpdateStatus> | undefined
  #pendingInstall: Promise<boolean> | undefined
  #installRequested = false

  public constructor(
    private readonly options: {
      checker: Pick<UpdateChecker, 'check'>
      installer?: UpdateInstallerPort
      requestExit: () => Promise<boolean>
    }
  ) {
    this.#status = {
      phase: 'idle',
      checkedAt: null,
      release: null,
      percent: null,
      error: null,
      installationSupported: options.installer !== undefined
    }
  }

  public getStatus(): AppUpdateStatus {
    return { ...this.#status }
  }

  public check(): Promise<AppUpdateStatus> {
    if (this.#pendingCheck !== undefined) return this.#pendingCheck
    if (this.#status.phase === 'ready' || this.#status.phase === 'installing')
      return Promise.resolve(this.getStatus())
    this.#pendingCheck = this.#check().finally(() => {
      this.#pendingCheck = undefined
    })
    return this.#pendingCheck
  }

  async #check(): Promise<AppUpdateStatus> {
    this.#status = { ...this.#status, phase: 'checking', percent: null, error: null }
    try {
      const check = await this.options.checker.check()
      this.#status = {
        ...this.#status,
        ...check,
        phase: check.release === null ? 'up-to-date' : 'available'
      }
      if (check.release !== null && this.options.installer !== undefined) {
        this.#status = { ...this.#status, phase: 'downloading', percent: 0 }
        await this.options.installer.download(check.release, (percent) => {
          if (Number.isFinite(percent))
            this.#status = { ...this.#status, percent: Math.min(100, Math.max(0, percent)) }
        })
        this.#status = { ...this.#status, phase: 'ready', percent: 100 }
      }
    } catch (error) {
      this.#status = {
        ...this.#status,
        phase: 'error',
        percent: null,
        error:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : 'Could not update ChromaShift. Try again.'
      }
    }
    return this.getStatus()
  }

  public install(): Promise<boolean> {
    if (this.#pendingInstall !== undefined) return this.#pendingInstall
    if (this.#status.phase !== 'ready' || this.options.installer === undefined) {
      return Promise.reject(
        new Error('Wait for an update to finish downloading before installing it.')
      )
    }
    this.#status = { ...this.#status, phase: 'installing', error: null }
    this.#pendingInstall = this.options.installer
      .prepareInstall()
      .then(() => {
        this.#installRequested = true
        return this.options.requestExit()
      })
      .then((allowed) => {
        if (!allowed) {
          this.#installRequested = false
          this.#status = {
            ...this.#status,
            phase: 'ready',
            error:
              'Installation is waiting for display restoration. Try again after resolving the display error.'
          }
        }
        return allowed
      })
      .catch(() => {
        this.#installRequested = false
        this.#status = {
          ...this.#status,
          phase: 'error',
          error: 'Could not verify the downloaded update. Check for updates to try again.'
        }
        throw new Error(this.#status.error!)
      })
      .finally(() => {
        this.#pendingInstall = undefined
      })
    return this.#pendingInstall
  }

  /** Called only by the shutdown coordinator's exit port after confirmed restoration. */
  public installOnExit(): boolean {
    if (!this.#installRequested || this.options.installer === undefined) return false
    this.#installRequested = false
    this.options.installer.install()
    return true
  }
}
