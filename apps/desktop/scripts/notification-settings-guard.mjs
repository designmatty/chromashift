import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath, URL } from 'node:url'

export const developmentNotificationId = 'com.chromashift.desktop.development'

// A separate process owns the snapshot and restores in finally when stdin
// closes, including parent death. The smoke's normal finally waits for it too.
export async function withNotificationSettings(run, start = spawn, signals = globalThis.process) {
  const child = start(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      fileURLToPath(new URL('./notification-settings-guard.ps1', import.meta.url))
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  )
  const controller = new globalThis.AbortController()
  child.stdin.on('error', (error) => controller.abort(error))
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (data) => {
    stderr += data
  })
  const lines = createInterface({ input: child.stdout })
  const replies = lines[Symbol.asyncIterator]()
  let restoring = false
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Notification setting restoration guard exited ${code}: ${stderr}`))
    )
  })
  // If suppression disappears mid-suite, stop at the next cooperative check.
  // Retain the exit failure for finally without an unhandled rejection.
  void exited.then(
    () => {
      if (!restoring) controller.abort(new Error('Notification setting guard exited during smoke.'))
    },
    (error) => controller.abort(error)
  )
  const expect = async (expected) => {
    const reply = await Promise.race([
      replies.next(),
      exited.then(() => {
        throw new Error('Notification setting guard exited before replying.')
      })
    ])
    if (reply.value !== expected)
      throw new Error(`Expected notification guard ${expected}; got ${reply.value}. ${stderr}`)
  }
  const interrupt = () =>
    controller.abort(new Error('Smoke interrupted; restoring displays and notification settings.'))
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) signals.on(signal, interrupt)
  try {
    await expect('suppressed')
    controller.signal.throwIfAborted()
    return await run({
      signal: controller.signal,
      async enable() {
        child.stdin.write('enable\n')
        await expect('enabled')
      },
      async suppress() {
        child.stdin.write('suppress\n')
        await expect('suppressed')
      }
    })
  } finally {
    restoring = true
    child.stdin.end()
    try {
      await exited
    } finally {
      lines.close()
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) signals.off(signal, interrupt)
    }
  }
}
