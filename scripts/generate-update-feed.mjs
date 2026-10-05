import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compareUpdateVersions,
  installerDownloadUrl,
  repositoryNameSchema,
  updateFeedSchema,
  updateRepositoryId,
  versionSchema
} from '../apps/desktop/src/shared/app-updates.ts'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function buildUpdateFeed(repository, input) {
  if (repository?.id !== updateRepositoryId)
    throw new Error('The update repository identity does not match ChromaShift.')
  const fullName = repositoryNameSchema.parse(repository.full_name)
  if (!Array.isArray(input)) throw new Error('GitHub returned an invalid release list.')
  let stable
  let preview
  for (const release of input) {
    if (
      release?.draft !== false ||
      typeof release.prerelease !== 'boolean' ||
      typeof release.tag_name !== 'string' ||
      !Array.isArray(release.assets)
    )
      continue
    const version = versionSchema.safeParse(release.tag_name?.replace(/^v/u, ''))
    if (!version.success || release.tag_name !== `v${version.data}`) continue
    const downloadUrl = installerDownloadUrl(version.data, fullName)
    const filename = `ChromaShift-${version.data}-x64-setup.exe`
    const prefix = new globalThis.URL('.', downloadUrl).toString()
    const complete = [filename, `${filename}.blockmap`, 'latest.yml'].every((name) =>
      release.assets?.some(
        (asset) =>
          asset.name === name &&
          asset.state === 'uploaded' &&
          asset.size > 0 &&
          asset.browser_download_url === `${prefix}${name}`
      )
    )
    if (!complete) continue
    const candidate = {
      version: version.data,
      downloadUrl,
      prerelease: release.prerelease || version.data.split('+')[0].includes('-')
    }
    if (candidate.prerelease) {
      if (preview === undefined || compareUpdateVersions(candidate.version, preview.version) > 0)
        preview = candidate
    } else if (
      stable === undefined ||
      compareUpdateVersions(candidate.version, stable.version) > 0
    ) {
      stable = candidate
    }
  }
  const releases = [stable, preview].filter((release) => release !== undefined)
  if (releases.length === 0) throw new Error('No complete published Windows release is available.')
  return updateFeedSchema.parse({
    schemaVersion: 1,
    repository: { id: updateRepositoryId, fullName },
    releases
  })
}

async function githubJson(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'ChromaShift-update-feed-publisher'
  }
  if (globalThis.process.env.GH_TOKEN)
    headers.Authorization = `Bearer ${globalThis.process.env.GH_TOKEN}`
  const response = await globalThis.fetch(`https://api.github.com${path}`, {
    headers,
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`GitHub metadata request failed with HTTP ${response.status}.`)
  return response.json()
}

export async function generateUpdateFeed(options = {}) {
  // ID lookup allows a manual refresh after a transfer without knowing the new owner.
  // CI uses GITHUB_REPOSITORY, then verifies its immutable ID before trusting assets.
  const configuredRepository = options.repository ?? globalThis.process.env.GITHUB_REPOSITORY
  const repository = await githubJson(
    configuredRepository
      ? `/repos/${repositoryNameSchema.parse(configuredRepository)}`
      : `/repositories/${updateRepositoryId}`
  )
  if (repository.id !== updateRepositoryId)
    throw new Error('The update repository identity does not match ChromaShift.')
  const fullName = repositoryNameSchema.parse(repository.full_name)
  const releases = []
  // Bounded pagination includes older stable releases even after many previews.
  for (let page = 1; page <= 10; page++) {
    const batch = await githubJson(`/repos/${fullName}/releases?per_page=100&page=${page}`)
    if (!Array.isArray(batch)) throw new Error('GitHub returned an invalid release list.')
    releases.push(...batch)
    if (batch.length < 100) break
    if (page === 10) throw new Error('The release list exceeded the publication limit.')
  }
  const feed = buildUpdateFeed(repository, releases)
  const output = resolve(options.output ?? join(repositoryRoot, 'apps/updates/dist'))
  await mkdir(join(output, 'v1'), { recursive: true })
  await writeFile(join(output, 'v1/releases.json'), `${JSON.stringify(feed, null, 2)}\n`)
  await writeFile(
    join(output, '_headers'),
    await readFile(join(repositoryRoot, 'apps/updates/headers.txt'), 'utf8')
  )
  return feed
}

if (
  globalThis.process.argv[1] &&
  resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const feed = await generateUpdateFeed()
  globalThis.console.log(
    `Update feed prepared for ${feed.repository.fullName}: ${feed.releases.map((release) => release.version).join(', ')}`
  )
}
