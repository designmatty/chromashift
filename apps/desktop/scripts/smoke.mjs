import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import electronPath from 'electron'
import { NativeClient } from '@chromashift/native-client'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const screenshotDirectory = join(desktopDirectory, 'out', 'smoke')
const screenshotPath = join(screenshotDirectory, 'desktop.png')
const miniScreenshotPath = join(screenshotDirectory, 'mini-panel.png')
const settingsScreenshotPath = join(screenshotDirectory, 'settings.png')
const settingsSelectScreenshotPath = join(screenshotDirectory, 'settings-select.png')
const displaysScreenshotPath = join(screenshotDirectory, 'displays.png')
const aboutScreenshotPath = join(screenshotDirectory, 'about.png')
const deleteDialogScreenshotPath = join(screenshotDirectory, 'delete-profile-dialog.png')
const miniPickerScreenshotPath = join(screenshotDirectory, 'mini-picker.png')
const miniDefaultScreenshotPath = join(screenshotDirectory, 'mini-default-restored.png')
const displayServicePath = resolve(
  desktopDirectory,
  '../../native/DisplayService/bin/Debug/net10.0-windows/DisplayService.exe'
)
const timeoutMilliseconds = 15_000
const execFileAsync = promisify(execFile)

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
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose()))
  )
  return address.port
}

async function waitForDebuggerTarget(port, matches = () => true) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((target) => target.type === 'page' && matches(target))
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
    if (
      snapshot.documentReady === 'complete' &&
      snapshot.bridgeReady &&
      snapshot.body.includes('Profiles') &&
      snapshot.body.includes('Default profile')
    ) {
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

async function captureScreenshot(debuggerClient, path) {
  const screenshot = await debuggerClient.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  })
  await mkdir(screenshotDirectory, { recursive: true })
  await writeFile(path, globalThis.Buffer.from(screenshot.data, 'base64'))
}

async function verifyTooltipMenuTrigger(debuggerClient, triggerLabel, menuItemText) {
  await debuggerClient.send('Page.bringToFront')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      window.focus()
      document.activeElement instanceof HTMLElement && document.activeElement.blur()
    })()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="tooltip"]') === null`,
    `The previous tooltip did not close before checking ${triggerLabel}.`
  )
  const focused = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const trigger = document.querySelector(${JSON.stringify(`[aria-label="${triggerLabel}"]`)})
      if (!(trigger instanceof HTMLElement)) return null
      trigger.focus()
      return {
        focused: document.activeElement === trigger,
        id: trigger.id,
        menu: trigger.getAttribute('aria-haspopup')
      }
    })()`,
    returnByValue: true
  })
  if (
    focused.result.value?.focused !== true ||
    focused.result.value?.id === '' ||
    focused.result.value?.menu !== 'menu'
  ) {
    throw new Error(
      `${triggerLabel} did not compose the Tooltip and Menu triggers: ${JSON.stringify(focused.result.value)}`
    )
  }

  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[role="tooltip"]')]
      .some((candidate) => candidate.textContent?.trim() === ${JSON.stringify(triggerLabel)})`,
    `${triggerLabel} did not open its Chakra tooltip on focus.`
  )

  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13
  })
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13
  })
  await waitForExpression(
    debuggerClient,
    `(() => {
      const trigger = document.querySelector(${JSON.stringify(`[aria-label="${triggerLabel}"]`)})
      return trigger?.getAttribute('aria-expanded') === 'true' &&
        [...document.querySelectorAll('[role="menuitem"]')]
          .some((candidate) => candidate.textContent?.trim() === ${JSON.stringify(menuItemText)})
    })()`,
    `${triggerLabel} did not open its Chakra menu after showing its tooltip.`
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')]
        .find((candidate) => candidate.getClientRects().length > 0)
      if (!(item instanceof HTMLElement)) return false
      item.focus()
      item.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
      }))
      item.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
      }))
      return true
    })()`
  })
  // DOM focus plus trusted CDP input keeps this deterministic even when the
  // automation host briefly takes foreground ownership from Electron.
  await debuggerClient.send('Page.bringToFront')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `([...document.querySelectorAll('[role="menuitem"]')]
      .find((candidate) => candidate.getClientRects().length > 0))?.focus()`
  })
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27
  })
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27
  })
  await delay(250)
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 520,
    y: 540,
    button: 'left',
    clickCount: 1
  })
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 520,
    y: 540,
    button: 'left',
    clickCount: 1
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector(${JSON.stringify(`[aria-label="${triggerLabel}"]`)})
      ?.getAttribute('aria-expanded') !== 'true'`,
    `${triggerLabel} menu did not close after keyboard/trigger dismissal.`
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(`[aria-label="${triggerLabel}"]`)})?.blur()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="tooltip"]') === null`,
    `${triggerLabel} tooltip did not close after the trigger lost focus.`
  )
}

async function selectMenuItem(debuggerClient, triggerLabel, itemText) {
  const opened = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const trigger = document.querySelector(${JSON.stringify(`[aria-label="${triggerLabel}"]`)})
      if (!(trigger instanceof HTMLElement)) return false
      trigger.click()
      return true
    })()`,
    returnByValue: true
  })
  if (opened.result.value !== true) throw new Error(`${triggerLabel} was unavailable.`)
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[role="menuitem"]')]
      .some((candidate) => candidate.getClientRects().length > 0 &&
        candidate.textContent?.trim() === ${JSON.stringify(itemText)})`,
    `${triggerLabel} did not show ${itemText}.`
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[role="menuitem"]')]
      .find((candidate) => candidate.getClientRects().length > 0 &&
        candidate.textContent?.trim() === ${JSON.stringify(itemText)})?.click()`
  })
}

async function selectProfileMenuItem(debuggerClient, profileName, itemText) {
  await debuggerClient.send('Page.bringToFront')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const expanded = document.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')
      if (!(expanded instanceof HTMLElement)) return
      expanded.focus()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      expanded.click()
    })()`,
    awaitPromise: true
  })
  const opened = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const row = [...document.querySelectorAll('[data-part="profile-item"]')]
        .find((candidate) =>
          candidate.querySelector('[data-part="profile-select"] strong')?.textContent?.trim() ===
            ${JSON.stringify(profileName)}
        )
      const trigger = row?.querySelector('[aria-label="Profile actions"]')
      if (!(trigger instanceof HTMLElement)) return false
      trigger.focus()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      trigger.click()
      return true
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (opened.result.value !== true) {
    throw new Error(`${profileName} profile actions were unavailable.`)
  }
  await waitForExpression(
    debuggerClient,
    `(() => {
      const content = document.querySelector('[data-scope="menu"][data-part="content"][data-state="open"]')
      return [...(content?.querySelectorAll('[role="menuitem"]') ?? [])]
        .some((candidate) => candidate.textContent?.trim() === ${JSON.stringify(itemText)})
    })()`,
    `${profileName} profile actions did not show ${itemText}.`
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const content = document.querySelector('[data-scope="menu"][data-part="content"][data-state="open"]')
      return [...(content?.querySelectorAll('[role="menuitem"]') ?? [])]
        .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(itemText)})?.click()
    })()`
  })
}

async function hoverElement(debuggerClient, selector) {
  const center = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) return null
      const bounds = element.getBoundingClientRect()
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    })()`,
    returnByValue: true
  })
  if (center.result.value === null) throw new Error(`${selector} was unavailable for hover.`)
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: center.result.value.x,
    y: center.result.value.y
  })
}

function displayStateFingerprint(state) {
  return JSON.stringify(state)
}

async function waitForRestoredDisplayState(native, displayId, expectedFingerprint) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    const state = await native.getDisplayState(displayId)
    if (displayStateFingerprint(state) === expectedFingerprint) return state
    await delay(100)
  }
  return native.getDisplayState(displayId)
}

async function waitForExit(child) {
  if (child.exitCode !== null) return child.exitCode
  return withTimeout(
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    timeoutMilliseconds,
    'Electron to exit cleanly'
  )
}

async function closeMainWindow(processId) {
  const source = `
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public static class NativeWindowCloser {
      private delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);
      [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
      [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
      [DllImport("user32.dll")] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
      [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
      [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
      public static bool CloseVisibleWindow(uint processId) {
        IntPtr target = IntPtr.Zero;
        EnumWindows((handle, parameter) => {
          uint owner;
          GetWindowThreadProcessId(handle, out owner);
          if (owner != processId || !IsWindowVisible(handle)) return true;
          var title = new StringBuilder(256);
          GetWindowText(handle, title, title.Capacity);
          if (title.ToString() != "ChromaShift") return true;
          target = handle;
          return false;
        }, IntPtr.Zero);
        return target != IntPtr.Zero && PostMessage(target, 0x0010, IntPtr.Zero, IntPtr.Zero);
      }
    }
  `
  const command = `Add-Type -TypeDefinition @'
${source}
'@
[NativeWindowCloser]::CloseVisibleWindow(${processId})`
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      globalThis.Buffer.from(command, 'utf16le').toString('base64')
    ],
    { windowsHide: true }
  )
  if (stdout.trim().toLowerCase() !== 'true') {
    throw new Error('Windows did not accept the native app-panel close request.')
  }
}

async function killChildDisplayService(parentProcessId) {
  const command = `$service = Get-CimInstance Win32_Process | Where-Object {
  $_.ParentProcessId -eq ${parentProcessId} -and $_.Name -eq 'DisplayService.exe'
} | Select-Object -First 1
if ($null -eq $service) { throw 'DisplayService child was not found.' }
$processId = [int]$service.ProcessId
Stop-Process -Id $processId -Force
$processId`
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      globalThis.Buffer.from(command, 'utf16le').toString('base64')
    ],
    { windowsHide: true }
  )
  const processId = Number.parseInt(stdout.trim(), 10)
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error(`DisplayService kill returned an invalid process ID: ${stdout}`)
  }
  return processId
}

const debuggingPort = await reservePort()
const userDataDirectory = await mkdtemp(join(tmpdir(), 'chromashift-smoke-'))
const environment = { ...globalThis.process.env }
delete environment.ELECTRON_RUN_AS_NODE
const forceElectronTermination = globalThis.process.argv.includes('--force-exit')
const testNativeRecovery = globalThis.process.argv.includes('--native-recovery')

// Keep a second native service alive as a restoration guard. It captures the
// real pre-smoke state and lets this test verify what remains on the display
// after Electron has fully exited. The guard restores its own baseline in the
// final cleanup even when the assertion fails.
const restorationGuard = new NativeClient({ executablePath: displayServicePath })
await restorationGuard.start()
const guardDisplays = await restorationGuard.getDisplays()
const guardGroups = new Map()
for (const display of guardDisplays) {
  const id = display.physicalId ?? display.id
  const group = guardGroups.get(id) ?? []
  group.push(display)
  guardGroups.set(id, group)
}
let guardedDisplays
for (const group of [...guardGroups.values()].sort((left, right) => right.length - left.length)) {
  const reports = await Promise.all(
    group.map((display) => restorationGuard.getDisplayCapabilityReport(display.id))
  )
  if (
    group.every((display) => !display.hdr) &&
    reports.every((report) => report.capabilities.brightness.supported)
  ) {
    guardedDisplays = group
    break
  }
}
if (guardedDisplays === undefined) {
  await restorationGuard.stop()
  throw new Error('The restoration guard found no SDR display with brightness support.')
}
const guardedDisplay = guardedDisplays[0]
const guardedBaselines = new Map()
for (const display of guardedDisplays) {
  const baseline = await restorationGuard.getDisplayState(display.id)
  guardedBaselines.set(display.id, displayStateFingerprint(baseline))
  await restorationGuard.captureBaseline(display.id)
}
const guardedProductDisplayId = guardedDisplay.physicalId ?? guardedDisplay.id
const guardedDisplayRowSelector = `[data-part="display-control"][data-display-id="${guardedProductDisplayId}"]`

let standardOutput = ''
let standardError = ''
const electron = spawn(
  electronPath,
  [`--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${userDataDirectory}`, '.'],
  {
    cwd: desktopDirectory,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }
)
electron.stdout.setEncoding('utf8')
electron.stderr.setEncoding('utf8')
electron.stdout.on('data', (data) => {
  standardOutput += data
})
electron.stderr.on('data', (data) => {
  standardError += data
})

let debuggerClient
let smokeFailure
try {
  const target = await waitForDebuggerTarget(
    debuggingPort,
    (candidate) => !candidate.url.includes('panel=mini')
  )
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

  if (testNativeRecovery) {
    const killedProcessId = await killChildDisplayService(electron.pid)
    const deadline = Date.now() + timeoutMilliseconds
    while (!standardOutput.includes('"eventName":"NativeServiceRecovered"')) {
      if (Date.now() >= deadline) {
        throw new Error(`DisplayService ${killedProcessId} did not complete bounded recovery.`)
      }
      await delay(100)
    }
    await waitForExpression(
      debuggerClient,
      `(async () => {
        const result = await window.chromaShift.getState()
        return result.ok && result.value.displays.length > 0
      })()`,
      'Product state did not recover after the baseline-free DisplayService crash.'
    )
  }

  const miniPanelOpened = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => (await window.chromaShift.showMiniPanel()).ok)()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (miniPanelOpened.result.value !== true) {
    throw new Error('The app panel could not open the real mini-panel window.')
  }
  await waitForExpression(
    debuggerClient,
    `document.visibilityState === 'hidden'`,
    'Opening the mini panel did not hide the app panel.'
  )
  const miniTarget = await waitForDebuggerTarget(debuggingPort, (candidate) =>
    candidate.url.includes('panel=mini')
  )
  const miniDebugger = await connectToDebugger(miniTarget.webSocketDebuggerUrl)
  await miniDebugger.send('Runtime.enable')
  await miniDebugger.send('Page.enable')
  await miniDebugger.send('Log.enable')
  await waitForText(miniDebugger, 'ChromaShift')
  await waitForExpression(
    miniDebugger,
    `document.visibilityState === 'visible'`,
    'The mini panel was not visible after the app panel handed off to it.'
  )
  await miniDebugger.send('Runtime.evaluate', {
    expression: `window.chromaShift.openAppPanel('profiles')`,
    awaitPromise: true
  })
  await waitForExpression(
    miniDebugger,
    `document.visibilityState === 'hidden'`,
    'Opening the app panel did not hide the mini panel.'
  )
  await waitForExpression(
    debuggerClient,
    `document.visibilityState === 'visible'`,
    'The app panel was not visible after the mini panel handed off to it.'
  )
  debuggerClient.events.push(...miniDebugger.events)
  miniDebugger.close()

  const initiallySelectedProfile = productState.result.value?.value?.configuration.profiles[0]
  const initiallyConfiguredDisplayIds = initiallySelectedProfile?.displays.map(
    (target) => target.displayId
  )

  const readOnlyProfile = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const configuredDisplayIds = new Set(${JSON.stringify(initiallyConfiguredDisplayIds ?? [])})
      const displayRows = [...document.querySelectorAll('[data-part="display-control"]')]
      return {
        hasEdit: document.querySelector('[aria-label="Edit profile"]') !== null,
        hasNameInput: document.querySelector('[aria-label="Profile name"]') !== null,
        hasColorInput: document.querySelector('[data-part="profile-detail"] [data-slot="slider"]') !== null,
        hasColorSummary: document.querySelector('[data-part="color-summary"]') !== null,
        hasOverrideCheckbox: document.querySelector('[aria-label^="Override "]') !== null,
        displayRows: displayRows.length,
        configuredDisplaysOpen: displayRows
          .filter((row) => configuredDisplayIds.has(row.dataset.displayId))
          .every(
            (row) =>
              row.querySelector('[data-display-control-trigger][aria-expanded="true"]') !== null
          )
      }
    })()`,
    returnByValue: true
  })
  if (
    !readOnlyProfile.result.value?.hasEdit ||
    readOnlyProfile.result.value?.hasNameInput ||
    readOnlyProfile.result.value?.hasColorInput ||
    !readOnlyProfile.result.value?.hasColorSummary ||
    readOnlyProfile.result.value?.hasOverrideCheckbox ||
    !readOnlyProfile.result.value?.configuredDisplaysOpen ||
    (readOnlyProfile.result.value?.displayRows ?? 0) === 0
  ) {
    throw new Error(
      `Profile navigation did not begin with a read-only per-display summary: ${JSON.stringify(readOnlyProfile.result.value)}`
    )
  }

  if ((readOnlyProfile.result.value?.displayRows ?? 0) > 1) {
    for (let index = 0; index < 2; index += 1) {
      await debuggerClient.send('Runtime.evaluate', {
        expression: `(async () => {
          const trigger = document.querySelectorAll('[data-display-control-trigger]')[${index}]
          if (trigger?.getAttribute('aria-expanded') !== 'true') {
            trigger?.focus()
            await new Promise((resolve) => requestAnimationFrame(resolve))
            trigger?.click()
          }
        })()`,
        awaitPromise: true
      })
      await waitForExpression(
        debuggerClient,
        `[...document.querySelectorAll('[data-display-control-trigger]')].slice(0, ${index + 1}).every((trigger) => trigger.getAttribute('aria-expanded') === 'true')`,
        `The display accordion did not keep multiple display sections open (step ${index + 1}).`
      )
    }
  }

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Edit profile"]')?.click()`
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
      document.querySelector('[data-part="profile-name"]')?.textContent === 'Default profile'`,
    'Cancel did not restore the Default profile name.'
  )

  const settingsNavigation = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const button = document.querySelector('[aria-label="Settings"]')
      button?.click()
      return button !== null
    })()`,
    returnByValue: true
  })
  if (settingsNavigation.result.value !== true)
    throw new Error('Settings navigation was unavailable.')
  await waitForText(debuggerClient, 'Launch at start up')

  const originalThemeResult = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) return null
      const updated = await window.chromaShift.updateSettings({
        ...state.value.settings,
        theme: 'light'
      })
      return updated.ok ? state.value.settings.theme : null
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const originalTheme = originalThemeResult.result.value
  if (!['system', 'light', 'dark'].includes(originalTheme)) {
    throw new Error('The smoke test could not switch the app panel to explicit light mode.')
  }
  await waitForExpression(
    debuggerClient,
    `document.documentElement.classList.contains('light') &&
      !document.documentElement.classList.contains('dark') &&
      document.querySelector('[aria-label="Theme"]')?.textContent?.trim() === 'Light'`,
    'The explicit light theme did not reach the Chakra renderer.'
  )
  const lightVisuals = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const shell = document.querySelector('[data-part="app-shell"]')
      const panel = [...document.querySelectorAll('section')]
        .find((candidate) => candidate.querySelector('h1')?.textContent === 'General Settings')
      const row = document.querySelector('[data-part="settings-row"]')
      const select = document.querySelector('[aria-label="Theme"]')
      const style = (element) => element === null ? null : getComputedStyle(element)
      return {
        shellBackground: style(shell)?.backgroundColor,
        shellBorder: style(shell)?.borderTopColor,
        panelBackground: style(panel)?.backgroundColor,
        rowBackground: style(row)?.backgroundColor,
        selectBackground: style(select)?.backgroundColor,
        foreground: style(panel)?.color
      }
    })()`,
    returnByValue: true
  })
  const expectedLightVisuals = {
    shellBackground: 'rgb(241, 241, 243)',
    shellBorder: 'rgb(200, 200, 208)',
    panelBackground: 'rgba(0, 0, 0, 0)',
    rowBackground: 'rgb(241, 241, 243)',
    selectBackground: 'rgb(255, 255, 255)',
    foreground: 'rgb(9, 9, 11)'
  }
  if (JSON.stringify(lightVisuals.result.value) !== JSON.stringify(expectedLightVisuals)) {
    throw new Error(
      `The light theme diverged from the product palette: ${JSON.stringify(lightVisuals.result.value)}`
    )
  }
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 0,
    y: 0
  })
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.activeElement instanceof HTMLElement && document.activeElement.blur()`
  })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="settings-nav"] button')).backgroundColor !== 'rgba(0, 0, 0, 0)'`,
    'The active light-mode settings navigation item did not use a visible product surface.'
  )
  await captureScreenshot(debuggerClient, settingsScreenshotPath)

  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const trigger = document.querySelector('[aria-label="Windows startup behavior"]')
      trigger?.focus()
      trigger?.click()
    })()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Windows startup behavior"]')?.getAttribute('aria-expanded') === 'true' &&
      [...document.querySelectorAll('[role="option"]')]
        .some((candidate) => candidate.textContent?.trim() === 'Open app panel')`,
    'The Chakra startup behavior Select did not open its option list.'
  )
  await waitForExpression(
    debuggerClient,
    `(() => {
      const content = document.querySelector('[data-scope="select"][data-part="content"]')
      return content instanceof HTMLElement && getComputedStyle(content).opacity === '1'
    })()`,
    'The Chakra startup behavior Select did not finish opening.'
  )
  await captureScreenshot(debuggerClient, settingsSelectScreenshotPath)
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[role="option"]')]
      .find((candidate) => candidate.textContent?.trim() === 'Open app panel')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.settings.launchBehavior === 'app' &&
        document.querySelector('[aria-label="Windows startup behavior"]')?.textContent?.trim() === 'Open app panel'
    })()`,
    'Selecting an item from the Chakra startup behavior Select did not update settings.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const trigger = document.querySelector('[aria-label="Windows startup behavior"]')
      trigger?.focus()
      trigger?.click()
    })()`
  })
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[role="option"]')]
      .some((candidate) => candidate.textContent?.trim() === 'Minimized to tray')`,
    'The Chakra startup behavior Select did not reopen.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[role="option"]')]
      .find((candidate) => candidate.textContent?.trim() === 'Minimized to tray')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.settings.launchBehavior === 'tray' &&
        document.querySelector('[aria-label="Windows startup behavior"]')?.textContent?.trim() === 'Minimized to tray'
    })()`,
    'The Chakra startup behavior Select did not restore the original smoke setting.'
  )

  // Settings replaces the profile sidebar with its own General/Displays/About nav.
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="settings-nav"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'Displays')?.click()`
  })
  await waitForText(debuggerClient, 'Restore original display settings')
  await captureScreenshot(debuggerClient, displaysScreenshotPath)
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="settings-nav"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'About')?.click()`
  })
  await waitForText(debuggerClient, 'Version')
  await captureScreenshot(debuggerClient, aboutScreenshotPath)
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) return false
      const updated = await window.chromaShift.updateSettings({
        ...state.value.settings,
        theme: ${JSON.stringify(originalTheme)}
      })
      return updated.ok
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Back to profiles"]')?.click()`
  })
  await waitForText(debuggerClient, 'Default profile')
  const footerAlignment = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const footer = document.querySelector('[data-part="profile-list-footer"]')
      const settings = footer?.querySelector('[aria-label="Settings"]')
      if (!(footer instanceof HTMLElement) || !(settings instanceof HTMLElement)) return null
      return Math.abs(footer.getBoundingClientRect().right - settings.getBoundingClientRect().right)
    })()`,
    returnByValue: true
  })
  if (footerAlignment.result.value === null || footerAlignment.result.value > 1) {
    throw new Error(
      `The settings button was not flush right in the profile sidebar: ${footerAlignment.result.value}`
    )
  }

  // The renderer must not draw replacement caption buttons over the reserved
  // title-bar overlay rectangle, and the bar itself must remain a drag region.
  const titleBar = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const bar = document.querySelector('[data-part="title-bar"]')
      if (bar === null) return null
      const style = getComputedStyle(bar)
      const captionLabels = ['Minimize', 'Maximize', 'Restore', 'Close']
      return {
        drag: style.webkitAppRegion ?? style.getPropertyValue('-webkit-app-region'),
        drawsCaptionButtons: [...bar.querySelectorAll('button')].some((candidate) =>
          captionLabels.includes(candidate.getAttribute('aria-label') ?? '')),
        right: Math.round(bar.getBoundingClientRect().right),
        innerWidth: window.innerWidth
      }
    })()`,
    returnByValue: true
  })
  if (titleBar.result.value === null) throw new Error('The app panel did not render a title bar.')
  if (titleBar.result.value.drag !== 'drag') {
    throw new Error(`The title bar was not a drag region: ${JSON.stringify(titleBar.result.value)}`)
  }
  if (titleBar.result.value.drawsCaptionButtons) {
    throw new Error(
      'The renderer drew replacement caption buttons instead of using the native overlay.'
    )
  }

  await verifyTooltipMenuTrigger(debuggerClient, 'Profile actions', 'Edit')

  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 500,
    y: 10
  })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="profile-item"][data-selected] [data-part="profile-actions-trigger"] svg')).opacity === '0'`,
    'Selecting a profile incorrectly made its actions trigger visible.'
  )
  await hoverElement(debuggerClient, '[data-part="profile-item"][data-selected]')
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="profile-item"][data-selected] [data-part="profile-actions-trigger"] svg')).opacity === '1'`,
    'Hovering a profile did not reveal its actions trigger.'
  )
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 500,
    y: 10
  })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="profile-item"][data-selected] [data-part="profile-actions-trigger"] svg')).opacity === '0'`,
    'The profile actions trigger remained visible after hover ended.'
  )

  const createProfile = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const button = document.querySelector('[aria-label="New profile"]')
      if (button === null) return false
      button.click()
      return true
    })()`,
    returnByValue: true
  })
  if (createProfile.result.value !== true)
    throw new Error('The create-profile control was unavailable.')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') !== null`,
    'New profile did not enter Edit mode.'
  )
  await waitForExpression(
    debuggerClient,
    `document.querySelectorAll('[aria-label="Profile actions"]').length === 2 &&
      document.querySelector('[data-part="profile-item"][data-selected] [aria-label="Profile actions"]') !== null`,
    'The new profile did not propagate into the selected sidebar row.'
  )
  const editModeMenu = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const triggers = [...document.querySelectorAll('[aria-label="Profile actions"]')]
      const ids = triggers.map((trigger) => trigger.id)
      const selectedTrigger = document.querySelector(
        '[data-part="profile-item"][data-selected] [aria-label="Profile actions"]'
      )
      if (!(selectedTrigger instanceof HTMLElement)) return null
      selectedTrigger.click()
      return {
        triggerCount: triggers.length,
        uniqueIdCount: new Set(ids).size,
        everyIdPresent: ids.every(Boolean)
      }
    })()`,
    returnByValue: true
  })
  if (
    editModeMenu.result.value?.triggerCount !== 2 ||
    editModeMenu.result.value?.uniqueIdCount !== 2 ||
    editModeMenu.result.value?.everyIdPresent !== true
  ) {
    throw new Error(
      `Profile action triggers did not receive unique IDs: ${JSON.stringify(editModeMenu.result.value)}`
    )
  }
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[role="menuitem"]')]
      .some((candidate) => candidate.textContent?.trim() === 'Clone')`,
    'The profile actions menu did not open during Edit mode.'
  )
  const editModeItems = await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[role="menuitem"]')]
      .map((candidate) => candidate.textContent?.trim())`,
    returnByValue: true
  })
  if (
    editModeItems.result.value?.includes('Edit') ||
    editModeItems.result.value?.includes('Preview')
  ) {
    throw new Error(
      `The profile actions menu exposed Edit or Preview during Edit mode: ${JSON.stringify(editModeItems.result.value)}`
    )
  }
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27
  })
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27
  })
  const otherProfileMenu = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const row = [...document.querySelectorAll('[data-part="profile-item"]')]
        .find((candidate) =>
          candidate.querySelector('[data-part="profile-select"] strong')?.textContent?.trim() ===
            'Default profile'
        )
      const trigger = row?.querySelector('[aria-label="Profile actions"]')
      if (!(trigger instanceof HTMLElement)) return false
      trigger.click()
      return true
    })()`,
    returnByValue: true
  })
  if (otherProfileMenu.result.value !== true) {
    throw new Error('The non-edited profile actions were unavailable during Edit mode.')
  }
  await waitForExpression(
    debuggerClient,
    `(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')]
        .map((candidate) => candidate.textContent?.trim())
      return items.includes('Edit') && items.includes('Preview')
    })()`,
    'The non-edited profile did not retain Edit and Preview actions.'
  )
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27
  })
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27
  })

  await selectProfileMenuItem(debuggerClient, 'Default profile', 'Preview')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        document.querySelector('[data-part="profile-name"]')?.textContent === 'Default profile' &&
        document.querySelector('[aria-label="Profile name"]') === null &&
        document.querySelector('[aria-label="Dismiss error"]')?.parentElement?.textContent?.includes('before previewing.')
    })()`,
    'Previewing another profile did not leave Edit mode, navigate, and run target validation.'
  )

  await selectProfileMenuItem(debuggerClient, 'New profile', 'Edit')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        document.querySelector('[aria-label="Profile name"]')?.value === 'New profile'
    })()`,
    'Editing another profile did not stop Preview and navigate into its Edit mode.'
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
      const displayCheckbox = document.querySelector(${JSON.stringify(guardedDisplayRowSelector)})
        ?.querySelector('[aria-label^="Override "] [data-slot="checkbox"]')
      if (nameInput === null || displayCheckbox === null) {
        return {
          ready: false,
          hasNameInput: nameInput !== null,
          hasDisplayCheckbox: displayCheckbox !== null,
          body: document.body.innerText
        }
      }
      displayCheckbox.click()
      return { ready: true }
    })()`,
    returnByValue: true
  })
  if (editControls.result.value?.ready !== true) {
    throw new Error(
      `Edit mode did not expose profile name and display controls: ${JSON.stringify(editControls.result.value)}`
    )
  }
  // Overriding a display expands its row and mounts that display's own controls.
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="color-control"] [data-slot="checkbox"]') !== null`,
    'Overriding a display did not expose its per-display color controls.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="color-control"] [data-slot="checkbox"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' && result.value.preview.kind === 'edit'
    })()`,
    'Live edit preview did not activate.'
  )

  const sliderFocus = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const slider = document.querySelector('[data-part="color-control"] [role="slider"]')
      slider?.focus()
      return slider === null ? null : {
        active: document.activeElement === slider,
        disabled: slider.getAttribute('aria-disabled'),
        value: slider.getAttribute('aria-valuenow')
      }
    })()`,
    returnByValue: true
  })
  if (sliderFocus.result.value?.active !== true) {
    throw new Error(
      `The Chakra brightness slider could not receive keyboard focus: ${JSON.stringify(sliderFocus.result.value)}`
    )
  }
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
        result.value.preview.targets[0]?.color.brightness === 51
    })()`,
    'The edit-mode brightness slider did not retain its changed value.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="color-control"] [data-slot="checkbox"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.targets.length === 0
    })()`,
    'Removing the final color override did not restore a baseline-only preview.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="color-control"] [data-slot="checkbox"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.targets[0]?.color.brightness === 51
    })()`,
    'Re-enabling a color control did not restore its last defined value.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="color-control"] [data-slot="checkbox"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.targets.length === 0
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
      const target = profile?.displays[0]
      return profile?.name === 'Smoke profile' && target !== undefined &&
        Object.keys(target.color).length === 0 && target.lastColorValues?.brightness === 51
    })()`,
    'Saving did not retain the disabled value and restore automatic activation.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Edit profile"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'edit' &&
        result.value.preview.targets.length === 0
    })()`,
    'The saved profile could not re-enter live Edit mode for Cancel coverage.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="color-control"] [data-slot="checkbox"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.targets[0]?.color.brightness === 51
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
      const target = profile?.displays[0]
      return target !== undefined && Object.keys(target.color).length === 0 &&
        target.lastColorValues?.brightness === 51 &&
        document.querySelector('[data-part="color-summary"]') !== null
    })()`,
    'Cancel did not roll back an applied live-edit change.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Edit profile"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'edit' &&
        result.value.preview.targets.length === 0
    })()`,
    'The profile could not re-enter Edit mode for scheduled-change Cancel coverage.'
  )
  const cancelScheduledChange = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const brightnessCheckbox = document.querySelector('[data-part="color-control"] [data-slot="checkbox"]')
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
      const target = profile?.displays[0]
      return target !== undefined && Object.keys(target.color).length === 0 &&
        target.lastColorValues?.brightness === 51 &&
        document.querySelector('[data-part="color-summary"]') !== null &&
        document.querySelector('[data-part="profile-detail"] [data-slot="slider"]') === null
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (cancelledState.result.value !== true) {
    throw new Error(
      'Cancel did not discard a scheduled live-edit change and restore automatic activation.'
    )
  }

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Edit profile"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') !== null`,
    'The profile could not enter Edit mode for app-panel close coverage.'
  )
  await delay(20)
  await closeMainWindow(electron.pid)
  await delay(300)
  const priorEvents = debuggerClient.events
  const reopen = spawn(electronPath, [`--user-data-dir=${userDataDirectory}`, '.'], {
    cwd: desktopDirectory,
    env: environment,
    stdio: 'ignore',
    windowsHide: true
  })
  await waitForExit(reopen)
  const reopenedTarget = await waitForDebuggerTarget(
    debuggingPort,
    (candidate) => !candidate.url.includes('panel=mini')
  )
  const reopenedDebugger = await connectToDebugger(reopenedTarget.webSocketDebuggerUrl)
  await reopenedDebugger.send('Runtime.enable')
  await reopenedDebugger.send('Page.enable')
  await reopenedDebugger.send('Log.enable')
  reopenedDebugger.events.push(...priorEvents)
  debuggerClient.close()
  debuggerClient = reopenedDebugger
  await debuggerClient.send('Page.bringToFront')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `window.chromaShift.openAppPanel('profiles')`,
    awaitPromise: true
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        document.querySelector('[aria-label="Profile name"]') === null &&
        document.querySelector('[data-part="color-summary"]') !== null
    })()`,
    'Closing and reopening the app panel did not leave Edit mode and cancel its preview.'
  )

  const createdState = await debuggerClient.send('Runtime.evaluate', {
    expression: 'window.chromaShift.getState()',
    awaitPromise: true,
    returnByValue: true
  })
  if (createdState.result.value?.value?.configuration?.profiles?.length !== 2) {
    throw new Error('The profile creation workflow did not persist a profile.')
  }

  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      const profileSwitch = document.querySelector('[aria-label="Profile active"]')
      const autoSwitch = document.querySelector('[data-part="profile-list-footer"] [data-scope="switch"][data-part="root"]')
      return result.ok && result.value.activation.mode.kind === 'automatic' &&
        result.value.activation.currentTarget?.kind === 'profile' &&
        result.value.activation.currentTarget.profileId === 'default' &&
        document.querySelector('[data-part="profile-name"]')?.textContent === 'Smoke profile' &&
        profileSwitch?.getAttribute('data-state') === 'unchecked' &&
        autoSwitch?.getAttribute('data-state') === 'checked' &&
        autoSwitch?.querySelector('[data-part="label"]')?.textContent?.trim() === 'Auto switch'
    })()`,
    'The profile activation switch did not reflect the automatically active profile.'
  )

  await waitForExpression(
    debuggerClient,
    `(() => {
      const profileRoot = document.querySelector('[aria-label="Profile active"]')
      const autoRoot = document.querySelector('[data-part="profile-list-footer"] [data-scope="switch"][data-part="root"]')
      const profileControl = profileRoot?.querySelector('[data-part="control"]')
      const autoControl = autoRoot?.querySelector('[data-part="control"]')
      const profileThumb = profileRoot?.querySelector('[data-part="thumb"]')
      const autoThumb = autoRoot?.querySelector('[data-part="thumb"]')
      if (!(profileControl instanceof HTMLElement) || !(autoControl instanceof HTMLElement) ||
          !(profileThumb instanceof HTMLElement) || !(autoThumb instanceof HTMLElement)) return false
      const containsThumb = (control, thumb) => {
        const controlRect = control.getBoundingClientRect()
        const thumbRect = thumb.getBoundingClientRect()
        return thumbRect.left >= controlRect.left - 0.5 && thumbRect.right <= controlRect.right + 0.5 &&
          thumbRect.top >= controlRect.top - 0.5 && thumbRect.bottom <= controlRect.bottom + 0.5
      }
      return profileControl.className === autoControl.className &&
        profileThumb.className === autoThumb.className &&
        containsThumb(profileControl, profileThumb) && containsThumb(autoControl, autoThumb)
    })()`,
    'Profile activation and Auto switch did not share one contained Chakra Switch recipe.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Profile active"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      const profile = result.ok
        ? result.value.configuration.profiles.find((item) => item.id !== 'default')
        : undefined
      return result.ok && profile !== undefined &&
        result.value.activation.mode.kind === 'manual' &&
        result.value.activation.mode.profileId === profile.id &&
        result.value.activation.currentTarget?.kind === 'profile' &&
        result.value.activation.currentTarget.profileId === profile.id &&
        document.querySelector('[aria-label="Profile active"]')?.getAttribute('data-state') === 'checked' &&
        document.querySelector('[data-part="profile-list-footer"] [data-scope="switch"][data-part="root"]')?.getAttribute('data-state') === 'unchecked'
    })()`,
    'Activating the selected profile did not establish a manual override and disable Auto switch.'
  )

  await selectMenuItem(debuggerClient, 'More profile actions', 'Turn off')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      const profile = result.ok
        ? result.value.configuration.profiles.find((item) => item.id !== 'default')
        : undefined
      return result.ok && profile?.enabled === false &&
        result.value.activation.mode.kind === 'automatic' &&
        result.value.activation.currentTarget?.kind === 'profile' &&
        result.value.activation.currentTarget.profileId === 'default' &&
        document.querySelector('[aria-label="Profile active"] input')?.checked === false &&
        document.querySelector('[aria-label="Profile active"] input')?.disabled === true
    })()`,
    'Turning off the active profile from More profile actions did not return to automatic activation.'
  )

  await selectMenuItem(debuggerClient, 'More profile actions', 'Turn on')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      const profile = result.ok
        ? result.value.configuration.profiles.find((item) => item.id !== 'default')
        : undefined
      return result.ok && profile?.enabled === true &&
        document.querySelector('[aria-label="Profile active"]')?.getAttribute('data-state') === 'unchecked' &&
        document.querySelector('[aria-label="Profile active"]')?.hasAttribute('data-disabled') === false
    })()`,
    'Turning the profile back on from More profile actions did not enable its inactive switch.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Profile active"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.activation.mode.kind === 'manual' &&
        result.value.activation.currentTarget?.kind === 'profile' &&
        document.querySelector('[aria-label="Profile active"]')?.getAttribute('data-state') === 'checked'
    })()`,
    'The re-enabled profile could not be activated from its header switch.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Profile active"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.activation.mode.kind === 'automatic' &&
        result.value.activation.currentTarget?.kind === 'profile' &&
        result.value.activation.currentTarget.profileId === 'default' &&
        document.querySelector('[aria-label="Profile active"]')?.getAttribute('data-state') === 'unchecked' &&
        document.querySelector('[data-part="profile-list-footer"] [data-scope="switch"][data-part="root"]')?.getAttribute('data-state') === 'checked'
    })()`,
    'Deactivating the selected profile did not return immediately to automatic activation.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Profile active"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.activation.mode.kind === 'manual' &&
        result.value.activation.currentTarget?.kind === 'profile' &&
        document.querySelector('[aria-label="Profile active"]')?.getAttribute('data-state') === 'checked' &&
        document.querySelector('[data-part="profile-list-footer"] [data-scope="switch"][data-part="root"]')?.getAttribute('data-state') === 'unchecked'
    })()`,
    'The profile could not be reactivated after baseline restoration.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="profile-list-footer"] [data-scope="switch"][data-part="root"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.activation.mode.kind === 'automatic' &&
        result.value.activation.currentTarget?.kind === 'profile' &&
        result.value.activation.currentTarget.profileId === 'default' &&
        document.querySelector('[aria-label="Profile active"]')?.getAttribute('data-state') === 'unchecked' &&
        document.querySelector('[data-part="profile-list-footer"] [data-scope="switch"][data-part="root"]')?.getAttribute('data-state') === 'checked'
    })()`,
    'Auto switch did not reactivate the automatically selected profile.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="profile-list-footer"] [data-scope="switch"][data-part="root"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.activation.mode.kind === 'manual' &&
        result.value.activation.mode.profileId === 'default' &&
        result.value.activation.currentTarget?.kind === 'profile' &&
        result.value.activation.currentTarget.profileId === 'default' &&
        document.querySelector('[aria-label="Profile active"]')?.getAttribute('data-state') === 'unchecked'
    })()`,
    'Turning Auto switch off did not preserve the profile that was actually active.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="profile-list-footer"] [data-scope="switch"][data-part="root"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="profile-list-footer"] [data-scope="switch"][data-part="root"]')?.getAttribute('data-state') === 'checked'`,
    'Auto switch could not be re-enabled after preserving the active profile.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')]
      .find((candidate) => candidate.querySelector('strong')?.textContent === 'Default profile')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="profile-name"]')?.textContent === 'Default profile' &&
      document.querySelector('[aria-label="Profile active"] input')?.checked === true &&
      document.querySelector('[aria-label="Profile active"] input')?.disabled === true`,
    'The active Default profile switch was not on and locked.'
  )
  await hoverElement(debuggerClient, '[aria-label="Profile active"]')
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[role="tooltip"]')].some((candidate) =>
      candidate.textContent?.trim() === 'Default profile remains active until you activate another profile.'
    )`,
    'The locked Default profile switch did not explain why it cannot be deactivated.'
  )
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 0,
    y: 0
  })
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Profile active"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.activation.mode.kind === 'automatic' &&
        result.value.activation.currentTarget?.kind === 'profile' &&
        result.value.activation.currentTarget.profileId === 'default' &&
        document.querySelector('[aria-label="Profile active"] input')?.checked === true
    })()`,
    'The locked Default profile switch changed the active target.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')]
      .find((candidate) => candidate.querySelector('strong')?.textContent === 'Smoke profile')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="profile-name"]')?.textContent === 'Smoke profile' &&
      document.querySelector('[aria-label="Profile active"]')?.getAttribute('data-state') === 'unchecked'`,
    'Navigating away from the active profile did not turn the header switch off.'
  )

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
      const display = state.value.displays.find(
        (candidate) => candidate.id === ${JSON.stringify(guardedProductDisplayId)}
      )
      const secondDisplay = state.value.displays.find(
        (candidate) => candidate.id !== display?.id &&
          state.value.capabilityReports[candidate.id]?.capabilities.brightness.supported === true
      )
      if (profile === undefined || display === undefined) return false
      const saved = await window.chromaShift.saveProfile({
        ...profile,
        displays: secondDisplay === undefined
          ? [{ displayId: display.id, color: { brightness: 55 } }]
          : [
              { displayId: display.id, color: { brightness: 55 } },
              { displayId: secondDisplay.id, color: { brightness: 35, saturation: 60 } }
            ]
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
    `document.querySelector(${JSON.stringify(guardedDisplayRowSelector)})
      ?.querySelector('[data-part="color-summary-item"] dd')?.textContent === '55%'`,
    'The saved profile color was not rendered before explicit preview coverage.'
  )
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok) return false
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      if (profile === undefined) return false
      const configuredDisplayIds = new Set(profile.displays.map((target) => target.displayId))
      const configuredRows = [...document.querySelectorAll('[data-part="display-control"]')]
        .filter((row) => configuredDisplayIds.has(row.dataset.displayId))
      return configuredRows.length === configuredDisplayIds.size && configuredRows.every((row) =>
        row.querySelector('[data-display-control-trigger]')?.getAttribute('aria-expanded') === 'true'
      )
    })()`,
    'Viewing a profile did not open every display with saved settings.'
  )

  const disconnectedFixtureId = 'display:smoke-disconnected'
  const savedDisconnectedTarget = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) return false
      const profile = state.value.configuration.profiles.find((item) => item.id !== 'default')
      if (profile === undefined) return false
      const saved = await window.chromaShift.saveProfile({
        ...profile,
        displays: [
          ...profile.displays,
          { displayId: ${JSON.stringify(disconnectedFixtureId)}, color: { brightness: 52 } }
        ]
      })
      return saved.ok
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (savedDisconnectedTarget.result.value !== true) {
    throw new Error('Could not persist the disconnected-display smoke fixture.')
  }
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const state = await window.chromaShift.getState()
      const profile = state.ok
        ? state.value.configuration.profiles.find((item) => item.id !== 'default')
        : undefined
      return profile?.displays.some(
        (target) => target.displayId === ${JSON.stringify(disconnectedFixtureId)}
      ) === true &&
        document.querySelector('[data-part="profile-detail"]')
          ?.getAttribute('data-display-target-count') === String(profile.displays.length) &&
        document.querySelector(
          '[data-part="display-control"][data-display-id=${JSON.stringify(disconnectedFixtureId)}]'
        ) === null
    })()`,
    'A persisted disconnected display appeared in the profile editor.'
  )
  const removedDisconnectedTarget = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) return false
      const profile = state.value.configuration.profiles.find((item) => item.id !== 'default')
      if (profile === undefined) return false
      const saved = await window.chromaShift.saveProfile({
        ...profile,
        displays: profile.displays.filter(
          (target) => target.displayId !== ${JSON.stringify(disconnectedFixtureId)}
        )
      })
      return saved.ok
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (removedDisconnectedTarget.result.value !== true) {
    throw new Error('Could not remove the disconnected-display smoke fixture.')
  }
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const state = await window.chromaShift.getState()
      const profile = state.ok
        ? state.value.configuration.profiles.find((item) => item.id !== 'default')
        : undefined
      return profile !== undefined &&
        profile.displays.every(
          (target) => target.displayId !== ${JSON.stringify(disconnectedFixtureId)}
        ) &&
        document.querySelector('[data-part="profile-detail"]')
          ?.getAttribute('data-display-target-count') === String(profile.displays.length)
    })()`,
    'The renderer did not receive removal of the disconnected-display smoke fixture.'
  )

  // Two connected displays must hold visibly different settings in one profile.
  const perDisplayApply = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) return { skipped: true }
      const profile = state.value.configuration.profiles.find((item) => item.id !== 'default')
      const writableDisplays = state.value.displays.filter(
        (display) =>
          state.value.capabilityReports[display.id]?.capabilities.brightness.supported === true
      )
      if (writableDisplays.length < 2) return { skipped: true }
      return {
        skipped: false,
        targets: profile?.displays.map((target) => [target.displayId, target.color])
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const perDisplay = perDisplayApply.result.value
  if (perDisplay?.skipped !== true) {
    const targets = perDisplay?.targets ?? []
    if (targets.length !== 2 || targets[0][1].brightness === targets[1][1].brightness) {
      throw new Error(
        `One profile did not persist different settings per display: ${JSON.stringify(targets)}`
      )
    }
  }

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Preview"]')?.click()`
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
  await selectProfileMenuItem(debuggerClient, 'Smoke profile', 'Stop preview')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        document.querySelector('[data-part="profile-name"]')?.textContent === 'Smoke profile'
    })()`,
    'The profile-list Stop preview action did not cancel the explicit preview.'
  )
  await selectProfileMenuItem(debuggerClient, 'Smoke profile', 'Preview')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'preview'
    })()`,
    'The profile-list action did not switch back to Preview after cancellation.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Edit profile"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'edit' &&
        document.querySelector('[aria-label="Profile name"]')?.value === 'Smoke profile' &&
        [...document.querySelectorAll('[data-part="display-control"]')]
          .filter((row) => row.querySelector('[aria-label^="Override "] input')?.checked === true)
          .every((row) =>
            row.querySelector('[data-display-control-trigger]')?.getAttribute('aria-expanded') === 'true'
          )
    })()`,
    'The same-profile explicit preview did not promote into Edit with every configured display open.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Cancel')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        document.querySelector('[aria-label="Profile name"]') === null
    })()`,
    'Cancel did not restore the prior state after preview-to-edit promotion.'
  )
  await selectProfileMenuItem(debuggerClient, 'Smoke profile', 'Preview')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'preview'
    })()`,
    'The profile could not restart Preview after promoted Edit was canceled.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')]
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
        document.querySelector('[data-part="profile-name"]')?.textContent === 'Default profile'
    })()`,
    'Navigating to another profile did not stop preview and restore manual activation.'
  )

  const disposableProfile = await debuggerClient.send('Runtime.evaluate', {
    expression: `window.chromaShift.createProfile('Delete focus check')`,
    awaitPromise: true,
    returnByValue: true
  })
  if (disposableProfile.result.value?.ok !== true) {
    throw new Error('Could not create a disposable profile for delete-focus coverage.')
  }
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[data-part="profile-select"] strong')]
      .some((candidate) => candidate.textContent?.trim() === 'Delete focus check')`,
    'The disposable profile did not appear before delete-focus coverage.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')]
      .find((candidate) => candidate.querySelector('strong')?.textContent?.trim() ===
        'Delete focus check')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="profile-name"]')?.textContent === 'Delete focus check'`,
    'The disposable profile could not be selected before delete-focus coverage.'
  )
  await selectMenuItem(debuggerClient, 'More profile actions', 'Delete profile')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="alertdialog"]')?.textContent?.includes('Delete focus check') === true`,
    'Profile deletion did not open the in-app confirmation dialog.'
  )
  await delay(300)
  await captureScreenshot(debuggerClient, deleteDialogScreenshotPath)
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[role="alertdialog"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'Delete profile')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `![...document.querySelectorAll('[data-part="profile-select"] strong')]
      .some((candidate) => candidate.textContent?.trim() === 'Delete focus check')`,
    'The disposable profile was not deleted.'
  )
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-scope="dialog"]') === null`,
    'The profile deletion dialog did not finish closing.'
  )
  await waitForExpression(
    debuggerClient,
    `document.activeElement?.matches(
      '[data-part="profile-item"][data-selected] [data-part="profile-select"]'
    ) === true`,
    'Profile deletion did not restore focus to the remaining selected profile.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Edit profile"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') !== null`,
    'The remaining profile did not enter Edit mode after deletion.'
  )
  const nameInputBounds = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('[aria-label="Profile name"]')
      if (!(input instanceof HTMLElement)) return null
      const bounds = input.getBoundingClientRect()
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    })()`,
    returnByValue: true
  })
  if (nameInputBounds.result.value === null) {
    throw new Error('The profile name input was unavailable after deletion.')
  }
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    x: nameInputBounds.result.value.x,
    y: nameInputBounds.result.value.y
  })
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    x: nameInputBounds.result.value.x,
    y: nameInputBounds.result.value.y
  })
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    modifiers: 2
  })
  await debuggerClient.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    modifiers: 2
  })
  await debuggerClient.send('Input.insertText', { text: 'Default after delete' })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]')?.value === 'Default after delete'`,
    'The profile name input did not accept keyboard text after another profile was deleted.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Cancel')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') === null`,
    'Delete-focus coverage did not leave Edit mode.'
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
      const checkbox = document.querySelector('[data-part="color-control"] [data-slot="checkbox"]')
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
      if (!result.ok || result.value.preview.state !== 'active' ||
        result.value.preview.kind !== 'override') return false
      const visible = result.value.displays.find(
        (display) => display.id === ${JSON.stringify(guardedProductDisplayId)}
      )
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      const other = profile?.displays.find((target) => target.displayId !== visible?.id)
      const targets = result.value.preview.targets
      // The edited display returns to baseline while any other display keeps
      // the settings this profile gives it.
      const visibleCleared = targets.every((target) => target.displayId !== visible?.id)
      const otherRetained = other === undefined ||
        targets.some((target) =>
          target.displayId === other.displayId && target.color.brightness === 35
        )
      return visibleCleared && otherRetained &&
        document.body.innerText.includes('Update profile') &&
        document.body.innerText.includes('Reset changes')
    })()`,
    'Disabling the visible mini-panel control did not return only that display to baseline.'
  )

  await debuggerClient.send('Emulation.setDeviceMetricsOverride', {
    width: 400,
    height: 642,
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

  const preparedDefaultRoundTrip = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) return false
      const profile = state.value.configuration.profiles.find((item) => item.id === 'default')
      if (profile === undefined) return false
      const saved = await window.chromaShift.saveProfile({ ...profile, displays: [] })
      if (!saved.ok) return false
      const automatic = await window.chromaShift.enableAutomatic()
      return automatic.ok
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (preparedDefaultRoundTrip.result.value !== true) {
    throw new Error('Could not prepare the Default profile mini-panel round-trip check.')
  }
  await waitForText(debuggerClient, 'Default profile')
  const defaultBrightnessToggle = '[data-part="color-control"] [data-slot="checkbox"]'
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(defaultBrightnessToggle)})?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'override' &&
        document.querySelector(${JSON.stringify(defaultBrightnessToggle)})?.getAttribute('data-state') === 'checked'
    })()`,
    'Enabling Default brightness did not start the mini-panel override.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(defaultBrightnessToggle)})?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        document.querySelector(${JSON.stringify(defaultBrightnessToggle)})?.getAttribute('data-state') === 'unchecked' &&
        !document.body.innerText.includes('Update profile') &&
        !document.body.innerText.includes('Reset changes')
    })()`,
    'An unchanged Default brightness on/off round trip remained displayed as an override.'
  )
  await captureScreenshot(debuggerClient, miniDefaultScreenshotPath)

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="active-profile"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="radiogroup"]') !== null &&
      [...document.querySelectorAll('button')].some((candidate) => candidate.textContent?.trim() === 'Back')`,
    'The mini-panel profile picker did not open.'
  )
  await debuggerClient.send('Emulation.setDeviceMetricsOverride', {
    width: 400,
    height: 575,
    deviceScaleFactor: 1,
    mobile: false
  })
  await captureScreenshot(debuggerClient, miniPickerScreenshotPath)

  const restoredSmokeProfile = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) return false
      const profile = state.value.configuration.profiles.find((item) => item.id !== 'default')
      if (profile === undefined) return false
      const activated = await window.chromaShift.activateProfile(profile.id)
      return activated.ok
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (restoredSmokeProfile.result.value !== true) {
    throw new Error('The smoke profile could not be restored after the Default round-trip check.')
  }

  const miniPanelDebugger = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const button = document.querySelector('[aria-label="Open browser inspector"]')
      if (button === null) return { button: false, opened: false }
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 250))
      const result = await window.chromaShift.openMiniPanelDevTools()
      return { button: true, opened: result.ok }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (
    miniPanelDebugger.result.value?.button !== true ||
    miniPanelDebugger.result.value?.opened !== true
  ) {
    throw new Error('The mini-panel debugger button did not open the browser inspector.')
  }

  const failures = debuggerClient.events.filter(
    (event) =>
      event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
      (event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
  )
  if (failures.length > 0) {
    throw new Error(
      `The renderer reported ${failures.length} error event(s): ${JSON.stringify(failures)}`
    )
  }
  if (/preload script failed|unable to load preload/i.test(`${standardOutput}\n${standardError}`)) {
    throw new Error(`Electron reported a preload failure:\n${standardError}`)
  }

  for (const display of guardedDisplays) {
    const controlledState = await restorationGuard.getDisplayState(display.id)
    if (displayStateFingerprint(controlledState) === guardedBaselines.get(display.id)) {
      throw new Error(`The smoke profile did not fan out to ${display.connection}.`)
    }
  }

  globalThis.console.log('Desktop smoke test passed.')
  globalThis.console.log(`Renderer: ${ui.title} (${target.url})`)
  globalThis.console.log('Preload bridge: ready')
  globalThis.console.log('Native service: ready')
  globalThis.console.log(`Renderer errors: ${failures.length}`)
  globalThis.console.log(`Screenshot: ${screenshotPath}`)
  globalThis.console.log(`Mini-panel screenshot: ${miniScreenshotPath}`)
  globalThis.console.log(`Settings screenshot: ${settingsScreenshotPath}`)
  globalThis.console.log(`Settings Select screenshot: ${settingsSelectScreenshotPath}`)
  globalThis.console.log(`Displays screenshot: ${displaysScreenshotPath}`)
  globalThis.console.log(`About screenshot: ${aboutScreenshotPath}`)
  globalThis.console.log(`Delete dialog screenshot: ${deleteDialogScreenshotPath}`)
  globalThis.console.log(`Mini picker screenshot: ${miniPickerScreenshotPath}`)
  globalThis.console.log(`Mini Default restored screenshot: ${miniDefaultScreenshotPath}`)
} catch (error) {
  smokeFailure = error
} finally {
  if (debuggerClient !== undefined) {
    if (!forceElectronTermination) {
      try {
        await debuggerClient.send(
          'Runtime.evaluate',
          {
            expression: 'void window.chromaShift.requestExit()'
          },
          1_000
        )
      } catch {
        // Restore-safe exit can tear down the debugging socket before acknowledging.
      }
    }
    debuggerClient.close()
  }

  if (forceElectronTermination && electron.exitCode === null) electron.kill()

  try {
    await waitForExit(electron)
  } catch (error) {
    electron.kill()
    smokeFailure ??= error
  }
  try {
    for (const display of guardedDisplays) {
      const expectedFingerprint = guardedBaselines.get(display.id)
      const restoredState = await waitForRestoredDisplayState(
        restorationGuard,
        display.id,
        expectedFingerprint
      )
      if (displayStateFingerprint(restoredState) !== expectedFingerprint) {
        smokeFailure ??= new Error(
          `Electron exit left ${display.name} ${display.connection} on ` +
            `${displayStateFingerprint(restoredState)}; expected baseline ${expectedFingerprint}.`
        )
      }
    }
  } catch (error) {
    smokeFailure ??= error
  } finally {
    try {
      for (const display of guardedDisplays) await restorationGuard.restoreDisplay(display.id)
      await restorationGuard.stop()
    } catch (error) {
      smokeFailure ??= error
    }
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
