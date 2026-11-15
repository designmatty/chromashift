import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { URL } from 'node:url'
import { withNotificationSettings } from '../apps/desktop/scripts/notification-settings-guard.mjs'
import {
  assertCloseAction,
  verifyNotifications
} from '../apps/desktop/scripts/notifications-smoke.mjs'

const toastXml =
  '<toast><actions><action content="Close" activationType="foreground" arguments="type=action&amp;action=0&amp;tag=unique&amp;chromashift=notification-v1&amp;profile=smoke" /></actions></toast>'

test('notification assertion requires the supplied dismiss-only Close action', () => {
  assertCloseAction(toastXml)
  for (const invalid of [
    undefined,
    '',
    toastXml.replace('Close', 'Open'),
    toastXml.replace('action=0', 'action=1'),
    toastXml.replace('foreground', 'system'),
    toastXml.replace('notification-v1', 'unknown'),
    toastXml + toastXml
  ])
    assert.throws(() => assertCloseAction(invalid), /Close action/)
})

function notificationFixture({ failure, xml = toastXml } = {}) {
  const calls = []
  let output =
    JSON.stringify({ eventName: 'ProfileNotificationShown', title: 'old activated' }) + '\n'
  const options = {
    client: {
      async send(method, { expression }) {
        assert.equal(method, 'Runtime.evaluate')
        if (expression.startsWith('(async')) {
          calls.push('fixture')
          return { result: { value: { id: 'smoke', name: 'Toast smoke' } } }
        }
        assert.equal(expression, 'window.chromaShift.activateProfile("smoke")')
        calls.push('activate')
        if (failure === 'activation') return { result: { value: { ok: false } } }
        // Shown for a different title cannot satisfy the assertion. A request
        // for this title alone cannot satisfy it either.
        output +=
          JSON.stringify({
            eventName: 'ProfileNotificationShown',
            title: 'other activated',
            toastXml
          }) + '\n'
        output +=
          JSON.stringify({
            eventName: 'ProfileNotificationRequested',
            title: 'Toast smoke activated'
          }) + '\n'
        return { result: { value: { ok: true } } }
      }
    },
    settings: {
      async enable() {
        calls.push('enable')
      },
      async suppress() {
        calls.push('suppress')
      }
    },
    processId: 42,
    async minimize(pid, minimized) {
      assert.equal(pid, 42)
      assert.equal(minimized, true)
      calls.push('minimize')
    },
    getOutput: () => output,
    async delay() {
      calls.push('wait')
      output +=
        JSON.stringify({
          eventName:
            failure === 'delivery' ? 'ProfileNotificationFailed' : 'ProfileNotificationShown',
          title: 'Toast smoke activated',
          toastXml: xml
        }) + '\n'
    }
  }
  return { calls, options }
}

test('notification check enables once, triggers one toast, waits for its Shown XML, then suppresses', async () => {
  const fixture = notificationFixture()
  await verifyNotifications(fixture.options)
  assert.deepEqual(fixture.calls, ['fixture', 'minimize', 'enable', 'activate', 'wait', 'suppress'])
})

for (const [failure, xml, message] of [
  ['activation', toastXml, /Could not activate/],
  ['delivery', toastXml, /Windows rejected/],
  [undefined, undefined, /Close action/]
]) {
  test(`notification check suppresses again after failure: ${message}`, async () => {
    const fixture = notificationFixture({ failure, xml: xml ?? '' })
    await assert.rejects(verifyNotifications(fixture.options), message)
    assert.equal(fixture.calls.at(-1), 'suppress')
  })
}

function fakeGuard({ restoreCode = 0, startupFailure = false } = {}) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough()
  })
  const commands = []
  child.stdin.on('data', (data) => {
    const command = String(data).trim()
    commands.push(command)
    child.stdout.write(command === 'enable' ? 'enabled\n' : 'suppressed\n')
  })
  child.stdin.on('finish', () => {
    commands.push('restore')
    child.stdout.end()
    child.emit('exit', restoreCode)
  })
  const start = (...args) => {
    assert.equal(args[0], 'powershell.exe')
    assert.equal(args[2].windowsHide, true)
    globalThis.queueMicrotask(() => {
      if (startupFailure) child.emit('error', new Error('guard failed to start'))
      else child.stdout.write('suppressed\n')
    })
    return child
  }
  return { start, child, commands, signals: new EventEmitter() }
}

test('notification setting guard suppresses before launch and restores after enable/suppress', async () => {
  const guard = fakeGuard()
  const result = await withNotificationSettings(
    async (settings) => {
      assert.deepEqual(guard.commands, [])
      await settings.enable()
      await settings.suppress()
      return 'passed'
    },
    guard.start,
    guard.signals
  )
  assert.equal(result, 'passed')
  assert.deepEqual(guard.commands, ['enable', 'suppress', 'restore'])
  assert.equal(guard.signals.listenerCount('SIGINT'), 0)
})

test('notification setting restores after an assertion or launch failure', async () => {
  const guard = fakeGuard()
  await assert.rejects(
    withNotificationSettings(
      async () => {
        throw new Error('assertion failed')
      },
      guard.start,
      guard.signals
    ),
    /assertion failed/
  )
  assert.deepEqual(guard.commands, ['restore'])
  const failed = fakeGuard({ startupFailure: true })
  await assert.rejects(
    withNotificationSettings(() => assert.fail('must not launch'), failed.start, failed.signals),
    /failed to start/
  )
  assert.equal(failed.signals.listenerCount('SIGINT'), 0)
})

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`${signal} cancels smoke work and restores the notification setting`, async () => {
    const guard = fakeGuard()
    await assert.rejects(
      withNotificationSettings(
        async (settings) => {
          await settings.enable()
          guard.signals.emit(signal)
          settings.signal.throwIfAborted()
          assert.fail('work must stop')
        },
        guard.start,
        guard.signals
      ),
      /Smoke interrupted/
    )
    assert.deepEqual(guard.commands, ['enable', 'restore'])
    assert.equal(guard.signals.listenerCount(signal), 0)
  })
}

test('a failed setting restore fails the command even after successful smoke', async () => {
  const guard = fakeGuard({ restoreCode: 1 })
  await assert.rejects(
    withNotificationSettings(async () => {}, guard.start, guard.signals),
    /restoration guard exited 1/
  )
})

test('loss of the setting guard cancels in-progress smoke work', async () => {
  const guard = fakeGuard()
  await assert.rejects(
    withNotificationSettings(
      async (settings) => {
        guard.child.emit('exit', 1)
        await Promise.resolve()
        assert.equal(settings.signal.aborted, true)
        settings.signal.throwIfAborted()
      },
      guard.start,
      guard.signals
    ),
    /restoration guard exited 1/
  )
})

test('Windows guard scopes the setting and preserves value absence, type, and other values', () => {
  const source = readFileSync(
    new URL('../apps/desktop/scripts/notification-settings-guard.ps1', import.meta.url),
    'utf8'
  )
  assert.match(source, /Settings\\com\.chromashift\.desktop\.development'/)
  assert.match(source, /GetValueKind\('Enabled'\)/)
  assert.match(source, /SetValue\('Enabled', \$value, \$kind\)/)
  assert.match(source, /DeleteValue\('Enabled', \$false\)/)
  assert.match(source, /ValueCount -eq 0 -and \$key.SubKeyCount -eq 0/)
  assert.match(source, /finally/)
  assert.doesNotMatch(source, /Remove-Item|DeleteSubKeyTree/)
})
