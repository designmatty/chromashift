import { execFile } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Observe the real preload selection IPC without replacing its listener or
// changing product behavior. A false conditional breakpoint records each call
// in the preload world and never pauses the application.
export async function observeProfileSelections(client) {
  await client.send('Debugger.enable')
  // Sandboxed preload wrappers can have an empty URL. Match the actual IPC
  // implementation as well as the normal compiled-file URL.
  const candidates = client.events
    .filter((event) => event.method === 'Debugger.scriptParsed')
    .map((event) => event.params)
    .sort((left, right) => Number(/preload/.test(right.url)) - Number(/preload/.test(left.url)))
  let script, scriptSource, offset
  for (const candidate of candidates) {
    const source = await client.send('Debugger.getScriptSource', { scriptId: candidate.scriptId })
    const found = source.scriptSource.indexOf('appPanelProfileSelection.publish(')
    if (found < 0) continue
    script = candidate
    scriptSource = source.scriptSource
    offset = found
    break
  }
  if (script === undefined)
    throw new Error('The preload profile-selection IPC could not be observed.')
  const before = scriptSource.slice(0, offset).split('\n')
  const contextId = script.executionContextId
  await client.send('Runtime.evaluate', {
    expression: 'globalThis.__notificationSelections = []',
    contextId
  })
  const { breakpointId } = await client.send('Debugger.setBreakpoint', {
    location: {
      scriptId: script.scriptId,
      lineNumber: before.length - 1,
      columnNumber: before.at(-1).length
    },
    condition: '(globalThis.__notificationSelections.push(request.data.profileId), false)'
  })
  return {
    async read() {
      const result = await client.send('Runtime.evaluate', {
        expression: 'globalThis.__notificationSelections',
        contextId,
        returnByValue: true
      })
      if (!Array.isArray(result.result.value))
        throw new Error('Profile-selection observation was lost.')
      return result.result.value
    },
    async stop() {
      await client.send('Debugger.removeBreakpoint', { breakpointId })
      await client.send('Runtime.evaluate', {
        expression: 'delete globalThis.__notificationSelections',
        contextId
      })
    }
  }
}

export function assertProfileSelections(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Notification profile selections were ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}.`
    )
  }
}

export async function verifyNotifications({
  client,
  settings,
  processId,
  minimize,
  waitForExpression,
  getOutput,
  delay,
  includeBodyClick = false
}) {
  const evaluate = async (expression) => {
    const response = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (response.exceptionDetails)
      throw new Error(`Notification fixture failed: ${JSON.stringify(response.exceptionDetails)}`)
    return response.result.value
  }
  // Use a disposable profile with no targets. Activation therefore restores
  // Original settings through the real queue, under the suite's native guard.
  const profile = await evaluate(`(async () => {
    await window.chromaShift.openAppPanel('profiles')
    const cancelled = await window.chromaShift.cancelPreview()
    if (!cancelled.ok) throw new Error('Could not end the previous preview')
    const state = await window.chromaShift.getState()
    if (!state.ok || state.value.chromaShift.status !== 'active') throw new Error('Notification check requires Active display control')
    const preferences = await window.chromaShift.updateSettings({ ...state.value.settings, notificationsEnabled: true })
    if (!preferences.ok) throw new Error('Could not enable product notifications')
    const created = await window.chromaShift.createProfile('Toast smoke ' + Date.now())
    if (!created.ok) throw new Error('Could not create the notification profile')
    return created.value
  })()`)
  if (typeof profile?.id !== 'string')
    throw new Error('Notification fixture did not create a profile.')
  const observer = await observeProfileSelections(client)
  try {
    await minimize(processId, true)
    await settings.enable()
    const trigger = async () => {
      const offset = getOutput().length
      const activated = await evaluate(
        `window.chromaShift.activateProfile(${JSON.stringify(profile.id)})`
      )
      if (!activated?.ok) throw new Error('Could not activate the notification profile.')
      const title = `${profile.name} activated`
      const deadline = Date.now() + 15_000
      for (;;) {
        const entries = getOutput()
          .slice(offset)
          .split('\n')
          .flatMap((line) => {
            try {
              return [JSON.parse(line)]
            } catch {
              return []
            }
          })
          .filter((entry) => entry.title === title)
        if (entries.some((entry) => entry.eventName === 'ProfileNotificationFailed')) {
          throw new Error(`Windows rejected the notification: ${JSON.stringify(entries)}`)
        }
        if (entries.some((entry) => entry.eventName === 'ProfileNotificationShown')) break
        if (Date.now() >= deadline)
          throw new Error(
            `No ProfileNotificationShown for ${title}. Check Windows notification policy and Do not disturb.`
          )
        await delay(100)
      }
      return title
    }
    const interact = async (action, title) => {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          fileURLToPath(new URL('./notification-interaction.ps1', import.meta.url)),
          '-Action',
          action,
          '-Title',
          title,
          '-AppProcessId',
          String(processId)
        ],
        { windowsHide: true, timeout: 45_000 }
      )
      globalThis.console.log(stdout.trim())
    }
    await interact('close', await trigger())
    assertProfileSelections(await observer.read(), [])
    if (includeBodyClick) {
      // Change target with delivery suppressed so the next activation is a real
      // transition with a new toast, rather than an already-selected no-op.
      await settings.suppress()
      const reset = await evaluate(`window.chromaShift.activateProfile('default')`)
      if (!reset?.ok) throw new Error('Could not reset the notification activation target.')
      await settings.enable()
      await interact('body', await trigger())
      await waitForExpression(
        client,
        `document.querySelector('[aria-label="Profile name"]')?.value === ${JSON.stringify(profile.name)} && document.visibilityState === 'visible'`,
        'The notification body did not open its related profile.'
      )
      await delay(1_000)
      assertProfileSelections(await observer.read(), [profile.id])
    }
    globalThis.console.log(
      'Notification delivery and Close passed' +
        (includeBodyClick ? '; body opened the profile exactly once.' : '.')
    )
  } finally {
    // Suppress again for shutdown; the outer guard restores the original setting.
    try {
      await settings.suppress()
    } finally {
      await observer.stop()
    }
  }
}
