import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ciStatus, requireCiSuccess } from './require-ci-success.mjs'

const sha = 'a'.repeat(40)
const run = (status, conclusion = null) => ({ head_sha: sha, status, conclusion })

function harness(responses) {
  let clock = 0
  const calls = []
  return {
    calls,
    options: {
      repository: 'designmatty/chromashift',
      sha,
      token: 'token',
      pollMs: 20_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
      listRuns: async (...args) => {
        calls.push(args)
        return responses.length > 1 ? responses.shift() : responses[0]
      }
    }
  }
}

test('classifies CI runs for one commit', () => {
  assert.equal(ciStatus([]), 'missing')
  assert.equal(ciStatus([run('in_progress')]), 'pending')
  assert.equal(ciStatus([run('completed', 'failure')]), 'failure')
  assert.equal(ciStatus([run('completed', 'cancelled')]), 'failure')
  assert.equal(ciStatus([run('completed', 'failure'), run('queued')]), 'pending')
  assert.equal(ciStatus([run('completed', 'failure'), run('completed', 'success')]), 'success')
})

test('waits for a pending or not yet created CI run to pass', async () => {
  const { calls, options } = harness([[], [run('queued')], [run('completed', 'success')]])
  await requireCiSuccess(options)
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0], ['designmatty/chromashift', sha, 'token'])
})

test('rejects failed, missing, and unfinished CI', async () => {
  await assert.rejects(
    requireCiSuccess(harness([[run('completed', 'failure')]]).options),
    /CI did not pass on main/
  )
  await assert.rejects(requireCiSuccess(harness([[]]).options), /No CI run on main exists/)
  await assert.rejects(requireCiSuccess(harness([[run('in_progress')]]).options), /did not finish/)
})

test('rejects invalid inputs before reading runs', async () => {
  const { calls, options } = harness([[run('completed', 'success')]])
  await assert.rejects(requireCiSuccess({ ...options, sha: 'HEAD' }), /full commit SHA/)
  await assert.rejects(requireCiSuccess({ ...options, repository: 'x' }), /GITHUB_REPOSITORY/)
  await assert.rejects(requireCiSuccess({ ...options, token: '' }), /GH_TOKEN/)
  assert.equal(calls.length, 0)
})

test('the release requires passing main CI and a fresh audit before packaging', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8')
  assert.doesNotMatch(workflow, /run: npm run verify/)
  assert.match(workflow, /permissions:\s+contents: write\s+id-token: write\s+actions: read/)
  const ciCheck = workflow.indexOf('node scripts/require-ci-success.mjs')
  assert.ok(ciCheck > workflow.indexOf('npm ci'))
  assert.ok(ciCheck < workflow.indexOf('npm run package:release:prepare'))
  const audit = workflow.indexOf('run: npm run audit:dependencies')
  assert.ok(audit > workflow.indexOf('npm ci'))
  assert.ok(audit < workflow.indexOf('npm run package:release:prepare'))
})

test('CI runs canonical verification and never cancels or replaces a main run', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
  assert.match(workflow, /run: npm run verify/)
  assert.ok(
    workflow.includes(
      "group: ci-${{ github.event_name == 'pull_request' && github.ref || github.sha }}"
    )
  )
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/)
})

test('CI replaces restored workspace links without following them', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
  assert.match(workflow, /if \(\$restored\.LinkType\) \{[^}]*\[System\.IO\.Directory\]::Delete/)
  assert.match(workflow, /New-Item -ItemType Junction/)
})
