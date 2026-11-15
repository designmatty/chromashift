import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { installerDownloadUrl, updateRepositoryId } from '../apps/desktop/src/shared/app-updates.ts'
import { submitMicrosoftStore } from './submit-microsoft-store.mjs'

function fixture(options = {}) {
  const env = {
    GITHUB_REPOSITORY: 'designmatty/chromashift',
    GH_TOKEN: 'github-fixture',
    STORE_RELEASE_TAG: 'v0.1.0-preview.13',
    STORE_DRY_RUN: 'false',
    STORE_TENANT_ID: 'tenant',
    STORE_CLIENT_ID: 'client',
    STORE_CLIENT_SECRET: 'secret-fixture',
    STORE_SELLER_ID: 'seller',
    STORE_PRODUCT_ID: 'product',
    ...options.env
  }
  const url = installerDownloadUrl('0.1.0-preview.13')
  const release = {
    tag_name: env.STORE_RELEASE_TAG,
    draft: false,
    published_at: '2026-10-31T00:00:00Z',
    assets: [
      {
        name: 'ChromaShift-0.1.0-preview.13-x64-setup.exe',
        state: 'uploaded',
        size: 123,
        browser_download_url: url
      }
    ],
    ...options.release
  }
  const current = {
    packageId: 'package',
    packageType: 'exe',
    architectures: ['X64'],
    packageUrl: installerDownloadUrl('0.1.0-preview.12'),
    isSilentInstall: false,
    installerParameters: '/S /currentuser',
    ...options.package
  }
  const calls = []
  let statuses = 0
  const fetch = async (url, init = {}) => {
    calls.push({ url, ...init })
    let data
    if (url === 'https://api.github.com/repos/designmatty/chromashift')
      data = { id: options.repositoryId ?? updateRepositoryId, full_name: env.GITHUB_REPOSITORY }
    else if (url.includes('/releases/tags/')) data = release
    else if (url.includes('/releases?')) data = options.releases ?? [release]
    else if (init.method === 'HEAD') {
      assert.equal(init.headers, undefined, 'public download must receive no token')
      return new globalThis.Response(null, {
        status: options.downloadStatus ?? 200,
        headers: { 'content-length': String(options.downloadSize ?? 123) }
      })
    } else if (url.startsWith('https://login.microsoftonline.com/')) {
      assert.equal(init.body.get('scope'), 'https://api.store.microsoft.com/.default')
      assert.equal(init.body.get('client_secret'), 'secret-fixture')
      data = { access_token: 'token-fixture' }
    } else {
      assert.equal(init.headers.Authorization, 'Bearer token-fixture')
      assert.equal(init.headers['X-Seller-Account-Id'], 'seller')
      if (url.endsWith('/status')) {
        data = { isReady: true, ...(options.statuses?.[statuses++] ?? {}) }
      } else if (url.endsWith('/packages')) data = { packages: options.packages ?? [current] }
      else if (url.endsWith('/submit')) data = { submissionId: 'submitted-123' }
      else data = {}
      if (options.failPath && url.endsWith(options.failPath))
        return new globalThis.Response(
          JSON.stringify({
            isSuccess: false,
            errors: [{ code: 'badrequest', message: 'secret-fixture' }]
          })
        )
      return new globalThis.Response(
        JSON.stringify({ isSuccess: true, errors: [], responseData: data })
      )
    }
    return new globalThis.Response(JSON.stringify(data))
  }
  const waits = []
  return {
    env,
    fetch,
    wait: async (ms) => {
      waits.push(ms)
    },
    calls,
    waits,
    url
  }
}

const writes = (run) =>
  run.calls.filter(
    (call) =>
      call.url.startsWith('https://api.store.microsoft.com') &&
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(call.method)
  )

test('submits a published installer through the EXE API, preserving the configured package', async () => {
  const run = fixture({ statuses: [{}, { isReady: false }, { isReady: true }] })
  const result = await submitMicrosoftStore(run)
  assert.equal(result.outcome, 'submitted')
  assert.equal(result.submissionId, 'submitted-123')
  assert.deepEqual(
    writes(run).map((call) => [call.method, new globalThis.URL(call.url).pathname, call.body]),
    [
      [
        'PATCH',
        '/submission/v1/product/product/packages/package',
        JSON.stringify({ packageUrl: run.url })
      ],
      ['POST', '/submission/v1/product/product/packages/commit', undefined],
      ['POST', '/submission/v1/product/product/submit', undefined]
    ]
  )
  assert.deepEqual(run.waits, [10_000])
})

test('dry run validates account, public asset and existing package without Store writes', async () => {
  const run = fixture({ env: { STORE_DRY_RUN: 'true' } })
  assert.equal((await submitMicrosoftStore(run)).outcome, 'validated')
  assert.deepEqual(writes(run), [])
})

test('a repeated release URL does not create a duplicate submission', async () => {
  const run = fixture({ package: { packageUrl: installerDownloadUrl('0.1.0-preview.13') } })
  assert.equal((await submitMicrosoftStore(run)).outcome, 'unchanged')
  assert.deepEqual(writes(run), [])
})

test('rejects unpublished, foreign, incomplete, inaccessible and stale releases before Store writes', async () => {
  for (const [options, message] of [
    [{ repositoryId: 1 }, /identity/],
    [{ release: { draft: true } }, /published release/],
    [{ release: { assets: [] } }, /published release/],
    [
      {
        release: {
          assets: [
            {
              name: 'ChromaShift-0.1.0-preview.13-x64-setup.exe',
              state: 'uploaded',
              size: 123,
              browser_download_url: 'https://example.com/setup.exe'
            }
          ]
        }
      },
      /published release/
    ],
    [{ downloadStatus: 404 }, /public installer/],
    [{ downloadSize: 42 }, /size/],
    [{ releases: [{ draft: false, tag_name: 'v0.1.0-preview.14' }] }, /newer published/],
    [{ package: { packageUrl: installerDownloadUrl('0.1.0-preview.14') } }, /Refusing to downgrade/]
  ]) {
    const run = fixture(options)
    await assert.rejects(submitMicrosoftStore(run), message)
    assert.deepEqual(writes(run), [])
  }
})

test('rejects incomplete and busy drafts and unexpected package configurations', async () => {
  for (const [options, message] of [
    [{ statuses: [{ isReady: false }] }, /draft is not ready/],
    [{ statuses: [{ ongoingSubmissionId: 'busy' }] }, /already in progress/],
    [{ packages: [] }, /one configured x64 EXE/],
    [{ packages: [{}, {}] }, /one configured x64 EXE/],
    [{ package: { architectures: ['Arm64'] } }, /one configured x64 EXE/],
    [{ package: { installerParameters: '' } }, /silent installer parameters/],
    [{ package: { packageUrl: 'https://example.com/setup.exe' } }, /versioned ChromaShift/]
  ]) {
    const run = fixture(options)
    await assert.rejects(submitMicrosoftStore(run), message)
    assert.deepEqual(writes(run), [])
  }
})

test('an ingestion failure or timeout never reaches submit', async () => {
  const failure = fixture({ failPath: '/packages/commit' })
  await assert.rejects(submitMicrosoftStore(failure), /Store POST \/packages\/commit failed/)
  assert.equal(
    writes(failure).some((call) => call.url.endsWith('/submit')),
    false
  )
  const timeout = fixture({
    statuses: [{}, ...Array.from({ length: 60 }, () => ({ isReady: false }))]
  })
  await assert.rejects(submitMicrosoftStore(timeout), /ingestion timed out/)
  assert.equal(timeout.waits.length, 60)
  assert.equal(
    writes(timeout).some((call) => call.url.endsWith('/submit')),
    false
  )
})

test('authentication and API failures do not echo secrets or raw responses', async () => {
  const run = fixture({ failPath: '/status' })
  await assert.rejects(submitMicrosoftStore(run), (error) => {
    assert.match(error.message, /Store GET \/status failed/)
    assert.doesNotMatch(error.message, /secret-fixture|token-fixture/)
    return true
  })
  const auth = fixture()
  const fetch = auth.fetch
  auth.fetch = (url, options) =>
    url.startsWith('https://login.microsoftonline.com/')
      ? Promise.resolve(new globalThis.Response('secret-fixture', { status: 401 }))
      : fetch(url, options)
  await assert.rejects(submitMicrosoftStore(auth), /login.microsoftonline.com failed: HTTP 401/)
})

test('release publication triggers serialized Store submission, with dry run available before enablement', async () => {
  const workflow = await readFile(
    new globalThis.URL('../.github/workflows/microsoft-store.yml', import.meta.url),
    'utf8'
  )
  assert.match(workflow, /types: \[published\]/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /MICROSOFT_STORE_ENABLED == 'true'/)
  assert.match(workflow, /inputs\.dry_run/)
  assert.match(workflow, /environment: microsoft-store/)
  assert.match(workflow, /STORE_CLIENT_SECRET: \$\{\{ secrets\.STORE_CLIENT_SECRET \}\}/)
  assert.doesNotMatch(workflow, /contents: write|id-token: write|pull_request:/)
})
