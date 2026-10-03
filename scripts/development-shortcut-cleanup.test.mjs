import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { cleanupDevelopmentShortcut } from '../apps/desktop/scripts/development-shortcut-cleanup.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = [
  { name: 'current development shortcut', appUserModelId: 'com.chromashift.desktop.development' },
  { name: 'legacy development shortcut', appUserModelId: 'com.chromashift.desktop' },
  { name: 'another app ID', appUserModelId: 'another.application', preserve: true },
  { name: 'another Electron runtime', foreignTarget: true, preserve: true },
  { name: 'an intentional app launcher', args: 'path-to-another-app', preserve: true }
]

for (const fixture of fixtures) {
  test(
    `development runner cleanup handles ${fixture.name}`,
    { skip: globalThis.process.platform !== 'win32' },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'chromashift-shortcut-test-'))
      const previousAppData = globalThis.process.env.APPDATA
      try {
        const shortcutDirectory = join(directory, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        const shortcutPath = join(shortcutDirectory, 'Electron.lnk')
        await mkdir(shortcutDirectory, { recursive: true })
        const details = {
          target: fixture.foreignTarget ? join(directory, 'other-electron.exe') : electronPath,
          args: fixture.args ?? '',
          appUserModelId: fixture.appUserModelId ?? 'com.chromashift.desktop.development'
        }
        const fixturePath = join(directory, 'write-shortcut.cjs')
        await writeFile(
          fixturePath,
          `
const { app, shell } = require('electron')
app.whenReady().then(() => {
  const created = shell.writeShortcutLink(${JSON.stringify(shortcutPath)}, ${JSON.stringify(details)})
  app.exit(created ? 0 : 1)
})
`
        )
        const environment = { ...globalThis.process.env }
        delete environment.ELECTRON_RUN_AS_NODE
        const result = spawnSync(electronPath, [fixturePath], {
          cwd: repositoryRoot,
          env: environment,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10_000
        })
        assert.equal(result.status, 0, result.stderr)
        await access(shortcutPath)
        globalThis.process.env.APPDATA = directory
        cleanupDevelopmentShortcut(electronPath)
        if (fixture.preserve) await access(shortcutPath)
        else await assert.rejects(access(shortcutPath), { code: 'ENOENT' })
      } finally {
        if (previousAppData === undefined) delete globalThis.process.env.APPDATA
        else globalThis.process.env.APPDATA = previousAppData
        await rm(directory, { recursive: true, force: true })
      }
    }
  )
}
