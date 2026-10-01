import { execFile, spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
const nativeScreenshotPath = join(screenshotDirectory, 'desktop-native.png')
const nativeMiniScreenshotPath = join(screenshotDirectory, 'mini-panel-paused-native.png')
const settingsScreenshotPath = join(screenshotDirectory, 'settings.png')
const settingsSelectScreenshotPath = join(screenshotDirectory, 'settings-select.png')
const shortcutsScreenshotPath = join(screenshotDirectory, 'shortcuts.png')
const pausedStatusScreenshotPath = join(screenshotDirectory, 'status-paused.png')
const pausedMiniScreenshotPath = join(screenshotDirectory, 'mini-panel-paused.png')
const displaysScreenshotPath = join(screenshotDirectory, 'displays.png')
const diagnosticsScreenshotPath = join(screenshotDirectory, 'diagnostics.png')
const aboutScreenshotPath = join(screenshotDirectory, 'about.png')
const deleteDialogScreenshotPath = join(screenshotDirectory, 'delete-profile-dialog.png')
const miniPickerScreenshotPath = join(screenshotDirectory, 'mini-picker.png')
const miniDefaultScreenshotPath = join(screenshotDirectory, 'mini-default-restored.png')
const displayServicePath = resolve(
  desktopDirectory,
  '../../native/DisplayService/bin/Debug/net10.0-windows/ChromaShift.DisplayService.exe'
)
const timeoutMilliseconds = 15_000
const execFileAsync = promisify(execFile)

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function pressToggleShortcut() {
  const command = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ChromaShiftSmokeKeys {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
'@
$keys = @(0x11, 0x12, 0x10, 0x78)
foreach ($key in $keys) { [ChromaShiftSmokeKeys]::keybd_event($key, 0, 0, [UIntPtr]::Zero) }
[Array]::Reverse($keys)
foreach ($key in $keys) { [ChromaShiftSmokeKeys]::keybd_event($key, 0, 2, [UIntPtr]::Zero) }
`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true
  })
}

async function pressEmergencyRestoreShortcut() {
  const command = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ChromaShiftEmergencyRestoreKeys {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
'@
$keys = @(0x11, 0x12, 0x5B, 0x52)
foreach ($key in $keys) { [ChromaShiftEmergencyRestoreKeys]::keybd_event($key, 0, 0, [UIntPtr]::Zero) }
[Array]::Reverse($keys)
foreach ($key in $keys) { [ChromaShiftEmergencyRestoreKeys]::keybd_event($key, 0, 2, [UIntPtr]::Zero) }
`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true
  })
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

async function waitForNoDebuggerTarget(port, matches) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)
      if (!response.ok) return
      const targets = await response.json()
      if (!targets.some((target) => target.type === 'page' && matches(target))) return
    } catch {
      return
    }
    await delay(100)
  }
  throw new Error('Electron retained a renderer after its release deadline.')
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
      const description =
        method === 'Runtime.evaluate'
          ? `${method}: ${params.expression?.replace(/\s+/g, ' ').trim().slice(0, 240)}`
          : method
      return withTimeout(response, responseTimeout, description)
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
    if (snapshot === undefined) {
      await delay(100)
      continue
    }
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

async function captureNativeWindow(processId, path) {
  // Capture the visible desktop surface, including Windows caption controls.
  // Do not activate the window: the mini panel must retain its foreground contract.
  const command = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ChromaShiftSmokeCapture {
  public delegate bool Callback(IntPtr window, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
}
'@
$captureWindows = [System.Collections.Generic.List[ChromaShiftSmokeCapture+Rect]]::new()
[ChromaShiftSmokeCapture]::EnumWindows({
  param($window, $parameter)
  $ownerId = [uint32]0
  [void][ChromaShiftSmokeCapture]::GetWindowThreadProcessId($window, [ref]$ownerId)
  if ($ownerId -eq ${processId} -and [ChromaShiftSmokeCapture]::IsWindowVisible($window)) {
    $rect = [ChromaShiftSmokeCapture+Rect]::new()
    if ([ChromaShiftSmokeCapture]::GetWindowRect($window, [ref]$rect) -and
        $rect.Right -gt $rect.Left -and $rect.Bottom -gt $rect.Top) { $captureWindows.Add($rect) }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
$captureRect = $captureWindows | Sort-Object { ($_.Right - $_.Left) * ($_.Bottom - $_.Top) } -Descending | Select-Object -First 1
if ($null -eq $captureRect) { throw 'No visible ChromaShift window available for native capture.' }
$captureBitmap = [System.Drawing.Bitmap]::new($captureRect.Right - $captureRect.Left, $captureRect.Bottom - $captureRect.Top)
$captureGraphics = [System.Drawing.Graphics]::FromImage($captureBitmap)
try {
  $captureGraphics.CopyFromScreen($captureRect.Left, $captureRect.Top, 0, 0, $captureBitmap.Size)
  $captureBitmap.Save('${path.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $captureGraphics.Dispose(); $captureBitmap.Dispose() }
`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true
  })
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

async function selectActivationOption(debuggerClient, label) {
  await waitForExpression(
    debuggerClient,
    `document.querySelector('button[aria-label="Profile selection"]')?.disabled === false`,
    'The profile selector did not become ready after the previous transition.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Profile selection"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[role="option"]')].some((item) =>
      item.getClientRects().length > 0 && item.querySelector('[data-part="item-text"]')?.textContent?.trim() === ${JSON.stringify(label)})`,
    `Profile selection did not show ${label}.`
  )
  await waitForExpression(
    debuggerClient,
    `(() => {
      const trigger = document.querySelector('[aria-label="Profile selection"]')?.getBoundingClientRect()
      const content = document.querySelector('[data-part="profile-selection-content"]')?.getBoundingClientRect()
      if (!trigger || !content || content.width <= trigger.width) return false
      const collapsed = getComputedStyle(document.querySelector('[data-part="profile-nav"]')).width === '40px'
      return collapsed
        ? content.left >= trigger.right && content.top >= 0 && content.bottom <= innerHeight
        : Math.abs(content.left - trigger.left) < 1 &&
          (content.bottom <= trigger.top || content.top >= trigger.bottom)
    })()`,
    'The profile selection menu was not anchored to its sidebar trigger.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[role="option"]')]
      .find((item) => item.getClientRects().length > 0 && item.querySelector('[data-part="item-text"]')?.textContent?.trim() === ${JSON.stringify(label)})?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile selection"]')?.getAttribute('aria-expanded') !== 'true'`,
    'The profile selector did not close.'
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
  $_.ParentProcessId -eq ${parentProcessId} -and $_.Name -eq 'ChromaShift.DisplayService.exe'
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
const applicationDataDirectory = environment.APPDATA
if (applicationDataDirectory === undefined) {
  throw new Error('APPDATA is required for the Windows desktop smoke test.')
}
const developmentElectronShortcut = join(
  applicationDataDirectory,
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Electron.lnk'
)
const developmentElectronShortcutExisted = await pathExists(developmentElectronShortcut)
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
const guardedDisplayTabSelector = `[data-part="display-tab"][data-display-id="${guardedProductDisplayId}"]`
const neutralColorSettings = {
  brightness: 50,
  contrast: 50,
  gamma: 1,
  saturation: 50,
  hue: 0,
  colorTemperature: 50
}

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
  if (!ui.body.includes('Profiles') || !ui.body.includes('Display color controls')) {
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
  await waitForNoDebuggerTarget(debuggingPort, (candidate) => !candidate.url.includes('panel=mini'))
  const miniTarget = await waitForDebuggerTarget(debuggingPort, (candidate) =>
    candidate.url.includes('panel=mini')
  )
  const miniDebugger = await connectToDebugger(miniTarget.webSocketDebuggerUrl)
  await miniDebugger.send('Runtime.enable')
  await miniDebugger.send('Page.enable')
  await miniDebugger.send('Log.enable')
  await waitForExpression(
    miniDebugger,
    `document.readyState === 'complete' &&
      document.querySelector('[data-part="mini-panel"]') !== null`,
    'The mini panel UI did not finish rendering.'
  )
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
  const recreatedAppTarget = await waitForDebuggerTarget(
    debuggingPort,
    (candidate) => !candidate.url.includes('panel=mini')
  )
  const recreatedAppDebugger = await connectToDebugger(recreatedAppTarget.webSocketDebuggerUrl)
  await recreatedAppDebugger.send('Runtime.enable')
  await recreatedAppDebugger.send('Page.enable')
  await recreatedAppDebugger.send('Log.enable')
  await waitForUi(recreatedAppDebugger)
  await waitForExpression(
    recreatedAppDebugger,
    `document.visibilityState === 'visible'`,
    'The app panel was not visible after the mini panel handed off to it.'
  )
  recreatedAppDebugger.events.push(...debuggerClient.events, ...miniDebugger.events)
  debuggerClient.close()
  miniDebugger.close()
  debuggerClient = recreatedAppDebugger

  const readOnlyProfile = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const displayRows = [...document.querySelectorAll('[data-part="display-control"]')]
      const colorInputs = [...document.querySelectorAll('[data-part="profile-detail"] [role="slider"]')]
      return {
        hasEdit: document.querySelector('[aria-label="Edit profile"]') !== null,
        hasNameInput: document.querySelector('[aria-label="Profile name"]') !== null,
        hasColorInput: colorInputs.length > 0,
        allColorInputsDisabled: colorInputs.every((input) => input.getAttribute('aria-disabled') === 'true'),
        hasOverrideCheckbox: document.querySelector('[aria-label^="Override "]') !== null,
        displayRows: displayRows.length,
        displayTabs: document.querySelectorAll('[data-part="display-tab"]').length
      }
    })()`,
    returnByValue: true
  })
  if (
    !readOnlyProfile.result.value?.hasEdit ||
    readOnlyProfile.result.value?.hasNameInput ||
    !readOnlyProfile.result.value?.hasColorInput ||
    !readOnlyProfile.result.value?.allColorInputsDisabled ||
    readOnlyProfile.result.value?.hasOverrideCheckbox ||
    (readOnlyProfile.result.value?.displayRows ?? 0) === 0 ||
    readOnlyProfile.result.value?.displayTabs !== readOnlyProfile.result.value?.displayRows
  ) {
    throw new Error(
      `Profile navigation did not begin with disabled edit-parity controls: ${JSON.stringify(readOnlyProfile.result.value)}`
    )
  }

  if ((readOnlyProfile.result.value?.displayRows ?? 0) > 1) {
    for (let index = 0; index < 2; index += 1) {
      await debuggerClient.send('Runtime.evaluate', {
        expression: `document.querySelectorAll('[data-part="display-tab"]')[${index}]?.click()`,
        awaitPromise: true
      })
      await waitForExpression(
        debuggerClient,
        `document.querySelectorAll('[data-part="display-tab"]')[${index}]?.getAttribute('aria-selected') === 'true'`,
        `The display tab did not become selected (step ${index + 1}).`
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

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="profile-nav"] [aria-label="Collapse sidebar"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="profile-nav"]')).width === '40px' &&
      document.querySelector('[data-part="profile-list-footer"] [aria-label="Expand sidebar"] .lucide-panel-left') !== null &&
      localStorage.getItem('chromashift.app-panel.sidebar-collapsed') === 'true'`,
    'The profile sidebar did not collapse to its persisted 40-pixel rail.'
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
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="settings-nav"]')).width === '40px' &&
      document.querySelector('[data-part="settings-nav-footer"] [aria-label="Expand sidebar"] .lucide-panel-left') !== null`,
    'The settings sidebar did not share the persisted collapsed state.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="settings-nav"] [aria-label="Expand sidebar"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="settings-nav"]')).width === '245px' &&
      document.querySelector('[data-part="settings-nav-footer"] [aria-label="Collapse sidebar"] .lucide-panel-left-close') !== null &&
      localStorage.getItem('chromashift.app-panel.sidebar-collapsed') === 'false'`,
    'The shared sidebar state did not expand from Settings.'
  )

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
    `getComputedStyle(document.querySelector('[data-part="settings-nav"] [aria-label="General"]')).backgroundColor !== 'rgba(0, 0, 0, 0)'`,
    'The active light-mode settings navigation item did not use a visible product surface.'
  )
  await captureScreenshot(debuggerClient, settingsScreenshotPath)

  const notificationPreference = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const toggle = document.querySelector('[aria-label="Windows notifications"]')
      toggle?.click()
      return toggle !== null
    })()`,
    returnByValue: true
  })
  if (notificationPreference.result.value !== true) {
    throw new Error('The notification preference was unavailable.')
  }
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.settings.notificationsEnabled
    })()`,
    'The notification preference was not persisted.'
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

  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="settings-nav"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'Shortcuts')?.click()`
  })
  await waitForText(
    debuggerClient,
    'Shortcuts continue to work while ChromaShift runs in the background'
  )
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="shortcut-display"][data-accelerator="CommandOrControl+Alt+Super+R"]')
      ?.getAttribute('aria-label') ===
      'Restore original display settings shortcut: Ctrl+Alt+Win+R' &&
      document.querySelector('button[aria-label="Restore original display settings shortcut"]') === null`,
    'The fixed restore-original-display-settings shortcut was not exposed as a read-only Safety action.'
  )
  const recordedToggleShortcut = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const button = document.querySelector('button[aria-label="Toggle ChromaShift shortcut"]')
      if (!(button instanceof HTMLButtonElement)) return false
      button.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      button.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'F9', code: 'F9', ctrlKey: true, altKey: true, shiftKey: true,
        bubbles: true, cancelable: true
      }))
      return true
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (recordedToggleShortcut.result.value !== true) {
    throw new Error('The Toggle ChromaShift shortcut recorder was unavailable.')
  }
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="shortcut-display"][data-accelerator="CommandOrControl+Alt+Shift+F9"]') !== null`,
    'The shortcut recorder did not capture the key combination.'
  )
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.settings.shortcutBindings.some((binding) =>
        binding.action.kind === 'toggleChromaShift' &&
        binding.accelerator === 'CommandOrControl+Alt+Shift+F9') &&
        ![...document.querySelectorAll('button')]
          .some((candidate) => candidate.textContent?.trim() === 'Save shortcuts')
    })()`,
    'The recorded Toggle ChromaShift shortcut was not automatically registered and persisted.'
  )
  const canceledUnfocusedShortcutRecording = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const button = document.querySelector('button[aria-label="Toggle ChromaShift shortcut"]')
      const alternateFocus = [...document.querySelectorAll('[data-part="settings-nav"] button')]
        .find((candidate) => candidate.textContent?.trim() === 'Shortcuts')
      if (!(button instanceof HTMLButtonElement) || !(alternateFocus instanceof HTMLButtonElement)) {
        return false
      }
      button.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      alternateFocus.focus()
      alternateFocus.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
      }))
      return document.activeElement === alternateFocus
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (canceledUnfocusedShortcutRecording.result.value !== true) {
    throw new Error('The shortcut recorder focus-loss cancellation check was unavailable.')
  }
  await waitForExpression(
    debuggerClient,
    `document.querySelector('button[aria-label="Toggle ChromaShift shortcut"]')?.textContent?.trim() === 'Record' &&
      document.querySelector('[data-part="shortcut-display"][data-accelerator="CommandOrControl+Alt+Shift+F9"]') !== null`,
    'Escape did not cancel shortcut recording after the Record button lost focus.'
  )
  const clearedUnfocusedShortcutRecording = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const button = document.querySelector('button[aria-label="Toggle ChromaShift shortcut"]')
      const alternateFocus = [...document.querySelectorAll('[data-part="settings-nav"] button')]
        .find((candidate) => candidate.textContent?.trim() === 'Shortcuts')
      if (!(button instanceof HTMLButtonElement) || !(alternateFocus instanceof HTMLButtonElement)) {
        return false
      }
      button.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      alternateFocus.focus()
      alternateFocus.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Delete', code: 'Delete', bubbles: true, cancelable: true
      }))
      return document.activeElement === alternateFocus
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (clearedUnfocusedShortcutRecording.result.value !== true) {
    throw new Error('The shortcut recorder focus-loss clearing check was unavailable.')
  }
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok &&
        document.querySelector('button[aria-label="Toggle ChromaShift shortcut"]')?.textContent?.trim() === 'Record' &&
        !result.value.settings.shortcutBindings.some((binding) =>
          binding.action.kind === 'toggleChromaShift')
    })()`,
    'Delete did not clear the shortcut after the Record button lost focus.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const button = document.querySelector('button[aria-label="Toggle ChromaShift shortcut"]')
      if (!(button instanceof HTMLButtonElement)) return
      button.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      button.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'F9', code: 'F9', ctrlKey: true, altKey: true, shiftKey: true,
        bubbles: true, cancelable: true
      }))
    })()`,
    awaitPromise: true
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="shortcut-display"][data-accelerator="CommandOrControl+Alt+Shift+F9"]') !== null`,
    'The shortcut recorder did not restore the Toggle ChromaShift smoke binding.'
  )
  await captureScreenshot(debuggerClient, shortcutsScreenshotPath)

  // Settings replaces the profile sidebar with its own settings-section navigation.
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="settings-nav"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'Displays')?.click()`
  })
  await waitForText(debuggerClient, 'Restore original display settings')
  await captureScreenshot(debuggerClient, displaysScreenshotPath)
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="settings-nav"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'Diagnostics')?.click()`
  })
  await waitForText(debuggerClient, 'Latest events from this ChromaShift data directory')
  await waitForText(debuggerClient, 'ApplicationStarted')
  await captureScreenshot(debuggerClient, diagnosticsScreenshotPath)
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
      const collapse = footer?.querySelector('[aria-label="Collapse sidebar"]')
      if (!(footer instanceof HTMLElement) || !(collapse instanceof HTMLElement)) return null
      return Math.abs(footer.getBoundingClientRect().right - collapse.getBoundingClientRect().right)
    })()`,
    returnByValue: true
  })
  if (footerAlignment.result.value === null || footerAlignment.result.value > 1) {
    throw new Error(
      `The collapse button was not flush right in the profile sidebar footer: ${footerAlignment.result.value}`
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
      document.querySelector(${JSON.stringify(guardedDisplayTabSelector)})?.click()
      const slider = document.querySelector(${JSON.stringify(guardedDisplayRowSelector)})
        ?.querySelector('[data-part="color-control"] [role="slider"]')
      const overrideCheckbox = document.querySelector('[aria-label^="Override "]')
      if (nameInput === null || slider === null || overrideCheckbox !== null) {
        return {
          ready: false,
          hasNameInput: nameInput !== null,
          hasSlider: slider !== null,
          hasOverrideCheckbox: overrideCheckbox !== null,
          body: document.body.innerText
        }
      }
      return {
        ready: slider.getAttribute('aria-disabled') !== 'true',
        sliderValue: slider.getAttribute('aria-valuenow')
      }
    })()`,
    returnByValue: true
  })
  if (editControls.result.value?.ready !== true) {
    throw new Error(
      `Edit mode did not expose profile name and display controls: ${JSON.stringify(editControls.result.value)}`
    )
  }
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="color-control"] [role="slider"]')?.getAttribute('aria-disabled') !== 'true'`,
    'Edit mode did not expose enabled color controls without a display override step.'
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
    expression: `document.querySelector('[aria-label="Reset brightness to neutral"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.targets[0]?.color.brightness === 50 &&
        document.querySelector('[aria-label="Reset brightness to neutral"]') === null
    })()`,
    'The brightness reset action did not restore only the neutral brightness value.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="color-control"] [role="slider"]')?.focus()`
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
      return result.ok && result.value.preview.targets[0]?.color.brightness === 51
    })()`,
    'Brightness could not be changed again after an individual reset.'
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
        target.color.brightness === 51 && Object.keys(target.color).length === 6 &&
        !('lastColorValues' in target)
    })()`,
    'Saving did not persist the complete color vector and restore automatic activation.'
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
        result.value.preview.targets[0]?.color.brightness === 51
    })()`,
    'The saved profile could not re-enter live Edit mode for Cancel coverage.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="color-control"] [role="slider"]')?.focus()`
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
        result.value.preview.targets[0]?.color.brightness === 52
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
      return target?.color.brightness === 51 &&
        document.querySelector('[data-part="profile-detail"] [role="slider"]')?.getAttribute('aria-disabled') === 'true'
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
        result.value.preview.targets[0]?.color.brightness === 51
    })()`,
    'The profile could not re-enter Edit mode for scheduled-change Cancel coverage.'
  )
  const cancelScheduledChange = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const reset = document.querySelector('[aria-label="Reset brightness to neutral"]')
      if (reset === null) return false
      reset.click()
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
      return target?.color.brightness === 51 &&
        document.querySelector('[data-part="profile-detail"] [role="slider"]')?.getAttribute('aria-disabled') === 'true'
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
  const priorEmergencyRestoreCount = (
    standardOutput.match(/"eventName":"EmergencyRestoreCompleted"/g) ?? []
  ).length
  await pressEmergencyRestoreShortcut()
  const emergencyRestoreDeadline = Date.now() + timeoutMilliseconds
  while (
    (standardOutput.match(/"eventName":"EmergencyRestoreCompleted"/g) ?? []).length <=
    priorEmergencyRestoreCount
  ) {
    if (Date.now() >= emergencyRestoreDeadline) {
      throw new Error('Ctrl+Alt+Windows+R did not complete emergency display restoration.')
    }
    await delay(100)
  }
  for (const display of guardedDisplays) {
    await waitForRestoredDisplayState(
      restorationGuard,
      display.id,
      guardedBaselines.get(display.id)
    )
  }
  const priorNotificationCount = (
    standardOutput.match(/"eventName":"ProfileNotificationRequested"/g) ?? []
  ).length
  await closeMainWindow(electron.pid)
  await waitForNoDebuggerTarget(debuggingPort, (candidate) => !candidate.url.includes('panel=mini'))
  await pressToggleShortcut()
  const shortcutDeadline = Date.now() + timeoutMilliseconds
  while (
    (standardOutput.match(/"eventName":"ProfileNotificationRequested"/g) ?? []).length <=
    priorNotificationCount
  ) {
    if (Date.now() >= shortcutDeadline) {
      throw new Error('The renderer-free toggle shortcut did not request a native notification.')
    }
    await delay(100)
  }
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
       return result.ok && result.value.chromaShift.status === 'paused' &&
         !result.value.chromaShift.transitionInProgress &&
         document.querySelector('[data-part="chromashift-control"][data-status="paused"]')?.textContent?.trim() === 'Status: Paused'
    })()`,
    'The renderer-free Toggle ChromaShift shortcut did not enter Paused.'
  )
  await captureScreenshot(debuggerClient, pausedStatusScreenshotPath)
  const pausedAppEvents = debuggerClient.events
  await debuggerClient.send('Runtime.evaluate', {
    expression: `void window.chromaShift.showMiniPanel()`
  })
  debuggerClient.close()
  await waitForNoDebuggerTarget(debuggingPort, (candidate) => !candidate.url.includes('panel=mini'))
  const pausedMiniTarget = await waitForDebuggerTarget(debuggingPort, (candidate) =>
    candidate.url.includes('panel=mini')
  )
  const pausedMiniDebugger = await connectToDebugger(pausedMiniTarget.webSocketDebuggerUrl)
  await pausedMiniDebugger.send('Runtime.enable')
  await pausedMiniDebugger.send('Page.enable')
  await pausedMiniDebugger.send('Log.enable')
  await waitForExpression(
    pausedMiniDebugger,
    `(async () => {
       const result = await window.chromaShift.getState()
       return result.ok && !result.value.chromaShift.transitionInProgress &&
         document.querySelector('[data-part="chromashift-control"][data-status="paused"]')?.textContent?.trim() === '' &&
         document.querySelector('[aria-label="Resume ChromaShift"]') !== null &&
         document.querySelector('[data-part="color-control"] [role="slider"]')?.getAttribute('aria-disabled') === 'true'
    })()`,
    'The Paused mini panel did not show status or disable color controls.'
  )
  await captureScreenshot(pausedMiniDebugger, pausedMiniScreenshotPath)
  await captureNativeWindow(electron.pid, nativeMiniScreenshotPath)
  await pausedMiniDebugger.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Resume ChromaShift"]')?.click()`
  })
  await waitForExpression(
    pausedMiniDebugger,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.chromaShift.status === 'active' &&
        document.querySelector('[data-part="chromashift-control"][data-status="active"]')?.textContent?.trim() === ''
    })()`,
    'The mini-panel status control did not resume ChromaShift.'
  )
  await pausedMiniDebugger.send('Runtime.evaluate', {
    expression: `window.chromaShift.openAppPanel('profiles')`,
    awaitPromise: true
  })
  const resumedAppTarget = await waitForDebuggerTarget(
    debuggingPort,
    (candidate) => !candidate.url.includes('panel=mini')
  )
  const resumedAppDebugger = await connectToDebugger(resumedAppTarget.webSocketDebuggerUrl)
  await resumedAppDebugger.send('Runtime.enable')
  await resumedAppDebugger.send('Page.enable')
  await resumedAppDebugger.send('Log.enable')
  resumedAppDebugger.events.push(...pausedAppEvents, ...pausedMiniDebugger.events)
  pausedMiniDebugger.close()
  debuggerClient = resumedAppDebugger
  await waitForUi(debuggerClient)
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Pause ChromaShift"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.chromaShift.status === 'paused' &&
        document.querySelector('[data-part="chromashift-control"][data-status="paused"]')?.textContent?.trim() === 'Status: Paused'
    })()`,
    'The app-panel status control did not pause ChromaShift.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Resume ChromaShift"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.chromaShift.status === 'active'
    })()`,
    'The app-panel status control did not resume ChromaShift.'
  )
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        document.querySelector('[aria-label="Profile name"]') === null &&
        document.querySelector('[data-part="profile-detail"] [role="slider"]')?.getAttribute('aria-disabled') === 'true'
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
      return result.ok && result.value.activation.mode.kind === 'automatic' &&
        result.value.activation.currentTarget?.profileId === 'default' &&
        document.querySelector('[data-part="profile-name"]')?.textContent === 'Smoke profile' &&
        document.querySelector('[aria-label="Profile selection"]')?.textContent?.trim() === 'Automatic: Default profile' &&
        document.querySelector('[data-part="profile-nav"] [data-part="profile-selection"]') !== null &&
        document.querySelector('[aria-label="Profile active"]') === null &&
        [...document.querySelectorAll('[data-part="profile-status"]')].some((item) => item.textContent === 'Current · Automatic')
    })()`,
    'Profile navigation did not remain independent of Automatic selection.'
  )
  await selectActivationOption(debuggerClient, 'Smoke profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      const profile = result.ok ? result.value.configuration.profiles.find((item) => item.id !== 'default') : undefined
      return result.ok && result.value.activation.mode.kind === 'manual' &&
        result.value.activation.mode.profileId === profile?.id &&
        result.value.activation.currentTarget?.profileId === profile?.id &&
        document.querySelector('[aria-label="Profile selection"]')?.textContent?.trim() === 'Manual: Smoke profile' &&
        [...document.querySelectorAll('[data-part="profile-status"]')].some((item) => item.textContent === 'Current · Manual')
    })()`,
    'The sidebar selector did not establish a manual selection.'
  )
  const selectorShortcut = 'CommandOrControl+Alt+Shift+F7'
  const assignedSelectorShortcut = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok) return false
      const updated = await window.chromaShift.updateSettings({
        ...result.value.settings,
        shortcutBindings: [
          ...result.value.settings.shortcutBindings.filter((binding) => binding.action.kind !== 'defaultProfile'),
          { action: { kind: 'defaultProfile' }, accelerator: ${JSON.stringify(selectorShortcut)} }
        ]
      })
      return updated.ok
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (assignedSelectorShortcut.result.value !== true) {
    throw new Error('Could not assign Default shortcut for selector smoke coverage.')
  }
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Profile selection"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[role="option"]')].some((item) =>
      item.querySelector('[data-part="item-text"]')?.textContent === 'Default profile' &&
      item.querySelector('[data-part="shortcut-display"]')?.getAttribute('data-accelerator') === ${JSON.stringify(selectorShortcut)})`,
    'The Default shortcut did not appear in the profile selector.'
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
  await selectMenuItem(debuggerClient, 'More profile actions', 'Disable profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      const profile = result.ok ? result.value.configuration.profiles.find((item) => item.id !== 'default') : undefined
      return result.ok && profile?.enabled === false && result.value.activation.mode.kind === 'automatic' &&
        result.value.activation.currentTarget?.profileId === 'default' &&
        [...document.querySelectorAll('[data-part="profile-status"]')].some((item) => item.textContent === 'Disabled')
    })()`,
    'Disabling the current profile did not return to Automatic.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Profile selection"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="profile-selection-content"] [role="listbox"]') !== null &&
      ![...document.querySelectorAll('[data-part="profile-selection-content"] [role="option"]')]
        .some((item) => item.querySelector('[data-part="item-text"]')?.textContent === 'Smoke profile')`,
    'The disabled profile remained available in the manual-selection listbox.'
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
  await selectMenuItem(debuggerClient, 'More profile actions', 'Enable profile')
  await selectActivationOption(debuggerClient, 'Smoke profile')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')]
      .find((item) => item.querySelector('strong')?.textContent === 'Default profile')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="profile-name"]')?.textContent === 'Default profile' &&
      document.querySelector('[aria-label="Profile selection"]')?.textContent?.trim() === 'Manual: Smoke profile'`,
    'Browsing Default changed the manual selection.'
  )
  await selectActivationOption(debuggerClient, 'Automatic')
  await selectActivationOption(debuggerClient, 'Default profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.activation.mode.kind === 'manual' &&
        result.value.activation.mode.profileId === 'default' &&
        document.querySelector('[aria-label="Profile selection"]')?.textContent?.trim() === 'Manual: Default profile'
    })()`,
    'Default could not be selected manually.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Pause ChromaShift"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="chromashift-control"]')?.textContent?.trim() === 'Status: Paused' &&
      [...document.querySelectorAll('[data-part="profile-status"]')].some((item) => item.textContent === 'Will resume · Manual')`,
    'Paused display control was presented as a current applied profile.'
  )
  await selectActivationOption(debuggerClient, 'Default profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.chromaShift.status === 'active' && result.value.activation.mode.kind === 'manual'
    })()`,
    'Reselecting the same manual profile did not resume a user pause.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Collapse sidebar"]')?.click()`
  })
  await selectActivationOption(debuggerClient, 'Automatic')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Expand sidebar"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile selection"]')?.textContent?.trim() === 'Automatic: Default profile'`,
    'Automatic selection was unavailable in the collapsed sidebar.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')]
      .find((item) => item.querySelector('strong')?.textContent === 'Smoke profile')?.click()`
  })
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Preview"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active'
    })()`,
    'The profile could not be previewed before changing selection.'
  )
  await selectActivationOption(debuggerClient, 'Smoke profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' && result.value.activation.mode.kind === 'manual'
    })()`,
    'Manual selection did not safely leave Preview.'
  )
  await selectActivationOption(debuggerClient, 'Automatic')

  const screenshot = await debuggerClient.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  })
  await mkdir(screenshotDirectory, { recursive: true })
  await writeFile(screenshotPath, globalThis.Buffer.from(screenshot.data, 'base64'))
  await captureNativeWindow(electron.pid, nativeScreenshotPath)

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
          ? [{ displayId: display.id, color: { ...${JSON.stringify(neutralColorSettings)}, brightness: 55 } }]
          : [
              { displayId: display.id, color: { ...${JSON.stringify(neutralColorSettings)}, brightness: 55 } },
              { displayId: secondDisplay.id, color: { ...${JSON.stringify(neutralColorSettings)}, brightness: 35, saturation: 60 } }
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
      ?.querySelector('[data-control="brightness"] [role="slider"]')?.getAttribute('aria-valuenow') === '55'`,
    'The saved profile color was not rendered before explicit preview coverage.'
  )
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok) return false
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      if (profile === undefined) return false
      return document.querySelector(${JSON.stringify(guardedDisplayTabSelector)})
        ?.getAttribute('aria-selected') === 'true'
    })()`,
    'The profile view did not retain the selected physical display tab.'
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
          { displayId: ${JSON.stringify(disconnectedFixtureId)}, color: { ...${JSON.stringify(neutralColorSettings)}, brightness: 52 } }
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
      if (!result.ok) return false
      const profile = result.value.configuration.profiles.find(
        (item) => item.name === 'Smoke profile'
      )
      return result.value.preview.state === 'active' &&
        result.value.preview.kind === 'edit' &&
        document.querySelector('[aria-label="Profile name"]')?.value === 'Smoke profile' &&
        result.value.preview.targets.length === profile?.displays.length
    })()`,
    'The same-profile explicit preview did not promote into Edit with complete targets.'
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

  const changedMiniControl = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const slider = document.querySelector('[data-part="color-control"] [role="slider"]')
      slider?.focus()
      return slider !== null
    })()`,
    returnByValue: true
  })
  if (changedMiniControl.result.value !== true) {
    throw new Error('The mini-panel color control was unavailable.')
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
      if (!result.ok || result.value.preview.state !== 'active' ||
        result.value.preview.kind !== 'override') return false
      const visible = result.value.displays.find(
        (display) => display.id === ${JSON.stringify(guardedProductDisplayId)}
      )
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      const other = profile?.displays.find((target) => target.displayId !== visible?.id)
      const targets = result.value.preview.targets
      const visibleChanged = targets.some((target) =>
        target.displayId === visible?.id && target.color.brightness === 56
      )
      const otherRetained = other === undefined ||
        targets.some((target) =>
          target.displayId === other.displayId && target.color.brightness === 35
        )
      return visibleChanged && otherRetained &&
        document.body.innerText.includes('Update profile') &&
        document.body.innerText.includes('Reset changes')
    })()`,
    'Changing the visible mini-panel control did not preserve the other display target.'
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
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="color-control"] [role="slider"]')?.focus()`
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
        result.value.preview.kind === 'override' &&
        result.value.preview.targets[0]?.color.brightness === 51 &&
        document.querySelector('[aria-label="Reset brightness to neutral"]') !== null
    })()`,
    'Changing Default brightness did not start the mini-panel override.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Reset brightness to neutral"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.targets[0]?.color.brightness === 50 &&
        document.querySelector('[aria-label="Reset brightness to neutral"]') === null
    })()`,
    'The Default brightness reset did not restore the neutral value.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Reset changes')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        !document.body.innerText.includes('Update profile') &&
        !document.body.innerText.includes('Reset changes')
    })()`,
    'Reset changes did not discard the neutral Default-profile override session.'
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

  const productionDebuggerButton = await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Open browser inspector"]') === null`,
    returnByValue: true
  })
  if (productionDebuggerButton.result.value !== true) {
    throw new Error('The production mini panel exposed its development debugger button.')
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
  globalThis.console.log(`Native-window screenshot: ${nativeScreenshotPath}`)
  globalThis.console.log(`Native mini-panel screenshot: ${nativeMiniScreenshotPath}`)
  globalThis.console.log(`Settings screenshot: ${settingsScreenshotPath}`)
  globalThis.console.log(`Settings Select screenshot: ${settingsSelectScreenshotPath}`)
  globalThis.console.log(`Shortcuts screenshot: ${shortcutsScreenshotPath}`)
  globalThis.console.log(`Paused status screenshot: ${pausedStatusScreenshotPath}`)
  globalThis.console.log(`Paused mini-panel screenshot: ${pausedMiniScreenshotPath}`)
  globalThis.console.log(`Displays screenshot: ${displaysScreenshotPath}`)
  globalThis.console.log(`Diagnostics screenshot: ${diagnosticsScreenshotPath}`)
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
  if (!developmentElectronShortcutExisted) {
    await rm(developmentElectronShortcut, { force: true })
  }
}

if (smokeFailure !== undefined) {
  if (standardOutput !== '') globalThis.console.error(`Electron stdout:\n${standardOutput}`)
  if (standardError !== '') globalThis.console.error(`Electron stderr:\n${standardError}`)
  throw smokeFailure
}
