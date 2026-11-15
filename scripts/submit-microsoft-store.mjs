import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import {
  compareUpdateVersions,
  installerDownloadUrl,
  repositoryNameSchema,
  updateRepositoryId,
  versionSchema
} from '../apps/desktop/src/shared/app-updates.ts'

const storeOrigin = 'https://api.store.microsoft.com'

// Transport and delay are injected for protocol tests; production uses fixed hosts.
export async function submitMicrosoftStore({
  env = globalThis.process.env,
  fetch = globalThis.fetch,
  wait = setTimeout
} = {}) {
  const required = (name) => {
    const value = env[name]?.trim()
    if (!value) throw new Error(`Microsoft Store submission requires ${name}.`)
    return value
  }
  const tag = required('STORE_RELEASE_TAG')
  const version = versionSchema.parse(tag.replace(/^v/u, ''))
  if (tag !== `v${version}`) throw new Error('Expected a versioned v<version> release tag.')
  const mode = required('STORE_DRY_RUN')
  if (!['true', 'false'].includes(mode)) throw new Error('STORE_DRY_RUN must be true or false.')
  const dryRun = mode === 'true'
  const repository = repositoryNameSchema.parse(required('GITHUB_REPOSITORY'))

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(30_000)
    })
    // Do not echo response bodies: authentication errors can contain credentials.
    if (!response.ok)
      throw new Error(`Request to ${new globalThis.URL(url).host} failed: HTTP ${response.status}.`)
    return response
  }
  async function github(path) {
    return (
      await request(`https://api.github.com/repos/${repository}${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${required('GH_TOKEN')}`
        }
      })
    ).json()
  }
  const identity = await github('')
  if (identity.id !== updateRepositoryId || identity.full_name !== repository)
    throw new Error('The release repository identity does not match ChromaShift.')
  const release = await github(`/releases/tags/${encodeURIComponent(tag)}`)
  const installerUrl = installerDownloadUrl(version, repository)
  const installerName = `ChromaShift-${version}-x64-setup.exe`
  const installer = release.assets?.find((asset) => asset.name === installerName)
  if (
    release.draft !== false ||
    release.tag_name !== tag ||
    !release.published_at ||
    installer?.state !== 'uploaded' ||
    !(installer.size > 0) ||
    installer.browser_download_url !== installerUrl
  )
    throw new Error(
      'Store submission requires a published release with its versioned x64 installer.'
    )

  // A queued event or manual dispatch must not roll the Store back to an older release.
  for (let page = 1; page <= 10; page++) {
    const releases = await github(`/releases?per_page=100&page=${page}`)
    if (!Array.isArray(releases)) throw new Error('GitHub returned an invalid release list.')
    for (const candidate of releases) {
      const newer = versionSchema.safeParse(candidate.tag_name?.replace(/^v/u, ''))
      if (
        candidate.draft === false &&
        newer.success &&
        compareUpdateVersions(newer.data, version) > 0
      )
        throw new Error('A newer published release exists. Submit that release instead.')
    }
    if (releases.length < 100) break
    if (page === 10) throw new Error('The release list exceeded the submission limit.')
  }
  // Check public access without sending the GitHub token to the download host.
  const publicInstaller = await fetch(installerUrl, {
    method: 'HEAD',
    redirect: 'follow',
    signal: globalThis.AbortSignal.timeout(30_000)
  })
  if (
    !publicInstaller.ok ||
    Number(publicInstaller.headers.get('content-length')) !== installer.size
  )
    throw new Error('The public installer is unavailable or its size does not match the release.')

  const tenant = encodeURIComponent(required('STORE_TENANT_ID'))
  const tokenResponse = await request(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: 'POST',
      body: new globalThis.URLSearchParams({
        grant_type: 'client_credentials',
        client_id: required('STORE_CLIENT_ID'),
        client_secret: required('STORE_CLIENT_SECRET'),
        scope: `${storeOrigin}/.default`
      })
    }
  )
  const token = (await tokenResponse.json()).access_token
  if (typeof token !== 'string' || !token)
    throw new Error('Microsoft did not return an access token.')
  const productPath = `/submission/v1/product/${encodeURIComponent(required('STORE_PRODUCT_ID'))}`
  const seller = required('STORE_SELLER_ID')
  async function store(path, method = 'GET', body) {
    const response = await request(`${storeOrigin}${productPath}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Seller-Account-Id': seller,
        'Content-Type': 'application/json'
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const result = await response.json()
    if (result.isSuccess !== true || result.errors?.some((error) => error.code !== 'warning'))
      throw new Error(
        `Microsoft Store ${method} ${path} failed. Inspect the draft in Partner Center.`
      )
    if (result.responseData?.ongoingSubmissionId)
      throw new Error(
        'A Store submission is already in progress. Wait for certification before retrying.'
      )
    return result.responseData
  }
  const status = await store('/status')
  if (status?.isReady !== true)
    throw new Error('The Store draft is not ready. Complete its initial setup in Partner Center.')
  const packages = (await store('/packages'))?.packages
  if (
    !Array.isArray(packages) ||
    packages.length !== 1 ||
    packages[0].packageType !== 'exe' ||
    packages[0].architectures?.length !== 1 ||
    packages[0].architectures[0] !== 'X64' ||
    !packages[0].packageId ||
    packages[0].isSilentInstall !== false ||
    !packages[0].installerParameters
  )
    throw new Error(
      'Expected one configured x64 EXE package with validated silent installer parameters.'
    )
  const current = packages[0]
  const currentVersion = /\/ChromaShift-([^/]+)-x64-setup\.exe$/u.exec(current.packageUrl)?.[1]
  if (
    !versionSchema.safeParse(currentVersion).success ||
    current.packageUrl !== installerDownloadUrl(currentVersion, repository)
  )
    throw new Error('The configured Store package must use a versioned ChromaShift release URL.')
  if (compareUpdateVersions(currentVersion, version) > 0)
    throw new Error('The Store package is newer than this release. Refusing to downgrade.')
  const result = { tag, installerUrl, dryRun }
  if (dryRun) return { ...result, outcome: 'validated' }
  if (current.packageUrl === installerUrl) return { ...result, outcome: 'unchanged' }

  // PATCH preserves installer parameters, return codes, languages and listing metadata.
  await store(`/packages/${encodeURIComponent(current.packageId)}`, 'PATCH', {
    packageUrl: installerUrl
  })
  await store('/packages/commit', 'POST')
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const ingestion = await store('/status')
    if (ingestion?.isReady === true) {
      ready = true
      break
    }
    await wait(10_000)
  }
  if (!ready)
    throw new Error('Store package ingestion timed out. Inspect the draft in Partner Center.')
  const submission = await store('/submit', 'POST')
  if (!submission?.submissionId)
    throw new Error('Submission response was inconclusive. Check Partner Center before retrying.')
  return { ...result, outcome: 'submitted', submissionId: submission.submissionId }
}

if (
  globalThis.process.argv[1] &&
  resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await submitMicrosoftStore()
    const summary = [
      `Microsoft Store: ${result.outcome} for ${result.tag}.`,
      `Installer: ${result.installerUrl}`,
      result.submissionId ? `Submission ID: ${result.submissionId}. Certification is pending.` : '',
      result.outcome === 'unchanged'
        ? 'This URL is already configured. If a previous attempt failed, complete the draft in Partner Center.'
        : ''
    ]
      .filter(Boolean)
      .join('\n\n')
    globalThis.console.log(summary)
    if (globalThis.process.env.GITHUB_STEP_SUMMARY)
      await appendFile(globalThis.process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
  } catch (error) {
    globalThis.console.error(error.message)
    globalThis.process.exitCode = 1
  }
}
