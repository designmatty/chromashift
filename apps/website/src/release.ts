const repository = 'designmatty/chromashift'
export const releasesApiUrl = `https://api.github.com/repos/${repository}/releases`
export const releasesPageUrl = `https://github.com/${repository}/releases`

export interface Installer {
  filename: string
  url: string
  version: string | undefined
}

type JsonObject = Record<string, unknown>

const ignoredAssetPattern = /\.(?:blockmap|ya?ml|sha256|txt)$/i
const downloadUrlPattern = /^https:\/\/github\.com\/designmatty\/chromashift\/releases\/download\//
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null
}

function releaseTime(release: JsonObject): number {
  const stamp = release.published_at ?? release.created_at
  const time = typeof stamp === 'string' ? Date.parse(stamp) : Number.NaN
  return Number.isNaN(time) ? 0 : time
}

/** Release tags are `v<version>`; installers are `ChromaShift-<version>-x64-setup.exe`. */
function releaseVersion(tag: unknown, filename: string): string | undefined {
  const candidates = [
    typeof tag === 'string' ? tag.replace(/^v/, '') : undefined,
    /^chromashift-(.+)-x64-setup\.exe$/i.exec(filename)?.[1]
  ]
  return candidates.find(
    (candidate): candidate is string => candidate !== undefined && versionPattern.test(candidate)
  )
}

function selectInstaller(release: JsonObject): Installer | undefined {
  if (!Array.isArray(release.assets)) return undefined
  const usable: Omit<Installer, 'version'>[] = []
  for (const asset of release.assets) {
    if (!isObject(asset)) continue
    const { name, browser_download_url: url } = asset
    if (typeof name !== 'string' || typeof url !== 'string') continue
    if (ignoredAssetPattern.test(name) || !downloadUrlPattern.test(url)) continue
    usable.push({ filename: name, url })
  }
  const installer =
    usable.find((candidate) => /^chromashift-.*-x64-setup\.exe$/i.test(candidate.filename)) ??
    usable.find((candidate) => /x64.*setup\.exe$/i.test(candidate.filename))
  if (installer === undefined) return undefined
  return { ...installer, version: releaseVersion(release.tag_name, installer.filename) }
}

/** Newest non-draft release, prereleases included, that ships an x64 installer. */
export function selectLatestInstaller(releases: unknown): Installer | undefined {
  if (!Array.isArray(releases)) return undefined
  const ordered = releases
    .filter(isObject)
    .filter((release) => release.draft !== true)
    .sort((left, right) => releaseTime(right) - releaseTime(left))
  for (const release of ordered) {
    const installer = selectInstaller(release)
    if (installer !== undefined) return installer
  }
  return undefined
}

/** Text for the line under the closing download button, when the version is known. */
export function installerLine(installer: Installer): string | undefined {
  return installer.version === undefined
    ? undefined
    : `Current version: ChromaShift ${installer.version}`
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
