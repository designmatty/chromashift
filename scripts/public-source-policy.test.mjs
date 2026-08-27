import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const repositoryRoot = resolve(import.meta.dirname, '..')

async function text(path) {
  return readFile(resolve(repositoryRoot, path), 'utf8')
}

test('publishes the approved MIT attribution', async () => {
  const license = await text('LICENSE')

  assert.match(license, /^MIT License$/m)
  assert.match(license, /Copyright \(c\) 2026 ChromaShift contributors/)
})

test('states the production privacy boundary and local data', async () => {
  const privacy = await text('PRIVACY.md')

  assert.match(privacy, /no telemetry, analytics, or outbound network\s+requests/i)
  for (const filename of [
    'profiles.json',
    'preferences.json',
    'window-state.json',
    'chroma-shift.json',
    'logs/main.jsonl'
  ]) {
    assert.match(privacy, new RegExp(filename.replace('.', '\\.')))
  }
})

test('limits security support without promising a response deadline', async () => {
  const security = await text('SECURITY.md')

  assert.match(security, /only the latest release/i)
  assert.match(security, /private vulnerability report/i)
  assert.match(security, /does not come with a response or resolution deadline/i)
})

test('permits contributions without soliciting them or requiring a CLA', async () => {
  const contributing = await text('CONTRIBUTING.md')

  assert.match(contributing, /Issues and pull requests are permitted/)
  assert.match(contributing, /not required to sign a Contributor License Agreement/)
  assert.match(contributing, /no promise of review,\s+acceptance, response, or support/)
})

test('the public overview distinguishes verified NVIDIA behavior from AMD support', async () => {
  const readme = await text('README.md')

  assert.match(readme, /NVIDIA behavior has been verified on real hardware/)
  assert.match(readme, /AMD.*hardware-unverified/s)
})
