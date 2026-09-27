const repository = 'designmatty/chromashift'
export const releasesApiUrl = `https://api.github.com/repos/${repository}/releases`
export const releasesPageUrl = `https://github.com/${repository}/releases`

export interface Installer {
  filename: string
  url: string
}

type JsonObject = Record<string, unknown>

const ignoredAssetPattern = /\.(?:blockmap|ya?ml|sha256|txt)$/i
const downloadUrlPattern = /^https:\/\/github\.com\/designmatty\/chromashift\/releases\/download\//

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null
}

function releaseTime(release: JsonObject): number {
  const stamp = release.published_at ?? release.created_at
  const time = typeof stamp === 'string' ? Date.parse(stamp) : Number.NaN
  return Number.isNaN(time) ? 0 : time
}

function selectInstaller(assets: unknown): Installer | undefined {
  if (!Array.isArray(assets)) return undefined
  const usable: Installer[] = []
  for (const asset of assets) {
    if (!isObject(asset)) continue
    const { name, browser_download_url: url } = asset
    if (typeof name !== 'string' || typeof url !== 'string') continue
    if (ignoredAssetPattern.test(name) || !downloadUrlPattern.test(url)) continue
    usable.push({ filename: name, url })
  }
  return (
    usable.find((installer) => /^chromashift-.*-x64-setup\.exe$/i.test(installer.filename)) ??
    usable.find((installer) => /x64.*setup\.exe$/i.test(installer.filename))
  )
}

/** Newest non-draft release, prereleases included, that ships an x64 installer. */
export function selectLatestInstaller(releases: unknown): Installer | undefined {
  if (!Array.isArray(releases)) return undefined
  const ordered = releases
    .filter(isObject)
    .filter((release) => release.draft !== true)
    .sort((left, right) => releaseTime(right) - releaseTime(left))
  for (const release of ordered) {
    const installer = selectInstaller(release.assets)
    if (installer !== undefined) return installer
  }
  return undefined
}

export async function fetchLatestInstaller(
  fetchImplementation: typeof fetch = fetch
): Promise<Installer | undefined> {
  const response = await fetchImplementation(releasesApiUrl, {
    headers: { Accept: 'application/vnd.github+json' },
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  })
  if (!response.ok) return undefined
  return selectLatestInstaller(await response.json())
}
