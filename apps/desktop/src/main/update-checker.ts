import { z } from 'zod'
import {
  installerDownloadUrl,
  releasesApiUrl,
  updateCheckSchema,
  versionSchema,
  type UpdateCheck,
  type UpdateRelease
} from '@shared/app-updates.js'

const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(
    z.object({
      name: z.string(),
      state: z.string(),
      size: z.number(),
      browser_download_url: z.string()
    })
  )
})

/** Compare valid SemVer versions; build metadata does not affect precedence. */
function compareVersions(left: string, right: string): number {
  const parts = (version: string) => {
    const [core, ...prerelease] = version.split('+')[0]!.split('-')
    return { core: core!.split('.').map(BigInt), prerelease: prerelease.join('-').split('.') }
  }
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < 3; index++) {
    if (a.core[index]! > b.core[index]!) return 1
    if (a.core[index]! < b.core[index]!) return -1
  }
  if (a.prerelease[0] === '') return b.prerelease[0] === '' ? 0 : 1
  if (b.prerelease[0] === '') return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const numericX = /^\d+$/u.test(x)
    const numericY = /^\d+$/u.test(y)
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1
    if (numericX !== numericY) return numericX ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

function selectRelease(input: unknown, currentVersion: string): UpdateRelease | null {
  if (!Array.isArray(input))
    throw new Error('GitHub returned an invalid release list. Try again later.')
  const includePreviews = currentVersion.split('+')[0]!.includes('-')
  let latest: UpdateRelease | undefined
  for (const entry of input) {
    const parsed = releaseSchema.safeParse(entry)
    if (!parsed.success || parsed.data.draft) continue
    const release = parsed.data
    const version = versionSchema.safeParse(release.tag_name.replace(/^v/u, ''))
    if (!version.success || release.tag_name !== `v${version.data}`) continue
    if (!includePreviews && (release.prerelease || version.data.split('+')[0]!.includes('-')))
      continue
    const downloadUrl = installerDownloadUrl(version.data)
    const filename = `ChromaShift-${version.data}-x64-setup.exe`
    if (
      !release.assets.some(
        (asset) =>
          asset.name === filename &&
          asset.state === 'uploaded' &&
          asset.size > 0 &&
          asset.browser_download_url === downloadUrl
      )
    )
      continue
    if (latest === undefined || compareVersions(version.data, latest.version) > 0) {
      latest = { version: version.data, downloadUrl }
    }
  }
  if (latest === undefined)
    throw new Error(
      'No published installer is available for this release channel. Try again later.'
    )
  return compareVersions(latest.version, currentVersion) > 0 ? latest : null
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
      const response = await this.options.fetch(releasesApiUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': `ChromaShift/${this.options.currentVersion}`
        },
        signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error'
      })
      if (response.status === 403 || response.status === 429) {
        throw new Error('GitHub is limiting update checks. Try again later.')
      }
      if (!response.ok) throw new Error('GitHub could not provide updates. Try again later.')
      // Limit external release metadata, including release notes, before parsing it.
      const reader = response.body?.getReader()
      if (reader === undefined)
        throw new Error('GitHub returned an empty response. Try again later.')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 5 * 1024 * 1024)
            throw new Error('GitHub returned too much release data. Try again later.')
          chunks.push(value)
        }
      } finally {
        await reader.cancel()
      }
      let releases: unknown
      try {
        releases = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        throw new Error('GitHub returned invalid release data. Try again later.')
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
        throw new Error('Could not reach GitHub. Check your connection and try again.')
      throw error
    }
  }
}
