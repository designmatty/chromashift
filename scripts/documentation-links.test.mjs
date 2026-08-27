import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

const repositoryRoot = resolve(import.meta.dirname, '..')
const ignoredDirectories = new Set(['.git', 'node_modules', 'out', 'release', 'bin', 'obj'])

async function markdownFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await markdownFiles(join(directory, entry.name))))
      }
    } else if (entry.name.endsWith('.md')) {
      files.push(join(directory, entry.name))
    }
  }
  return files
}

function localTargets(contents) {
  const targets = []
  for (const match of contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) targets.push(match[1])
  for (const match of contents.matchAll(/`([^`\r\n]+\.md)`/g)) targets.push(match[1])
  return targets
}

function resolveTarget(source, target) {
  const path = decodeURIComponent(target.split('#', 1)[0].split('?', 1)[0])
  if (
    path.startsWith('docs/') ||
    path.startsWith('.agents/') ||
    [
      'AGENTS.md',
      'CONTEXT.md',
      'README.md',
      'PRIVACY.md',
      'SECURITY.md',
      'CONTRIBUTING.md'
    ].includes(path)
  ) {
    return resolve(repositoryRoot, path)
  }
  return resolve(dirname(source), path)
}

test('all local Markdown links and instruction pointers resolve', async () => {
  const failures = []
  for (const source of await markdownFiles(repositoryRoot)) {
    const contents = await readFile(source, 'utf8')
    for (const target of localTargets(contents)) {
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue
      const destination = resolveTarget(source, target)
      try {
        await access(destination)
      } catch {
        failures.push(`${source.slice(repositoryRoot.length + 1)} -> ${target}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})
