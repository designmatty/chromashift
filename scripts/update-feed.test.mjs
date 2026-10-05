import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildUpdateFeed } from './generate-update-feed.mjs'
import { installerDownloadUrl, updateRepositoryId } from '../apps/desktop/src/shared/app-updates.ts'

const repository = { id: updateRepositoryId, full_name: 'designmatty/chromashift' }
function release(version, extra = {}, fullName = repository.full_name) {
  const filename = `ChromaShift-${version}-x64-setup.exe`
  const prefix = new globalThis.URL('.', installerDownloadUrl(version, fullName)).toString()
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes('-'),
    assets: [filename, `${filename}.blockmap`, 'latest.yml'].map((name) => ({
      name,
      state: 'uploaded',
      size: 100,
      browser_download_url: `${prefix}${name}`
    })),
    ...extra
  }
}

test('publishes the newest complete stable and preview releases using SemVer order', () => {
  const feed = buildUpdateFeed(repository, [
    release('0.1.0-preview.9'),
    release('0.1.0-preview.10'),
    release('0.1.0'),
    release('0.2.0'),
    release('0.3.0', { prerelease: true })
  ])
  assert.deepEqual(
    feed.releases.map((entry) => entry.version),
    ['0.2.0', '0.3.0']
  )
})

test('ignores drafts, malformed releases, and incomplete or mismatched update assets', () => {
  const valid = release('0.1.0-preview.9')
  const wrongAsset = release('0.1.0-preview.13')
  wrongAsset.assets[0].browser_download_url = installerDownloadUrl(
    '0.1.0-preview.13',
    'attacker/chromashift'
  )
  const feed = buildUpdateFeed(repository, [
    valid,
    release('0.1.0-preview.10', { draft: true }),
    release('0.1.0-preview.11', { assets: valid.assets.slice(0, 1) }),
    release('0.1.0-preview.12', { tag_name: 'v0.1.0-preview.012' }),
    wrongAsset,
    { tag_name: 123 },
    null
  ])
  assert.deepEqual(
    feed.releases.map((entry) => entry.version),
    ['0.1.0-preview.9']
  )
  assert.throws(() => buildUpdateFeed(repository, []), /No complete published/)
})

test('follows a transferred or renamed repository without trusting a replacement repository', () => {
  const transferred = { id: updateRepositoryId, full_name: 'future-org/new-name' }
  const feed = buildUpdateFeed(transferred, [
    release('0.1.0-preview.10', {}, transferred.full_name)
  ])
  assert.equal(
    feed.releases[0].downloadUrl,
    installerDownloadUrl('0.1.0-preview.10', transferred.full_name)
  )
  assert.throws(() => buildUpdateFeed({ ...repository, id: 1 }, [release('0.1.0')]), /identity/)
})

test('feed deployment is isolated from website builds and triggered after release publication', async () => {
  const root = new globalThis.URL('../', import.meta.url)
  const workflow = await readFile(
    new globalThis.URL('.github/workflows/update-feed.yml', root),
    'utf8'
  )
  assert.match(workflow, /types: \[published, edited, deleted\]/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /types:.*(?:created|prereleased)/)
  assert.match(workflow, /GH_TOKEN: \$\{\{ github.token \}\}/)
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets.CLOUDFLARE_API_TOKEN \}\}/)
  const configuration = await readFile(
    new globalThis.URL('apps/updates/wrangler.jsonc', root),
    'utf8'
  )
  assert.match(configuration, /"name": "chromashift-updates"/)
  assert.match(configuration, /"pattern": "updates.chromashift.io", "custom_domain": true/)
  const headers = await readFile(new globalThis.URL('apps/updates/headers.txt', root), 'utf8')
  assert.match(headers, /Content-Type: application\/json/)
  assert.match(headers, /max-age=60, must-revalidate/)
})
