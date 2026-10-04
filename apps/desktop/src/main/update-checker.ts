import {
  compareUpdateVersions,
  updateFeedUrl,
  updateFeedSchema,
  updateCheckSchema,
  versionSchema,
  type UpdateCheck,
  type UpdateRelease
} from '@shared/app-updates.js'

function selectRelease(input: unknown, currentVersion: string): UpdateRelease | null {
  const parsed = updateFeedSchema.safeParse(input)
  if (!parsed.success)
    throw new Error('The update service returned invalid release data. Try again later.')
  const includePreviews = currentVersion.split('+')[0]!.includes('-')
  let latest: UpdateRelease | undefined
  for (const release of parsed.data.releases) {
    if (!includePreviews && (release.prerelease || release.version.split('+')[0]!.includes('-')))
      continue
    if (latest === undefined || compareUpdateVersions(release.version, latest.version) > 0)
      latest = { version: release.version, downloadUrl: release.downloadUrl }
  }
  if (latest === undefined)
    throw new Error(
      'No published installer is available for this release channel. Try again later.'
    )
  return compareUpdateVersions(latest.version, currentVersion) > 0 ? latest : null
}

export class UpdateChecker {
  #lastCheck: UpdateCheck | null = null
  #pending: Promise<UpdateCheck> | undefined

  public constructor(
    private readonly options: {
      currentVersion: string
      fetch: (url: string, options: RequestInit) => Promise<Response>
      timeoutMilliseconds?: number
    }
  ) {
    versionSchema.parse(options.currentVersion)
  }

  public getStatus(): UpdateCheck | null {
    return this.#lastCheck
  }

  public check(): Promise<UpdateCheck> {
    if (this.#pending !== undefined) return this.#pending
    this.#pending = this.#check().finally(() => {
      this.#pending = undefined
    })
    return this.#pending
  }

  async #check(): Promise<UpdateCheck> {
    const signal = AbortSignal.timeout(this.options.timeoutMilliseconds ?? 15_000)
    try {
      const response = await this.options.fetch(updateFeedUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': `ChromaShift/${this.options.currentVersion}`
        },
        signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error'
      })
      if (response.status === 403 || response.status === 429)
        throw new Error('The update service is limiting update checks. Try again later.')
      if (!response.ok)
        throw new Error('The update service could not provide updates. Try again later.')
      const reader = response.body?.getReader()
      if (reader === undefined)
        throw new Error('The update service returned an empty response. Try again later.')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 64 * 1024)
            throw new Error('The update service returned too much release data. Try again later.')
          chunks.push(value)
        }
      } finally {
        await reader.cancel()
      }
      let releases: unknown
      try {
        releases = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        throw new Error('The update service returned invalid release data. Try again later.')
      }
      this.#lastCheck = updateCheckSchema.parse({
        checkedAt: new Date().toISOString(),
        release: selectRelease(releases, this.options.currentVersion)
      })
      return this.#lastCheck
    } catch (error) {
      if (signal.aborted)
        throw new Error('The update check timed out. Check your connection and try again.')
      if (error instanceof TypeError)
        throw new Error('Could not reach the update service. Check your connection and try again.')
      throw error
    }
  }
}
