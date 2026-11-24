import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The release workflow builds from a tag instead of repeating `npm run verify`.
// It requires the canonical CI workflow to have passed on main for the exact
// tagged commit, which also proves the commit was pushed to main.

const ciWorkflow = 'ci.yml'
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const shaPattern = /^[0-9a-f]{40}$/

/**
 * Classifies the CI runs for one commit. Any successful run is enough, so a
 * re-run after a flaky failure counts. Pending work wins over failures because a
 * re-run may still pass.
 */
export function ciStatus(runs) {
  if (runs.some((run) => run.status === 'completed' && run.conclusion === 'success'))
    return 'success'
  if (runs.some((run) => run.status !== 'completed')) return 'pending'
  if (runs.length > 0) return 'failure'
  return 'missing'
}

async function ciRuns(repository, sha, token) {
  const query = new globalThis.URLSearchParams({
    head_sha: sha,
    event: 'push',
    branch: 'main',
    per_page: '100'
  })
  const response = await globalThis.fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/${ciWorkflow}/runs?${query}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'ChromaShift-release',
        Authorization: `Bearer ${token}`
      },
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(30_000)
    }
  )
  if (!response.ok)
    throw new Error(`GitHub workflow run request failed with HTTP ${response.status}.`)
  const body = await response.json()
  if (!Array.isArray(body.workflow_runs)) throw new Error('GitHub returned an invalid run list.')
  return body.workflow_runs.filter((run) => run.head_sha === sha)
}

export async function requireCiSuccess({
  repository,
  sha,
  token,
  listRuns = ciRuns,
  sleep = (ms) => new Promise((done) => globalThis.setTimeout(done, ms)),
  now = () => globalThis.Date.now(),
  pollMs = 20_000,
  missingTimeoutMs = 3 * 60_000,
  timeoutMs = 30 * 60_000
}) {
  if (!repositoryPattern.test(repository ?? '')) throw new Error('GITHUB_REPOSITORY is invalid.')
  if (!shaPattern.test(sha ?? '')) throw new Error('RELEASE_COMMIT is not a full commit SHA.')
  if (!token) throw new Error('GH_TOKEN is required to read CI runs.')
  const started = now()
  for (;;) {
    const status = ciStatus(await listRuns(repository, sha, token))
    if (status === 'success') return
    if (status === 'failure')
      throw new Error(
        `CI did not pass on main for ${sha}. Re-run CI for that commit, then re-run this release.`
      )
    const waited = now() - started
    if (status === 'missing' && waited >= missingTimeoutMs)
      throw new Error(
        `No CI run on main exists for ${sha}. Tag a commit that was pushed to main and ran CI.`
      )
    if (waited >= timeoutMs) throw new Error(`CI on main for ${sha} did not finish in time.`)
    await sleep(pollMs)
  }
}

if (
  globalThis.process.argv[1] &&
  resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { GITHUB_REPOSITORY, RELEASE_COMMIT, GH_TOKEN } = globalThis.process.env
  await requireCiSuccess({ repository: GITHUB_REPOSITORY, sha: RELEASE_COMMIT, token: GH_TOKEN })
  globalThis.console.log(`CI passed on main for ${RELEASE_COMMIT}.`)
}
