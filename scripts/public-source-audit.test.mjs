import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const auditScript = resolve(
  fileURLToPath(new globalThis.URL('./public-source-audit.mjs', import.meta.url))
)

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

async function repository() {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-public-audit-'))
  run('git', ['init', '--initial-branch=main'], directory)
  run('git', ['config', 'user.name', 'Audit Test'], directory)
  run('git', ['config', 'user.email', 'audit@example.com'], directory)
  return directory
}

async function commit(directory, path, contents, message) {
  await writeFile(join(directory, path), contents, 'utf8')
  run('git', ['add', path], directory)
  run('git', ['commit', '-m', message], directory)
}

function audit(directory) {
  return spawnSync(globalThis.process.execPath, [auditScript, '--repository', directory], {
    cwd: directory,
    encoding: 'utf8'
  })
}

test('passes a clean repository without treating author metadata as private material', async () => {
  const directory = await repository()
  await commit(directory, 'README.md', '# Example\n', 'Initial commit')

  const result = audit(directory)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Public-source audit passed:/)
})

test('fails when a credential remains in a deleted historical blob', async () => {
  const directory = await repository()
  await commit(
    directory,
    'old-config.txt',
    `token=${'github_' + 'pat_'}1234567890abcdefghijklmnopqrstuvwxyz\n`,
    'Add old configuration'
  )
  run('git', ['rm', 'old-config.txt'], directory)
  run('git', ['commit', '-m', 'Delete old configuration'], directory)

  const result = audit(directory)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /GitHub personal access token/)
  assert.match(result.stderr, /old-config\.txt/)
  assert.doesNotMatch(result.stderr, /github_pat_1234567890/)
})

test('fails when a credential file is tracked', async () => {
  const directory = await repository()
  await commit(directory, '.env.production', 'APP_MODE=production\n', 'Add production environment')

  const result = audit(directory)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /credential-bearing filename/)
  assert.match(result.stderr, /\.env\.production/)
})

test('allows the documented placeholder environment file', async () => {
  const directory = await repository()
  await commit(
    directory,
    '.env.example',
    'WIN_CSC_LINK=C:\\path\\to\\certificate.pfx\nWIN_CSC_KEY_PASSWORD=replace-with-secret\n',
    'Document signing variables'
  )

  const result = audit(directory)

  assert.equal(result.status, 0, result.stderr)
})

test('scans credentials after NUL bytes in a historical binary blob', async () => {
  const directory = await repository()
  await commit(
    directory,
    'binary.dat',
    `\0payload=${'github_' + 'pat_'}1234567890abcdefghijklmnopqrstuvwxyz\n`,
    'Add binary data'
  )

  const result = audit(directory)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /GitHub personal access token/)
  assert.match(result.stderr, /binary\.dat/)
})

test('scans credentials in blobs larger than two MiB', async () => {
  const directory = await repository()
  const padding = 'x'.repeat(2 * 1024 * 1024 + 1)
  await commit(
    directory,
    'large.txt',
    `${padding}${'github_' + 'pat_'}1234567890abcdefghijklmnopqrstuvwxyz\n`,
    'Add large data'
  )

  const result = audit(directory)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /GitHub personal access token/)
  assert.match(result.stderr, /large\.txt/)
})

test('audits a detached HEAD even when no branch points to it', async () => {
  const directory = await repository()
  await commit(
    directory,
    'detached.txt',
    `token=${'github_' + 'pat_'}1234567890abcdefghijklmnopqrstuvwxyz\n`,
    'Add detached data'
  )
  run('git', ['checkout', '--detach'], directory)
  run('git', ['branch', '-D', 'main'], directory)

  const result = audit(directory)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /GitHub personal access token/)
  assert.match(result.stderr, /detached\.txt/)
})

for (const [article, keyType] of [
  ['an', 'ENCRYPTED'],
  ['a', 'DSA']
]) {
  test(`detects ${article} ${keyType.toLowerCase()} private key`, async () => {
    const directory = await repository()
    await commit(
      directory,
      'backup.pem',
      `${'-----BEGIN '}${keyType} PRIVATE KEY-----\nsynthetic-test-value\n`,
      `Add ${keyType.toLowerCase()} key fixture`
    )

    const result = audit(directory)

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /private key/)
    assert.match(result.stderr, /backup\.pem/)
  })
}
