import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const screenshotDirectory = join(desktopDirectory, 'out', 'smoke')
const screenshotPath = join(screenshotDirectory, 'desktop.png')
const miniScreenshotPath = join(screenshotDirectory, 'mini-panel.png')
const timeoutMilliseconds = 15_000

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function withTimeout(promise, milliseconds, description) {
  let timeout
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${description}.`)),
      milliseconds
    )
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout))
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Could not reserve a debugging port.')
  }
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return address.port
}

async function waitForDebuggerTarget(port) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((target) => target.type === 'page')
        if (page?.webSocketDebuggerUrl !== undefined) return page
      }
    } catch {
      // Electron has not opened its debugging endpoint yet.
    }
    await delay(100)
  }
  throw new Error('Electron did not expose a renderer debugging target.')
}

async function connectToDebugger(url) {
  const socket = new globalThis.WebSocket(url)
  await withTimeout(
    new Promise((resolveOpen, reject) => {
      socket.addEventListener('open', resolveOpen, { once: true })
      socket.addEventListener('error', reject, { once: true })
    }),
    timeoutMilliseconds,
    'the renderer debugger connection'
  )

  let nextId = 1
  const pending = new Map()
  const eventWaiters = new Map()
  const events = []

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id !== undefined) {
      const request = pending.get(message.id)
      if (request === undefined) return
      pending.delete(message.id)
      if (message.error !== undefined) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
      return
    }

    events.push(message)
    const waiters = eventWaiters.get(message.method) ?? []
    eventWaiters.delete(message.method)
    for (const resolveEvent of waiters) resolveEvent(message.params)
  })

  return {
    events,
    close: () => socket.close(),
    send(method, params = {}, responseTimeout = timeoutMilliseconds) {
      const id = nextId++
      const response = new Promise((resolveResponse, reject) => {
        pending.set(id, { resolve: resolveResponse, reject })
      })
      socket.send(JSON.stringify({ id, method, params }))
      return withTimeout(response, responseTimeout, method)
    },
    waitForEvent(method) {
      return withTimeout(
        new Promise((resolveEvent) => {
          const waiters = eventWaiters.get(method) ?? []
          waiters.push(resolveEvent)
          eventWaiters.set(method, waiters)
        }),
        timeoutMilliseconds,
        method
      )
    }
  }
}

async function waitForUi(debuggerClient) {
  const deadline = Date.now() + timeoutMilliseconds
  let lastSnapshot
  while (Date.now() < deadline) {
    const evaluation = await debuggerClient.send('Runtime.evaluate', {
      expression: `({
        body: document.body.innerText,
        bridgeReady: typeof window.chromaShift?.getState === 'function' &&
          typeof window.chromaShift?.requestExit === 'function',
        documentReady: document.readyState,
        title: document.title
      })`,
      returnByValue: true
    })
    const snapshot = evaluation.result.value
    lastSnapshot = snapshot
    if (snapshot.documentReady === 'complete' && snapshot.bridgeReady &&
      snapshot.body.includes('Profiles') && snapshot.body.includes('Default profile')) {
      return snapshot
    }
    await delay(100)
  }
  throw new Error(`The product UI did not finish rendering: ${JSON.stringify(lastSnapshot)}`)
}

async function waitForText(debuggerClient, text) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    const evaluation = await debuggerClient.send('Runtime.evaluate', {
      expression: `document.body.innerText.includes(${JSON.stringify(text)})`,
      returnByValue: true
    })
    if (evaluation.result.value === true) return
    await delay(100)
  }
  throw new Error(`The product UI did not render ${JSON.stringify(text)}.`)
}

async function waitForExpression(debuggerClient, expression, failureMessage) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    const evaluation = await debuggerClient.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (evaluation.result.value === true) return
    await delay(100)
  }
  throw new Error(failureMessage)
}

async function waitForExit(child) {
  if (child.exitCode !== null) return child.exitCode
  return withTimeout(
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    timeoutMilliseconds,
    'Electron to exit cleanly'
  )
}

const debuggingPort = await reservePort()
const userDataDirectory = await mkdtemp(join(tmpdir(), 'chromashift-smoke-'))
const environment = { ...globalThis.process.env }
delete environment.ELECTRON_RUN_AS_NODE

let standardOutput = ''
let standardError = ''
const electron = spawn(
  electronPath,
  [
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${userDataDirectory}`,
    '.'
  ],
  {
    cwd: desktopDirectory,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }
)
electron.stdout.setEncoding('utf8')
electron.stderr.setEncoding('utf8')
electron.stdout.on('data', (data) => { standardOutput += data })
electron.stderr.on('data', (data) => { standardError += data })

let debuggerClient
let smokeFailure
try {
  const target = await waitForDebuggerTarget(debuggingPort)
  debuggerClient = await connectToDebugger(target.webSocketDebuggerUrl)
  await debuggerClient.send('Runtime.enable')
  await debuggerClient.send('Page.enable')
  await debuggerClient.send('Log.enable')

  // Discard debugger-attachment noise from the already loaded first document;
  // the explicit reload below is the renderer/preload run under test.
  await delay(100)
  debuggerClient.events.length = 0
  const loaded = debuggerClient.waitForEvent('Page.loadEventFired')
  await debuggerClient.send('Page.reload', { ignoreCache: true })
  await loaded

  const ui = await waitForUi(debuggerClient)
  const productState = await debuggerClient.send('Runtime.evaluate', {
    expression: 'window.chromaShift.getState()',
    awaitPromise: true,
    returnByValue: true
  })
  ui.productReady = productState.result.value?.ok === true

  if (!ui.bridgeReady) throw new Error('The preload bridge was not exposed.')
  if (!ui.body.includes('ChromaShift') || !ui.body.includes('Profiles')) {
    throw new Error(`The product UI was incomplete:\n${ui.body}`)
  }
  if (!ui.productReady) throw new Error('The validated product state was unavailable.')

  const readOnlyProfile = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => ({
      hasEdit: [...document.querySelectorAll('button')]
        .some((candidate) => candidate.textContent?.trim() === 'Edit'),
      hasNameInput: document.querySelector('[aria-label="Profile name"]') !== null,
      hasColorInput: document.querySelector('.detail-section [data-slot="slider"]') !== null,
      hasColorSummary: document.querySelector('.color-summary') !== null,
      hasDisplayInput: document.querySelector('.display-option') !== null,
      hasDisplaySummary: document.querySelector('.display-summary, .read-only-empty') !== null
    }))()`,
    returnByValue: true
  })
  if (!readOnlyProfile.result.value?.hasEdit || readOnlyProfile.result.value?.hasNameInput ||
    readOnlyProfile.result.value?.hasColorInput || !readOnlyProfile.result.value?.hasColorSummary ||
    readOnlyProfile.result.value?.hasDisplayInput || !readOnlyProfile.result.value?.hasDisplaySummary) {
    throw new Error('Profile navigation did not begin with a read-only color summary.')
  }

  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Edit')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') !== null`,
    'The Default profile did not expose its name in Edit mode.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('[aria-label="Profile name"]')
      input?.focus()
      input?.select()
    })()`
  })
  await debuggerClient.send('Input.insertText', { text: 'Desktop default' })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]')?.value === 'Desktop default'`,
    'The Default profile name input did not accept keyboard text.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Cancel')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') === null &&
      document.querySelector('.detail-header h1')?.textContent === 'Default profile'`,
    'Cancel did not restore the Default profile name.'
  )

  const settingsNavigation = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim() === 'Settings')
      button?.click()
      return button !== undefined
    })()`,
    returnByValue: true
  })
  if (settingsNavigation.result.value !== true) throw new Error('Settings navigation was unavailable.')
  await waitForText(debuggerClient, 'Launch at startup')
  await waitForText(debuggerClient, 'Restore original display settings')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Profiles')?.click()`
  })
  await waitForText(debuggerClient, 'Default profile')

  const createProfile = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim() === 'New profile')
      if (button === undefined) return false
      button.click()
      return true
    })()`,
    returnByValue: true
  })
  if (createProfile.result.value !== true) throw new Error('The create-profile control was unavailable.')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') !== null`,
    'New profile did not enter Edit mode.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('[aria-label="Profile name"]')
      input?.focus()
      input?.select()
    })()`
  })
  await debuggerClient.send('Input.insertText', { text: 'Smoke profile' })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]')?.value === 'Smoke profile'`,
    'A new profile name did not accept keyboard text.'
  )

  const editControls = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const nameInput = document.querySelector('[aria-label="Profile name"]')
      const displayCheckbox = document.querySelector('.display-option [data-slot="checkbox"]')
      const brightnessCheckbox = document.querySelector('.control [data-slot="checkbox"]')
      if (nameInput === null || displayCheckbox === null || brightnessCheckbox === null) {
        return {
          ready: false,
          hasNameInput: nameInput !== null,
          hasDisplayCheckbox: displayCheckbox !== null,
          hasBrightnessCheckbox: brightnessCheckbox !== null,
          body: document.body.innerText
        }
      }
      displayCheckbox.click()
      brightnessCheckbox.click()
      return { ready: true }
    })()`,
    returnByValue: true
  })
  if (editControls.result.value?.ready !== true) {
    throw new Error(`Edit mode did not expose profile name, display, and color controls: ${JSON.stringify(editControls.result.value)}`)
  }
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' && result.value.preview.kind === 'edit'
    })()`,
    'Live edit preview did not activate.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('.control [data-slot="slider-thumb"] input[type="range"]')?.focus()`
  })
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39
  })
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.color.brightness === 51
    })()`,
    'The edit-mode brightness slider did not retain its changed value.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('.control [data-slot="checkbox"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        Object.keys(result.value.preview.color).length === 0
    })()`,
    'Removing the final color override did not restore a baseline-only preview.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('.control [data-slot="checkbox"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.color.brightness === 51
    })()`,
    'Re-enabling a color control did not restore its last defined value.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('.control [data-slot="checkbox"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        Object.keys(result.value.preview.color).length === 0
    })()`,
    'The retained color value could not be disabled again.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Save')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.preview.state !== 'inactive' ||
        result.value.activation.mode.kind !== 'automatic') return false
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      return profile?.name === 'Smoke profile' && Object.keys(profile.color).length === 0 &&
        profile.lastColorValues?.brightness === 51
    })()`,
    'Saving did not retain the disabled value and restore automatic activation.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Edit')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'edit' &&
        Object.keys(result.value.preview.color).length === 0
    })()`,
    'The saved profile could not re-enter live Edit mode for Cancel coverage.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('.control [data-slot="checkbox"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.color.brightness === 51
    })()`,
    'The applied-change Cancel check could not preview brightness.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Cancel')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.preview.state !== 'inactive' ||
        result.value.activation.mode.kind !== 'automatic') return false
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      return profile !== undefined && Object.keys(profile.color).length === 0 &&
        profile.lastColorValues?.brightness === 51 &&
        document.querySelector('.color-summary') !== null
    })()`,
    'Cancel did not roll back an applied live-edit change.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Edit')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'edit' &&
        Object.keys(result.value.preview.color).length === 0
    })()`,
    'The profile could not re-enter Edit mode for scheduled-change Cancel coverage.'
  )
  const cancelScheduledChange = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const brightnessCheckbox = document.querySelector('.control [data-slot="checkbox"]')
      if (brightnessCheckbox === null) return false
      brightnessCheckbox.click()
      await new Promise((resolve) => setTimeout(resolve, 20))
      const cancel = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim() === 'Cancel')
      cancel?.click()
      return cancel !== undefined
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (cancelScheduledChange.result.value !== true) {
    throw new Error('The Cancel control was unavailable during live Edit mode.')
  }
  await debuggerClient.send('Runtime.evaluate', {
    expression: 'new Promise((resolve) => setTimeout(resolve, 300))',
    awaitPromise: true
  })
  const cancelledState = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.preview.state !== 'inactive' ||
        result.value.activation.mode.kind !== 'automatic') return false
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      return profile !== undefined && Object.keys(profile.color).length === 0 &&
        profile.lastColorValues?.brightness === 51 &&
        document.querySelector('.color-summary') !== null &&
        document.querySelector('.detail-section [data-slot="slider"]') === null
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (cancelledState.result.value !== true) {
    throw new Error('Cancel did not discard a scheduled live-edit change and restore automatic activation.')
  }

  const createdState = await debuggerClient.send('Runtime.evaluate', {
    expression: 'window.chromaShift.getState()',
    awaitPromise: true,
    returnByValue: true
  })
  if (createdState.result.value?.value?.configuration?.profiles?.length !== 2) {
    throw new Error('The profile creation workflow did not persist a profile.')
  }

  const screenshot = await debuggerClient.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  })
  await mkdir(screenshotDirectory, { recursive: true })
  await writeFile(screenshotPath, globalThis.Buffer.from(screenshot.data, 'base64'))

  const prepareMiniPanel = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) return false
      const profile = state.value.configuration.profiles.find((item) => item.id !== 'default')
      const display = state.value.displays[0]
      if (profile === undefined || display === undefined) return false
      const saved = await window.chromaShift.saveProfile({
        ...profile,
        color: { brightness: 50 },
        displays: [{ displayId: display.id }]
      })
      if (!saved.ok) return false
      const activated = await window.chromaShift.activateProfile(profile.id)
      return activated.ok
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (prepareMiniPanel.result.value !== true) {
    throw new Error('Could not prepare a manual profile for mini-panel smoke coverage.')
  }

  await waitForExpression(
    debuggerClient,
    `document.querySelector('.color-summary > div:first-child dd')?.textContent === '50%'`,
    'The saved profile color was not rendered before explicit preview coverage.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Preview')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'preview'
    })()`,
    'The explicit profile preview did not activate.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('.profile-item')]
      .find((candidate) => candidate.querySelector('strong')?.textContent === 'Default profile')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.preview.state !== 'inactive' ||
        result.value.activation.mode.kind !== 'manual') return false
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      return profile !== undefined && result.value.activation.mode.profileId === profile.id &&
        document.querySelector('.detail-header h1')?.textContent === 'Default profile'
    })()`,
    'Navigating to another profile did not stop preview and restore manual activation.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `history.replaceState({}, '', location.pathname + '?panel=mini')`
  })
  const miniLoaded = debuggerClient.waitForEvent('Page.loadEventFired')
  await debuggerClient.send('Page.reload', { ignoreCache: true })
  await miniLoaded
  await waitForText(debuggerClient, 'Manually selected')

  const disabledMiniControl = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const checkbox = document.querySelector('.control [data-slot="checkbox"]')
      checkbox?.click()
      return checkbox !== null
    })()`,
    returnByValue: true
  })
  if (disabledMiniControl.result.value !== true) {
    throw new Error('The mini-panel color control was unavailable.')
  }
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'override' &&
        Object.keys(result.value.preview.color).length === 0 &&
        document.body.innerText.includes('Update profile') &&
        document.body.innerText.includes('Reset changes')
    })()`,
    'Disabling the final mini-panel control did not activate a baseline override.'
  )

  await debuggerClient.send('Emulation.setDeviceMetricsOverride', {
    width: 330,
    height: 388,
    deviceScaleFactor: 1,
    mobile: false
  })
  const miniScreenshot = await debuggerClient.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  })
  await writeFile(miniScreenshotPath, globalThis.Buffer.from(miniScreenshot.data, 'base64'))

  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Reset changes')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        result.value.activation.mode.kind === 'manual'
    })()`,
    'Reset changes did not restore the saved manual profile after mini-panel coverage.'
  )

  const failures = debuggerClient.events.filter((event) =>
    event.method === 'Runtime.exceptionThrown' ||
    (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
    (event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
  )
  if (failures.length > 0) {
    throw new Error(`The renderer reported ${failures.length} error event(s): ${JSON.stringify(failures)}`)
  }
  if (/preload script failed|unable to load preload/i.test(`${standardOutput}\n${standardError}`)) {
    throw new Error(`Electron reported a preload failure:\n${standardError}`)
  }

  globalThis.console.log('Desktop smoke test passed.')
  globalThis.console.log(`Renderer: ${ui.title} (${target.url})`)
  globalThis.console.log('Preload bridge: ready')
  globalThis.console.log('Native service: ready')
  globalThis.console.log(`Renderer errors: ${failures.length}`)
  globalThis.console.log(`Screenshot: ${screenshotPath}`)
  globalThis.console.log(`Mini-panel screenshot: ${miniScreenshotPath}`)
} catch (error) {
  smokeFailure = error
} finally {
  if (debuggerClient !== undefined) {
    try {
      await debuggerClient.send('Runtime.evaluate', {
        expression: 'void window.chromaShift.requestExit()'
      }, 1_000)
    } catch {
      // Restore-safe exit can tear down the debugging socket before acknowledging.
    }
    debuggerClient.close()
  }

  try {
    await waitForExit(electron)
  } catch (error) {
    electron.kill()
    smokeFailure ??= error
  }
  await rm(userDataDirectory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250
  })
}

if (smokeFailure !== undefined) {
  if (standardOutput !== '') globalThis.console.error(`Electron stdout:\n${standardOutput}`)
  if (standardError !== '') globalThis.console.error(`Electron stderr:\n${standardError}`)
  throw smokeFailure
}
