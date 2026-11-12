import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { URL } from 'node:url'
import { withNotificationSettings } from '../apps/desktop/scripts/notification-settings-guard.mjs'
import {
  assertProfileSelections,
  observeProfileSelections
} from '../apps/desktop/scripts/notifications-smoke.mjs'

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

for (const url of ['file:///app/out/preload/index.cjs', '']) {
  test(`preload observation counts selections without replacing the listener, URL ${JSON.stringify(url)}`, async () => {
    const scriptSource = `ipcRenderer.on(channel, (_event, input) => {
    const request = schema.safeParse(input)
    if (request.success) appPanelProfileSelection.publish(request.data.profileId)
  })`
    const context = { globalThis: {}, request: { data: { profileId: 'gaming' } } }
    let condition
    let removed = false
    const client = {
      events: [
        {
          method: 'Debugger.scriptParsed',
          params: {
            url,
            scriptId: '42',
            executionContextId: 7
          }
        }
      ],
      async send(method, parameters) {
        if (method === 'Debugger.getScriptSource') return { scriptSource }
        if (method === 'Debugger.setBreakpoint') {
          condition = parameters.condition
          assert.equal(parameters.location.lineNumber, 2)
          return { breakpointId: 'observed' }
        }
        if (method === 'Runtime.evaluate') {
          assert.equal(parameters.contextId, 7)
          return { result: { value: runInNewContext(parameters.expression, context) } }
        }
        if (method === 'Debugger.removeBreakpoint') removed = true
        return {}
      }
    }
    const observer = await observeProfileSelections(client)
    assertProfileSelections(await observer.read(), [])
    assert.equal(runInNewContext(condition, context), false)
    assertProfileSelections(await observer.read(), ['gaming'])
    assert.equal(runInNewContext(condition, context), false)
    assert.throws(
      () => assertProfileSelections(context.globalThis.__notificationSelections, ['gaming']),
      /Notification profile selections/
    )
    await observer.stop()
    assert.equal(removed, true)
  })
}

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
