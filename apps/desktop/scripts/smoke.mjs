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
import { focusNativeApp, verifyProfileReorder } from './profile-reorder-smoke.mjs'
import { verifyShortcuts } from './shortcuts-smoke.mjs'
import { cleanupDevelopmentShortcut } from './development-shortcut-cleanup.mjs'

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
  const diagnostic = await debuggerClient
    .send('Runtime.evaluate', {
      expression: `(async () => { const state = await window.chromaShift.getState(); return { preview: state.ok ? state.value.preview : state.error,
      controls: [...document.querySelectorAll('[data-part="color-control"]')].map((row) => ({ key: row.dataset.control, value: row.querySelector('[data-part="color-value"]')?.textContent, neutralAction: row.querySelector('[aria-label="Reset to neutral"]')?.outerHTML })),
      text: document.body.innerText.slice(-1500) } })()`,
      awaitPromise: true,
      returnByValue: true
    })
    .catch(() => null)
  throw new Error(failureMessage + ' ' + JSON.stringify(diagnostic))
}

async function captureScreenshot(debuggerClient, path) {
  const screenshot = await debuggerClient.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  })
  await mkdir(screenshotDirectory, { recursive: true })
  await writeFile(path, globalThis.Buffer.from(screenshot.data, 'base64'))
}

async function captureNativeWindow(processId, path, raiseApp = false) {
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
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int length);
}
'@
$captureWindows = [System.Collections.Generic.List[ChromaShiftSmokeCapture+Rect]]::new()
[ChromaShiftSmokeCapture]::EnumWindows({
  param($window, $parameter)
  $ownerId = [uint32]0
  [void][ChromaShiftSmokeCapture]::GetWindowThreadProcessId($window, [ref]$ownerId)
  if ($ownerId -eq ${processId} -and [ChromaShiftSmokeCapture]::IsWindowVisible($window)) {
    $title = [System.Text.StringBuilder]::new(256)
    [void][ChromaShiftSmokeCapture]::GetWindowText($window, $title, $title.Capacity)
    $rect = [ChromaShiftSmokeCapture+Rect]::new()
    if ($title.ToString() -eq 'ChromaShift' -and [ChromaShiftSmokeCapture]::GetWindowRect($window, [ref]$rect) -and
        $rect.Right -gt $rect.Left -and $rect.Bottom -gt $rect.Top) {
      ${raiseApp ? '[void][ChromaShiftSmokeCapture]::SetWindowPos($window, [IntPtr](-1), 0, 0, 0, 0, 0x53)' : ''}
      $captureWindows.Add($rect)
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
$captureRect = $captureWindows | Sort-Object { ($_.Right - $_.Left) * ($_.Bottom - $_.Top) } -Descending | Select-Object -First 1
if ($null -eq $captureRect) { throw 'No visible ChromaShift window available for native capture.' }
$captureBitmap = [System.Drawing.Bitmap]::new($captureRect.Right - $captureRect.Left, $captureRect.Bottom - $captureRect.Top)
$captureGraphics = [System.Drawing.Graphics]::FromImage($captureBitmap)
try {
  [void][ChromaShiftSmokeCapture]::DwmFlush()
  $captureGraphics.CopyFromScreen($captureRect.Left, $captureRect.Top, 0, 0, $captureBitmap.Size)
  $captureBitmap.Save('${path.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $captureGraphics.Dispose(); $captureBitmap.Dispose() }
`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true
  })
}

async function verifyNativeQuitPrompt(debuggerClient) {
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      const profile = state.value.configuration.profiles.find((item) => item.id !== 'default')
      const draft = { ...profile, name: profile.name + ' quit check' }
      const result = await window.chromaShift.startPreview(draft, 'edit')
      if (!result.ok) throw new Error(result.error.message)
      history.replaceState({}, '', location.pathname)
    })()`,
    awaitPromise: true
  })
  const appLoaded = debuggerClient.waitForEvent('Page.loadEventFired')
  await debuggerClient.send('Page.reload', { ignoreCache: true })
  await appLoaded
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]')?.value.endsWith(' quit check') &&
      document.querySelector('[data-part="unsaved-changes-actions"]') !== null`,
    'The quit-check draft did not hydrate into the app editor.'
  )
  // A native modal can defer the debugger response until it closes. Start its
  // capture/Cancel automation while the request is still pending.
  const exitRequested = debuggerClient.send('Runtime.evaluate', {
    expression: 'void window.chromaShift.requestExit()'
  }).then(() => null, (error) => error)
  const path = join(screenshotDirectory, 'unsaved-quit-prompt-native.png')
  const command = `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ChromaShiftQuitCapture {
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@
$condition = [System.Windows.Automation.AndCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]${electron.pid}),
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Unsaved changes')
)
$deadline = [DateTime]::UtcNow.AddSeconds(20)
$prompt = $null
while ($null -eq $prompt -and [DateTime]::UtcNow -lt $deadline) {
  $prompt = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
  if ($null -eq $prompt) { Start-Sleep -Milliseconds 100 }
}
if ($null -eq $prompt) { throw 'The smoke-owned native unsaved quit prompt did not open.' }
$cancel = $prompt.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Cancel'))
if ($null -eq $cancel) { throw 'The native quit prompt did not offer Cancel.' }
$promptHandle = [IntPtr]$prompt.Current.NativeWindowHandle
if ($promptHandle -eq [IntPtr]::Zero) { throw 'The native quit prompt has no window handle.' }
try {
  foreach ($label in @('Update profile', 'Discard changes')) {
    if ($null -eq $prompt.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $label))) {
      throw "The native quit prompt did not offer $label."
    }
  }
  $rect = $prompt.Current.BoundingRectangle
  $bitmap = [System.Drawing.Bitmap]::new([int]$rect.Width, [int]$rect.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    [void][ChromaShiftQuitCapture]::DwmFlush()
    $graphics.CopyFromScreen([int]$rect.Left, [int]$rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save('${path.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
} finally {
  # Closing the smoke-owned dialog selects Electron's cancelId, the Cancel choice.
  if (-not [ChromaShiftQuitCapture]::PostMessage($promptHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
    throw 'The native quit prompt could not be cancelled.'
  }
}
`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true
  })
  const exitError = await exitRequested
  if (exitError !== null) throw exitError
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const state = await window.chromaShift.getState()
      return state.ok && state.value.preview.state === 'active' && state.value.preview.unsavedChanges
    })()`,
    'Cancel on the native quit prompt did not preserve the unsaved session.'
  )
  await clickAppButton(debuggerClient, 'Discard changes', '[data-part="unsaved-changes-actions"]')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const state = await window.chromaShift.getState()
      return state.ok && state.value.preview.state === 'inactive' &&
        document.querySelector('[data-part="unsaved-changes-actions"]') === null
    })()`,
    'The quit-check draft did not roll back after Cancel.'
  )
  globalThis.console.log('Native unsaved quit prompt captured; native close/Cancel preserved the draft.')
}

async function verifyTooltipMenuTrigger(debuggerClient, triggerLabel, menuItemText) {
  await debuggerClient.send('Page.bringToFront')
  // Earlier pointer-driven checks can leave the synthetic pointer over a control
  // whose hover tooltip stays open. Then return to keyboard modality, because
  // tooltips open on focus only for keyboard focus. Modifier-only keys do not
  // count, and Escape also closes any stale tooltip.
  await movePointerToEmptyArea(debuggerClient)
  for (const type of ['keyDown', 'keyUp']) {
    await debuggerClient.send('Input.dispatchKeyEvent', {
      type,
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27
    })
  }
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      window.focus()
      document.activeElement instanceof HTMLElement && document.activeElement.blur()
    })()`
  })
  try {
    await waitForExpression(
      debuggerClient,
      `document.querySelector('[role="tooltip"]') === null`,
      `The previous tooltip did not close before checking ${triggerLabel}.`
    )
  } catch (error) {
    const open = await debuggerClient.send('Runtime.evaluate', {
      expression: `[...document.querySelectorAll('[role="tooltip"]')].map((tooltip) => ({
        text: tooltip.textContent,
        state: tooltip.getAttribute('data-state'),
        active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName
      }))`,
      returnByValue: true
    })
    throw new Error(`${error.message} Open tooltips: ${JSON.stringify(open.result.value)}`)
  }
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

async function focusTooltip(debuggerClient, selector, expectedText) {
  await debuggerClient.send('Page.bringToFront')
  await movePointerToEmptyArea(debuggerClient)
  for (const type of ['keyDown', 'keyUp']) {
    await debuggerClient.send('Input.dispatchKeyEvent', {
      type,
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27
    })
  }
  await debuggerClient.send('Runtime.evaluate', {
    expression:
      'window.focus(); document.activeElement instanceof HTMLElement && document.activeElement.blur()'
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="tooltip"]') === null`,
    'The previous tooltip did not close.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`
  })
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[role="tooltip"]')].some(item => item.textContent.includes(${JSON.stringify(expectedText)}))`,
    `The tooltip omitted ${expectedText}.`
  )
}

async function selectAppActivation(debuggerClient, label) {
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="mode-toggle"] button')?.disabled === false`,
    'The mode toggle did not become ready.'
  )
  if (label === 'Automatic' || label === 'Manual') {
    await debuggerClient.send('Runtime.evaluate', {
      expression: `document.querySelector('[data-part="mode-toggle"] [aria-label="${label}"]')?.click()`
    })
  } else {
    await selectProfileMenuItem(debuggerClient, label, 'Use this profile')
  }
  // Menu closure precedes serialized rollback/activation. Wait before reloading.
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.preview.state !== 'inactive' ||
        result.value.chromaShift.transitionInProgress ||
        document.querySelector('[data-part="mode-toggle"] button')?.disabled !== false) return false
      const mode = result.value.chromaShift.intendedMode
      if (${JSON.stringify(label)} === 'Automatic') return mode.kind === 'automatic'
      if (${JSON.stringify(label)} === 'Manual') return mode.kind === 'manual'
      const profile = result.value.configuration.profiles.find((item) => item.name === ${JSON.stringify(label)})
      return mode.kind === 'manual' && mode.profileId === profile?.id
    })()`,
    `App activation did not finish selecting ${label}.`
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

async function openProfileFromSidebar(debuggerClient, profileName) {
  // IPC completion precedes the React paint after saveProfile/openAppPanel.
  // Wait for the renamed row and the serialized navigation to settle before
  // clicking; otherwise the optional lookup silently misses the stale label.
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]')?.disabled === false &&
      [...document.querySelectorAll('[data-part="profile-select"]')]
        .some((item) => item.getClientRects().length > 0 &&
          item.querySelector('strong')?.textContent?.trim().replace(/ •$/, '') === ${JSON.stringify(profileName)})`,
    `The sidebar row ${profileName} was not ready for editing.`
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')]
      .find((item) => item.querySelector('strong')?.textContent?.trim().replace(/ •$/, '') === ${JSON.stringify(profileName)})?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok) return false
      const state = result.value
      const profile = state.configuration.profiles.find((item) => item.name === ${JSON.stringify(profileName)})
      const ready = state.chromaShift.status !== 'active' ||
        state.chromaShift.intendedTarget?.profileId === profile?.id ||
        (state.preview.state === 'active' && state.preview.profileId === profile?.id)
      return ready &&
        document.querySelector('[aria-label="Profile name"]')?.value === ${JSON.stringify(profileName)} &&
        document.querySelector('[aria-label="Profile name"]')?.disabled === false
    })()`,
    `The sidebar did not open ${profileName} for editing.`
  )
}

async function clickAppButton(debuggerClient, label, scope = '') {
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll(${JSON.stringify(`${scope} button`.trim())})]
      .find((item) => item.textContent?.trim() === ${JSON.stringify(label)})?.click()`
  })
}

async function answerUnsavedChanges(debuggerClient, label) {
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="alertdialog"]')?.textContent?.includes('has unsaved changes')`,
    'The unsaved-changes dialog did not open.'
  )
  await captureNativeWindow(
    electron.pid,
    join(screenshotDirectory, 'unsaved-changes-dialog-native.png')
  )
  await clickAppButton(debuggerClient, label, '[role="alertdialog"]')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="alertdialog"]') === null`,
    'The unsaved-changes dialog did not close.'
  )
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

// Main passes the resolved theme in the window URL so loading screens are themed
// before product state arrives; it must agree with the theme the app applies.
async function expectLoadingThemeMatchesApp(debuggerClient, surface) {
  const theme = await debuggerClient.send('Runtime.evaluate', {
    expression: `({
      requested: new URLSearchParams(location.search).get('theme'),
      dark: document.documentElement.classList.contains('dark'),
      light: document.documentElement.classList.contains('light')
    })`,
    returnByValue: true
  })
  const { requested, dark, light } = theme.result.value ?? {}
  if ((requested !== 'dark' && requested !== 'light') || dark === light) {
    throw new Error(
      `The ${surface} had no resolved loading theme: ${JSON.stringify(theme.result.value)}`
    )
  }
  if ((requested === 'dark') !== dark) {
    throw new Error(
      `The ${surface} loading theme did not match the app theme: ${JSON.stringify(theme.result.value)}`
    )
  }
}

// Fixed title-bar coordinates can land on the App view toggle at some window
// widths, so park the synthetic pointer in the main panel's empty corner.
async function movePointerToEmptyArea(debuggerClient) {
  const point = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const panel = document.querySelector('[data-part="main-panel"]')
      if (!(panel instanceof HTMLElement)) return null
      const bounds = panel.getBoundingClientRect()
      return { x: bounds.right - 8, y: bounds.bottom - 8 }
    })()`,
    returnByValue: true
  })
  if (point.result.value === null) {
    throw new Error('The main panel was unavailable for pointer parking.')
  }
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.result.value.x,
    y: point.result.value.y
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

async function verifyColorValues(debuggerClient, rowSelector) {
  const row = JSON.stringify(rowSelector)
  const brightness = `document.querySelector(${row})?.querySelector('[data-control="brightness"]')`
  const button = `${brightness}?.querySelector('[data-part="color-value"]')`
  const input = `${brightness}?.querySelector('input:not([type="hidden"])')`
  const reset = async () => {
    await debuggerClient.send('Runtime.evaluate', {
      expression: `${brightness}?.querySelector('[aria-label="Reset to neutral"]')?.click()`
    })
    await waitForExpression(
      debuggerClient,
      `${button}?.textContent?.trim() === '50%'`,
      'Color-value smoke did not return brightness to neutral.'
    )
  }
  const press = async (key, code) => {
    for (const type of ['keyDown', 'keyUp'])
      await debuggerClient.send('Input.dispatchKeyEvent', {
        type,
        key,
        code: key,
        windowsVirtualKeyCode: code
      })
  }
  const presentation = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const row = document.querySelector(${row})
      return { values: [...row.querySelectorAll('[data-part="color-value"]')].map((value) => value.textContent), ticks: row.querySelectorAll('[data-part="slider-neutral"]').length,
        gradients: ['hue', 'saturation'].map((control) => { const track = row.querySelector('[data-control="' + control + '"] [data-scope="slider"][data-part="track"]'); return track === null ? null : getComputedStyle(track).backgroundImage }),
        steppers: row.querySelectorAll('[data-scope="number-input"]').length }
    })()`,
    returnByValue: true
  })
  globalThis.console.log('Color control presentation:', JSON.stringify(presentation))
  await waitForExpression(
    debuggerClient,
    `(() => {
    const row = document.querySelector(${row})
    return row?.querySelector('[data-control="gamma"] [data-part="color-value"]')?.textContent?.trim() === '1.00' &&
      row?.querySelector('[data-control="hue"] [data-part="color-value"]')?.textContent?.trim() === '0°' &&
      row?.querySelectorAll('[data-part="slider-neutral"]').length >= 5 &&
      ['hue', 'saturation'].every((control) => getComputedStyle(row.querySelector('[data-control="' + control + '"] [data-scope="slider"][data-part="track"]')).backgroundImage.includes('linear-gradient')) &&
      row?.querySelector('[data-scope="number-input"]') === null
  })()`,
    'Color controls did not show formatted values, neutral ticks, and plain values without steppers.'
  )
  for (const action of ['Escape', 'Enter', 'blur']) {
    await debuggerClient.send('Runtime.evaluate', { expression: `${button}?.click()` })
    await waitForExpression(
      debuggerClient,
      `document.activeElement === ${input}`,
      'Inline brightness input did not receive focus.'
    )
    await debuggerClient.send('Input.insertText', { text: '51' })
    if (action === 'blur')
      await debuggerClient.send('Runtime.evaluate', { expression: `${input}?.blur()` })
    else await press(action, action === 'Escape' ? 27 : 13)
    await waitForExpression(
      debuggerClient,
      `${button}?.textContent?.trim() === '${action === 'Escape' ? '50%' : '51%'}'`,
      `Inline brightness ${action} did not save or cancel correctly.`
    )
    if (action !== 'Escape') await reset()
  }
  await debuggerClient.send('Runtime.evaluate', { expression: `${button}?.focus()` })
  await press('ArrowUp', 38)
  await waitForExpression(
    debuggerClient,
    `${button}?.textContent?.trim() === '51%'`,
    'Arrow keys did not adjust the plain value.'
  )
  await reset()
  // A closed value ignores the wheel; the slider then adds exactly one step.
  for (const selector of ['[data-part="color-value"]', '[data-slot="slider"]']) {
    await debuggerClient.send('Runtime.evaluate', {
      expression: `${brightness}?.querySelector('${selector}')?.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))`
    })
  }
  await waitForExpression(
    debuggerClient,
    `${button}?.textContent?.trim() === '51%'`,
    'Mouse wheel did not adjust only the slider of the color control.'
  )
  await reset()
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
cleanupDevelopmentShortcut(electronPath)
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

function countLogMatches(pattern) {
  return (standardOutput.match(pattern) ?? []).length
}

async function waitForLogCount(pattern, previousCount, failureMessage) {
  const deadline = Date.now() + timeoutMilliseconds
  while (countLogMatches(pattern) <= previousCount) {
    if (Date.now() >= deadline) throw new Error(failureMessage)
    await delay(100)
  }
}
let standardError = ''
const electron = spawn(
  electronPath,
  [
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${userDataDirectory}`,
    // Native occlusion can incorrectly hide a window under CDP input and stop
    // its animation frames. This applies only to the interactive smoke process.
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    '.'
  ],
  {
    cwd: desktopDirectory,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    // This is an interactive desktop gate. Hiding the launched GUI process can
    // leave native windows invisible and stop the renderer's animation frames.
    windowsHide: false
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
async function runProfileReorder() {
  await verifyProfileReorder({
    debuggerClient,
    waitForExpression,
    captureNativeWindow,
    processId: electron.pid,
    screenshotPath: join(screenshotDirectory, 'profile-reorder-native.png')
  })
}

async function runShortcuts() {
  await verifyShortcuts({
    debuggerClient,
    waitForExpression,
    captureNativeWindow,
    processId: electron.pid,
    screenshotDirectory
  })
}

async function setTheme(debuggerClient, theme) {
  const result = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) return null
      const updated = await window.chromaShift.updateSettings({ ...state.value.settings, theme: ${JSON.stringify(theme)} })
      return updated.ok ? state.value.settings.theme : null
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (typeof result.result.value !== 'string') throw new Error(`Could not switch to the ${theme} theme.`)
  if (theme !== 'system') {
    await waitForExpression(
      debuggerClient,
      `document.documentElement.classList.contains(${JSON.stringify(theme)})`,
      `The ${theme} theme did not reach the renderer.`
    )
  }
  return result.result.value
}

async function closeTooltips(debuggerClient, context) {
  await movePointerToEmptyArea(debuggerClient)
  for (const type of ['keyDown', 'keyUp']) {
    await debuggerClient.send('Input.dispatchKeyEvent', {
      type,
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27
    })
  }
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="tooltip"]') === null`,
    `The ${context} tooltip did not close.`
  )
}

// A long name truncates to one line in the sidebar, rail, header, and preview
// banner without horizontal overflow. The shared Tooltip shows the full name.
async function verifyLongProfileName(debuggerClient, name) {
  const row = `[...document.querySelectorAll('[data-part="profile-item"]')].find((item) =>
    item.querySelector('[data-part="profile-select"] strong')?.textContent?.trim() === ${JSON.stringify(name)})`
  const noOverflow = (selector) =>
    `[...document.querySelectorAll(${JSON.stringify(selector)})].every((element) => element.scrollWidth <= element.clientWidth + 1)`
  const layout = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const row = ${row}
      const text = row?.querySelector('[data-part="profile-name-text"]')
      if (!(row instanceof HTMLElement) || !(text instanceof HTMLElement)) return null
      const style = getComputedStyle(text)
      return {
        rowFits: row.scrollWidth <= row.clientWidth + 1,
        rowHeight: row.getBoundingClientRect().height,
        truncated: text.hasAttribute('data-truncated') && text.scrollWidth > text.clientWidth,
        textWidths: [text.scrollWidth, text.clientWidth, row.clientWidth],
        ellipsis: style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap',
        navFits: ${noOverflow('[data-part="profile-nav"]')},
        headerFits: ${noOverflow('[data-part="profile-detail"] header')},
        bannerFits: ${noOverflow('[data-part="preview-banner"]')},
        bannerTruncates: (() => {
          const banner = document.querySelector('[data-part="preview-banner"] p')
          return banner instanceof HTMLElement && getComputedStyle(banner).textOverflow === 'ellipsis'
        })()
      }
    })()`,
    returnByValue: true
  })
  const measured = layout.result.value
  if (
    measured?.rowFits !== true ||
    measured.rowHeight > 41 ||
    measured.truncated !== true ||
    measured.ellipsis !== true ||
    measured.navFits !== true ||
    measured.headerFits !== true ||
    measured.bannerFits !== true ||
    measured.bannerTruncates !== true
  ) {
    throw new Error(`A long profile name overflowed or did not truncate: ${JSON.stringify(measured)}`)
  }

  // The live row carries a subtitle below its name and must truncate the same way.
  const liveRename = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      const live = state.ok && state.value.configuration.profiles.find((item) => item.id === 'default')
      if (!live) return null
      const saved = await window.chromaShift.saveProfile({ ...live, name: ${JSON.stringify(`Live ${name}`.slice(0, 65))} })
      return saved.ok ? live.name : null
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const liveName = liveRename.result.value
  if (typeof liveName !== 'string') throw new Error('Could not give the live profile a long name.')
  try {
    await waitForExpression(
      debuggerClient,
      `(() => {
        const row = [...document.querySelectorAll('[data-part="profile-item"]')]
          .find((item) => item.querySelector('[data-part="profile-status"]') !== null &&
            item.querySelector('[data-part="profile-name-text"][data-truncated]') !== null)
        return row instanceof HTMLElement && row.scrollWidth <= row.clientWidth + 1 &&
          row.getBoundingClientRect().height <= 41
      })()`,
      'The live profile row with its subtitle did not truncate a long name.'
    )
  } finally {
    await debuggerClient.send('Runtime.evaluate', {
      expression: `(async () => {
        const state = await window.chromaShift.getState()
        const live = state.ok && state.value.configuration.profiles.find((item) => item.id === 'default')
        if (live) await window.chromaShift.saveProfile({ ...live, name: ${JSON.stringify(liveName)} })
      })()`,
      awaitPromise: true
    })
  }
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[data-part="profile-select"] strong')]
      .some((item) => item.textContent?.trim() === ${JSON.stringify(liveName)})`,
    'The live profile name was not restored after the long-name check.'
  )

  const originalTheme = await setTheme(debuggerClient, 'dark')
  try {
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await setTheme(debuggerClient, 'light')
      await hoverElement(debuggerClient, '[data-part="profile-item"] [data-part="profile-name-text"][data-truncated]')
      await waitForExpression(
        debuggerClient,
        `[...document.querySelectorAll('[role="tooltip"]')].some((tooltip) => tooltip.textContent?.trim() === ${JSON.stringify(name)})`,
        `The truncated profile name did not show its full name in a tooltip (${theme}).`
      )
      await delay(200)
      await captureNativeWindow(electron.pid, join(screenshotDirectory, `long-profile-name-${theme}-native.png`))
      await closeTooltips(debuggerClient, `long profile name (${theme})`)
      await debuggerClient.send('Runtime.evaluate', {
        expression: `window.__smokeTitleWidth = document.querySelector('[data-part="profile-title"]').getBoundingClientRect().width`
      })
      await hoverElement(debuggerClient, '[data-part="profile-title"]')
      await waitForExpression(
        debuggerClient,
        `(() => {
          const title = document.querySelector('[data-part="profile-title-text"]')
          const icon = document.querySelector('[data-part="rename-icon"]')
          const button = document.querySelector('[data-part="profile-title"]')
          const panel = document.querySelector('[data-part="main-panel"]')
          return title !== null && title.scrollWidth > title.clientWidth &&
            getComputedStyle(title).textOverflow === 'ellipsis' &&
            getComputedStyle(button).backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            getComputedStyle(button).backgroundColor !== getComputedStyle(panel).backgroundColor &&
            Math.abs(button.getBoundingClientRect().width - window.__smokeTitleWidth) < 0.1 &&
            icon?.getAttribute('aria-hidden') === 'true' && getComputedStyle(icon).opacity === '1' &&
            [...document.querySelectorAll('[role="tooltip"]')].some((tooltip) => tooltip.textContent?.trim() === ${JSON.stringify(name)})
        })()`,
        `The truncated header name did not show its tooltip and edit affordance (${theme}).`
      )
      await captureNativeWindow(electron.pid, join(screenshotDirectory, `long-header-name-${theme}-native.png`))
      await closeTooltips(debuggerClient, `long header name (${theme})`)
      for (const type of ['keyDown', 'keyUp']) {
        await debuggerClient.send('Input.dispatchKeyEvent', {
          type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9
        })
      }
      await debuggerClient.send('Runtime.evaluate', {
        expression: `document.querySelector('[data-part="profile-title"]').focus()`
      })
      await waitForExpression(debuggerClient, `(() => {
        const button = document.querySelector('[data-part="profile-title"]')
        const icon = document.querySelector('[data-part="rename-icon"]')
        return button.matches(':focus-visible') && getComputedStyle(icon).opacity === '1' &&
          getComputedStyle(button).backgroundColor !== getComputedStyle(document.querySelector('[data-part="main-panel"]')).backgroundColor
      })()`, `The header edit affordance did not appear on keyboard focus (${theme}).`)
      await debuggerClient.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      await waitForExpression(debuggerClient,
        `getComputedStyle(document.querySelector('[data-part="rename-icon"]')).transitionDuration === '0s'`,
        'The header edit icon did not respect reduced motion.')
      await debuggerClient.send('Emulation.setEmulatedMedia', { features: [] })
      await debuggerClient.send('Runtime.evaluate', {
        expression: `document.querySelector('[data-part="profile-title"]').blur()`
      })
      await closeTooltips(debuggerClient, `keyboard header name (${theme})`)
    }
  } finally {
    await setTheme(debuggerClient, originalTheme)
  }

  // A short name never opens the name tooltip.
  await hoverElement(debuggerClient, '[data-part="profile-item"] [data-part="profile-name-text"]:not([data-truncated])')
  await delay(800)
  const shortTooltip = await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[role="tooltip"]') === null`,
    returnByValue: true
  })
  if (shortTooltip.result.value !== true) {
    throw new Error('An untruncated profile name opened a tooltip.')
  }
  await closeTooltips(debuggerClient, 'short profile name')

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="profile-nav"] [aria-label="Collapse sidebar"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="profile-nav"]')).width === '40px'`,
    'The sidebar did not collapse for the long-name rail check.'
  )
  const rail = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const nav = document.querySelector('[data-part="profile-nav"]')
      const overflowing = [...nav.querySelectorAll('*')]
        .filter((element) => element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0)
        .map((element) => ({
          part: element.getAttribute('data-part'),
          tag: element.tagName,
          label: element.getAttribute('aria-label'),
          widths: [element.scrollWidth, element.clientWidth]
        }))
      return {
        rowsFit: ${noOverflow('[data-part="profile-rows"]')} && ${noOverflow('[data-part="profile-item"]')},
        overflowing
      }
    })()`,
    returnByValue: true
  })
  if (rail.result.value?.rowsFit !== true) {
    throw new Error(`The collapsed rail overflowed with a long profile name: ${JSON.stringify(rail.result.value)}`)
  }
  if (rail.result.value.overflowing.length > 0) {
    globalThis.console.log(`Collapsed rail overflow outside profile rows: ${JSON.stringify(rail.result.value.overflowing)}`)
  }
  await hoverElement(debuggerClient, `[data-part="profile-item"] [aria-label="${name}"]`)
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[role="tooltip"]')].some((tooltip) => tooltip.textContent?.trim() === ${JSON.stringify(`${name} · Previewing · Use this profile (Shift+Enter)`)})`,
    'The collapsed rail did not show the full long profile name and activation hint.'
  )
  await closeTooltips(debuggerClient, 'collapsed rail')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="profile-nav"] [aria-label="Expand sidebar"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="profile-nav"]')).width !== '40px'`,
    'The sidebar did not expand after the long-name rail check.'
  )
}

// Switching from one previewed profile to another keeps the banner mounted for
// the destination. The guarded display is sampled during the switch to report,
// without failing, whether it visibly returns to the live target in between.
async function verifyPreviewToPreviewBanner(debuggerClient) {
  // The 65-character editor maximum also covers long-name truncation.
  const fixtureName = 'Preview switch check with a long profile name that keeps on going'
  const created = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const created = await window.chromaShift.createProfile(${JSON.stringify(fixtureName)})
      if (!created.ok) return null
      const saved = await window.chromaShift.saveProfile({
        ...created.value,
        displays: created.value.displays.map((target) =>
          target.displayId === ${JSON.stringify(guardedProductDisplayId)}
            ? { ...target, color: { ...${JSON.stringify(neutralColorSettings)}, brightness: 60 } }
            : target
        )
      })
      return saved.ok ? saved.value.id : null
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const fixtureId = created.result.value
  if (typeof fixtureId !== 'string') throw new Error('Could not create the preview-switch fixture.')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      window.__smokeSwitchBannerGap = false
      window.__smokeSwitchObserver = new MutationObserver(() => {
        if (document.querySelector('[data-part="preview-banner"]') === null)
          window.__smokeSwitchBannerGap = true
      })
      window.__smokeSwitchObserver.observe(document.body, { childList: true, subtree: true })
    })()`
  })
  const baseline = guardedBaselines.get(guardedDisplay.id)
  const before = displayStateFingerprint(await restorationGuard.getDisplayState(guardedDisplay.id))
  let sampling = true
  const samples = []
  const sampler = (async () => {
    while (sampling) {
      samples.push(
        displayStateFingerprint(await restorationGuard.getDisplayState(guardedDisplay.id))
      )
      await delay(10)
    }
  })()
  try {
    await openProfileFromSidebar(debuggerClient, fixtureName)
    await waitForExpression(
      debuggerClient,
      `(async () => {
        const result = await window.chromaShift.getState()
        return result.ok && result.value.preview.state === 'active' &&
          result.value.preview.kind === 'preview' &&
          result.value.preview.profileId === ${JSON.stringify(fixtureId)} &&
          document.querySelector(':has(> [data-part="main-panel"]) + [data-part="preview-banner"]')
            ?.textContent?.includes(${JSON.stringify(`Previewing: ${fixtureName}`)}) === true
      })()`,
      'Switching previews did not start the destination Preview with its banner.'
    )
  } finally {
    sampling = false
    await sampler
  }
  const after = samples.at(-1)
  const gap = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      window.__smokeSwitchObserver?.disconnect()
      return window.__smokeSwitchBannerGap === true
    })()`,
    returnByValue: true
  })
  if (gap.result.value !== false) {
    throw new Error('The preview banner disappeared while switching between previewed profiles.')
  }
  globalThis.console.log(
    `Preview switch observation: ${JSON.stringify({
      samples: samples.length,
      sourceDiffersFromLive: before !== baseline,
      destinationDiffersFromLive: after !== baseline,
      liveStateObservedBetweenPreviews: samples.some((sample) => sample === baseline)
    })}`
  )
  await verifyLongProfileName(debuggerClient, fixtureName)
  await openProfileFromSidebar(debuggerClient, 'Smoke profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.preview.state !== 'active' ||
        result.value.preview.kind !== 'preview') return false
      const previewed = result.value.configuration.profiles.find((item) => item.name === 'Smoke profile')
      if (result.value.preview.profileId !== previewed?.id) return false
      const deleted = await window.chromaShift.deleteProfile(${JSON.stringify(fixtureId)})
      return deleted.ok
    })()`,
    'Could not return to the Smoke profile preview and remove the preview-switch fixture.'
  )
}

async function runSmoke() {
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

  if (globalThis.process.argv.includes('--profile-reorder-only')) {
    await runProfileReorder()
    return
  }

  if (globalThis.process.argv.includes('--shortcuts-only')) {
    await runShortcuts()
    return
  }

  if (globalThis.process.argv.includes('--updates-only')) {
    await focusNativeApp(electron.pid)
    const before = await debuggerClient.send('Runtime.evaluate', {
      expression: 'window.chromaShift.getUpdateStatus()',
      awaitPromise: true,
      returnByValue: true
    })
    if (!before.result.value?.ok || before.result.value.value.phase !== 'idle') {
      throw new Error('Update status should be empty before a user-requested check.')
    }
    await debuggerClient.send('Runtime.evaluate', {
      expression: `window.chromaShift.openAppPanel('about')`,
      awaitPromise: true
    })
    await waitForExpression(
      debuggerClient,
      `document.body.innerText.includes('Check GitHub for a newer version.') && [...document.querySelectorAll('button')].some(button => button.textContent === 'Check for updates' && !button.disabled)`,
      'About did not show the initial update status.'
    )
    await captureNativeWindow(
      electron.pid,
      join(screenshotDirectory, 'about-updates-initial-native.png'),
      true
    )
    await debuggerClient.send('Runtime.evaluate', {
      expression: `[...document.querySelectorAll('button')].find(button => button.textContent === 'Check for updates').click()`
    })
    await waitForExpression(
      debuggerClient,
      `document.body.innerText.includes('Last checked') && [...document.querySelectorAll('button')].some(button => button.textContent === 'Check for updates' && !button.disabled)`,
      'The real GitHub update check did not complete.'
    )
    const checked = await debuggerClient.send('Runtime.evaluate', {
      expression: 'window.chromaShift.getUpdateStatus()',
      awaitPromise: true,
      returnByValue: true
    })
    if (!checked.result.value?.ok || checked.result.value.value === null) {
      throw new Error('Update status did not retain the completed check.')
    }
    await captureNativeWindow(
      electron.pid,
      join(screenshotDirectory, 'about-updates-checked-native.png'),
      true
    )
    await debuggerClient.send('Runtime.evaluate', {
      expression: `window.chromaShift.openAppPanel('settings')`,
      awaitPromise: true
    })
    await waitForExpression(
      debuggerClient,
      `!document.body.innerText.includes('Check for updates')`,
      'About did not unmount.'
    )
    await debuggerClient.send('Runtime.evaluate', {
      expression: `window.chromaShift.openAppPanel('about')`,
      awaitPromise: true
    })
    await waitForExpression(
      debuggerClient,
      `document.body.innerText.includes('Last checked')`,
      'About lost its last successful check after navigation.'
    )
    const errors = debuggerClient.events.filter(
      (event) =>
        event.method === 'Runtime.exceptionThrown' ||
        (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
    )
    if (errors.length) throw new Error(`Update UI reported errors: ${JSON.stringify(errors)}`)
    globalThis.console.log(
      'Update check: real GitHub request, About result, and retained status passed.'
    )
    return
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
  await expectLoadingThemeMatchesApp(miniDebugger, 'mini panel')
  // The app renderer was released when the mini panel opened, so this request
  // reaches a renderer that starts from scratch and last showed Profiles.
  await miniDebugger.send('Runtime.evaluate', {
    expression: `window.chromaShift.openAppPanel('settings')`,
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
  await waitForExpression(
    recreatedAppDebugger,
    `document.querySelector('[data-part="settings-nav"] [aria-label="General"][aria-current="page"]') !== null`,
    'Open settings from the mini panel did not open Settings in a recreated app renderer.'
  )
  await expectLoadingThemeMatchesApp(recreatedAppDebugger, 'app panel')
  await recreatedAppDebugger.send('Runtime.evaluate', {
    expression: `window.chromaShift.openAppPanel('profiles')`,
    awaitPromise: true
  })
  await waitForUi(recreatedAppDebugger)
  await focusNativeApp(electron.pid)
  await waitForExpression(
    recreatedAppDebugger,
    `document.visibilityState === 'visible'`,
    'The app panel was not visible after the mini panel handed off to it.'
  )
  recreatedAppDebugger.events.push(...debuggerClient.events, ...miniDebugger.events)
  debuggerClient.close()
  miniDebugger.close()
  debuggerClient = recreatedAppDebugger

  const editableProfile = await debuggerClient.send('Runtime.evaluate', {
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
    editableProfile.result.value?.hasEdit ||
    !editableProfile.result.value?.hasNameInput ||
    !editableProfile.result.value?.hasColorInput ||
    editableProfile.result.value?.allColorInputsDisabled ||
    editableProfile.result.value?.hasOverrideCheckbox ||
    (editableProfile.result.value?.displayRows ?? 0) === 0 ||
    editableProfile.result.value?.displayTabs !== editableProfile.result.value?.displayRows
  ) {
    throw new Error(
      `Profile navigation did not begin with editable controls: ${JSON.stringify(editableProfile.result.value)}`
    )
  }

  if ((editableProfile.result.value?.displayRows ?? 0) > 1) {
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

  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') !== null`,
    'The Default profile did not expose its name in Edit mode.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      document.querySelector('[data-part="profile-title"]')?.click()
      const input = document.querySelector('[aria-label="Profile name"]')
      input?.focus()
      input?.select()
    })()`
  })
  await waitForExpression(
    debuggerClient,
    `document.activeElement?.getAttribute('aria-label') === 'Profile name'`,
    'The inline profile name input did not receive focus.'
  )
  await debuggerClient.send('Input.insertText', { text: 'Desktop default' })
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
    `document.querySelector('[aria-label="Profile name"]')?.value === 'Desktop default'`,
    'The Default profile name input did not accept keyboard text.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-detail"] header [data-part="unsaved-changes-actions"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'Discard changes')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') !== null &&
      document.querySelector('[data-part="profile-name"]')?.value === 'Default profile'`,
    'Discard did not restore the Default profile name.'
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
  await waitForText(debuggerClient, 'Shortcuts work while ChromaShift runs in the background')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="shortcut-display"][data-accelerator="CommandOrControl+Alt+Super+R"]')
      ?.getAttribute('aria-label') ===
      'Restore original display settings shortcut: Ctrl+Alt+Win+R' &&
      document.querySelector('button[aria-label="Restore original display settings shortcut"]') === null`,
    'The fixed restore-original-display-settings shortcut was not exposed as a read-only Safety action.'
  )
  await runShortcuts()
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
  await waitForText(
    debuggerClient,
    'Copy or download the latest 250 events, including event details, as JSON Lines.'
  )
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

  // Keep the earlier diagnostics check within its bounded startup-log tail.
  await runProfileReorder()

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

  await verifyTooltipMenuTrigger(debuggerClient, 'Profile actions', 'Clone')

  await movePointerToEmptyArea(debuggerClient)
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
  await movePointerToEmptyArea(debuggerClient)
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
  await waitForExpression(
    debuggerClient,
    `document.activeElement?.getAttribute('aria-label') === 'Profile name' && document.activeElement.value === 'New profile'`,
    'A new profile did not open directly into focused naming.'
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
      return items.includes('Clone') && !items.includes('Edit') && !items.includes('Preview')
    })()`,
    'The profile menu did not keep Clone while removing Edit and Preview.'
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

  // Let the menu finish closing and restore its trigger before navigating.
  // Otherwise its delayed focus restoration can blur and close inline naming.
  // The automation host can take foreground ownership before trusted Escape.
  // Close any remaining menu through its trigger, as the row-menu helper does.
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const trigger = document.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')
      if (!(trigger instanceof HTMLElement)) return
      trigger.focus()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      trigger.click()
    })()`,
    awaitPromise: true
  })
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[role="menu"]')].every((menu) => menu.getClientRects().length === 0)`,
    'The profile menu did not finish closing before inline naming.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
    awaitPromise: true
  })
  await openProfileFromSidebar(debuggerClient, 'Default profile')
  await openProfileFromSidebar(debuggerClient, 'New profile')
  // New profiles start with neutral targets for every connected display, so
  // opening one starts a real native Preview instead of the empty-target notice.
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.preview.state !== 'active' ||
        result.value.preview.kind !== 'preview') return false
      const neutral = ${JSON.stringify(neutralColorSettings)}
      const banner = document.querySelector(':has(> [data-part="main-panel"]) + [data-part="preview-banner"]')
      return result.value.preview.targets.length === result.value.displays.length &&
        result.value.displays.every((display) => result.value.preview.targets.some(
          (target) => target.displayId === display.id &&
            Object.entries(neutral).every(([key, value]) => target.color[key] === value)
        )) &&
        banner?.textContent?.includes('Previewing: New profile') === true &&
        banner?.textContent?.includes('No display settings saved') === false
    })()`,
    'A new profile did not start a neutral native Preview with the banner.'
  )
  // Record any frame in which the banner disappears while the first change
  // promotes Preview to Edit.
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      window.__smokeBannerGap = false
      const check = () => {
        if (document.querySelector('[data-part="preview-banner"]') === null)
          window.__smokeBannerGap = true
      }
      window.__smokeBannerObserver = new MutationObserver(check)
      window.__smokeBannerObserver.observe(document.body, { childList: true, subtree: true })
    })()`
  })
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="profile-title"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]')?.hidden === false &&
      document.querySelector('[aria-label="Profile name"]')?.disabled === false`,
    'Inline naming did not become available after profile navigation.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('[aria-label="Profile name"]')
      input?.focus()
      input?.select()
    })()`
  })
  await waitForExpression(
    debuggerClient,
    `document.activeElement?.getAttribute('aria-label') === 'Profile name'`,
    'The inline profile name input did not receive focus.'
  )
  await debuggerClient.send('Input.insertText', { text: 'Smoke profile' })
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
    `document.querySelector(${JSON.stringify(guardedDisplayRowSelector)})?.querySelector('[data-part="color-control"] [role="slider"]')?.getAttribute('aria-disabled') !== 'true'`,
    'Edit mode did not expose enabled color controls without a display override step.'
  )

  await captureNativeWindow(
    electron.pid,
    join(screenshotDirectory, 'color-controls-initial-native.png')
  )
  await verifyColorValues(debuggerClient, guardedDisplayRowSelector)

  const sliderFocus = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const slider = document.querySelector(${JSON.stringify(guardedDisplayRowSelector)})?.querySelector('[data-part="color-control"] [role="slider"]')
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
        result.value.preview.targets.find((target) => target.displayId === ${JSON.stringify(guardedProductDisplayId)})?.color.brightness === 51
    })()`,
    'The edit-mode brightness slider did not retain its changed value.'
  )
  const promotedInPlace = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      window.__smokeBannerObserver?.disconnect()
      const result = await window.chromaShift.getState()
      return {
        kind: result.ok && result.value.preview.state === 'active' ? result.value.preview.kind : null,
        bannerGap: window.__smokeBannerGap === true,
        banner: document.querySelector('[data-part="preview-banner"]') !== null
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (
    promotedInPlace.result.value?.kind !== 'edit' ||
    promotedInPlace.result.value?.bannerGap !== false ||
    promotedInPlace.result.value?.banner !== true
  ) {
    throw new Error(
      `The first new-profile change did not promote Preview to Edit in place: ${JSON.stringify(promotedInPlace.result.value)}`
    )
  }

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-control="brightness"] [aria-label="Reset to neutral"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.targets.find((target) => target.displayId === ${JSON.stringify(guardedProductDisplayId)})?.color.brightness === 50 &&
        document.querySelector('[data-control="brightness"] [aria-label="Reset to neutral"]') === null
    })()`,
    'The brightness reset action did not restore only the neutral brightness value.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(guardedDisplayRowSelector)})?.querySelector('[data-part="color-control"] [role="slider"]')?.focus()`
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
      return result.ok && result.value.preview.targets.find((target) => target.displayId === ${JSON.stringify(guardedProductDisplayId)})?.color.brightness === 51
    })()`,
    'Brightness could not be changed again after an individual reset.'
  )

  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-detail"] header [data-part="unsaved-changes-actions"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'Update profile')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.activation.mode.kind !== 'automatic') return false
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      const target = profile?.displays.find((item) => item.displayId === ${JSON.stringify(guardedProductDisplayId)})
      const preview = result.value.preview
      return profile?.name === 'Smoke profile' && target !== undefined &&
        target.color.brightness === 51 && Object.keys(target.color).length === 6 &&
        !('lastColorValues' in target) &&
        preview.state === 'active' && preview.profileId === profile.id &&
        preview.targets.find((item) => item.displayId === ${JSON.stringify(guardedProductDisplayId)})?.color.brightness === 51 &&
        document.querySelector('[aria-label="Profile name"]')?.value === 'Smoke profile' &&
        document.querySelector('[aria-label="Profile name"]')?.disabled === false &&
        document.querySelector('[data-part="unsaved-changes-actions"]') === null &&
        document.querySelector(':has(> [data-part="main-panel"]) + [data-part="preview-banner"]')
          ?.textContent?.includes('Previewing: Smoke profile') === true
    })()`,
    'Update did not save the complete color vector and stay previewing the profile in automatic mode.'
  )

  await openProfileFromSidebar(debuggerClient, 'Smoke profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind !== 'override' &&
        result.value.preview.targets.find((target) => target.displayId === ${JSON.stringify(guardedProductDisplayId)})?.color.brightness === 51
    })()`,
    'The saved profile could not re-enter live Edit mode for Discard coverage.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(guardedDisplayRowSelector)})?.querySelector('[data-part="color-control"] [role="slider"]')?.focus()`
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
        result.value.preview.targets.find((target) => target.displayId === ${JSON.stringify(guardedProductDisplayId)})?.color.brightness === 52
    })()`,
    'The applied-change Discard check could not preview brightness.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-detail"] header [data-part="unsaved-changes-actions"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'Discard changes')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.activation.mode.kind !== 'automatic') return false
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      const target = profile?.displays.find((item) => item.displayId === ${JSON.stringify(guardedProductDisplayId)})
      const preview = result.value.preview
      return target?.color.brightness === 51 &&
        preview.state === 'active' && preview.profileId === profile.id &&
        preview.targets.find((item) => item.displayId === ${JSON.stringify(guardedProductDisplayId)})?.color.brightness === 51 &&
        document.querySelector('[aria-label="Profile name"]')?.value === 'Smoke profile' &&
        document.querySelector('[aria-label="Profile name"]')?.disabled === false &&
        document.querySelector(':has(> [data-part="main-panel"]) + [data-part="preview-banner"]') !== null
    })()`,
    'Discard did not revert an applied change while staying on the previewed profile.'
  )
  await openProfileFromSidebar(debuggerClient, 'Smoke profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind !== 'override' &&
        result.value.preview.targets.find((target) => target.displayId === ${JSON.stringify(guardedProductDisplayId)})?.color.brightness === 51
    })()`,
    'The profile could not re-enter Edit mode for scheduled-change Discard coverage.'
  )
  const cancelScheduledChange = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const reset = document.querySelector('[data-control="brightness"] [aria-label="Reset to neutral"]')
      if (reset === null) return false
      reset.click()
      await new Promise((resolve) => setTimeout(resolve, 20))
      const cancel = [...document.querySelectorAll('[data-part="profile-detail"] header [data-part="unsaved-changes-actions"] button')]
        .find((candidate) => candidate.textContent?.trim() === 'Discard changes')
      cancel?.click()
      return cancel !== undefined
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (cancelScheduledChange.result.value !== true) {
    throw new Error('The Discard changes control was unavailable during live Edit mode.')
  }
  await debuggerClient.send('Runtime.evaluate', {
    expression: 'new Promise((resolve) => setTimeout(resolve, 300))',
    awaitPromise: true
  })
  const cancelledState = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.activation.mode.kind !== 'automatic') return false
      const profile = result.value.configuration.profiles.find((item) => item.id !== 'default')
      const target = profile?.displays.find((item) => item.displayId === ${JSON.stringify(guardedProductDisplayId)})
      const preview = result.value.preview
      return target?.color.brightness === 51 &&
        preview.state === 'active' && preview.profileId === profile.id &&
        preview.targets.find((item) => item.displayId === ${JSON.stringify(guardedProductDisplayId)})?.color.brightness === 51 &&
        document.querySelector('[aria-label="Profile name"]')?.value === 'Smoke profile' &&
        document.querySelector('[aria-label="Profile name"]')?.disabled === false
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (cancelledState.result.value !== true) {
    throw new Error(
      'Discard did not discard a scheduled change while staying on the previewed profile.'
    )
  }

  await openProfileFromSidebar(debuggerClient, 'Smoke profile')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') !== null`,
    'The profile could not enter Edit mode for app-panel close coverage.'
  )
  await delay(20)
  const priorEmergencyRestoreCount = (
    standardOutput.match(/"eventName":"EmergencyRestoreCompleted"/g) ?? []
  ).length
  const priorRestoredNotificationCount = countLogMatches(/"title":"Original settings restored"/g)
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
  // A confirmed emergency restore leaves display control Paused (contract C3).
  await waitForLogCount(
    /"title":"Original settings restored"/g,
    priorRestoredNotificationCount,
    'The emergency restore did not report that ChromaShift is paused.'
  )
  await waitForExpression(
    debuggerClient,
    `(async () => {
       const result = await window.chromaShift.getState()
       return result.ok && result.value.chromaShift.status === 'paused' &&
         !result.value.chromaShift.transitionInProgress
    })()`,
    'The emergency restore did not leave display control Paused.'
  )
  await waitForExpression(debuggerClient,
    `document.querySelector('[data-part="paused-overlay"]')?.textContent?.includes('ChromaShift is paused') && document.querySelector('[data-part="main-panel"]')?.inert === true`,
    'Emergency restoration did not show the Paused overlay and block the Profiles pane.')
  await captureNativeWindow(electron.pid, join(screenshotDirectory, 'emergency-paused-native.png'))
  await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    join(scriptDirectory, 'capture-paused-tray.ps1'), '-CapturePath',
    join(screenshotDirectory, 'emergency-paused-tray-native.png')], { windowsHide: true, timeout: timeoutMilliseconds })
  await closeMainWindow(electron.pid)
  await waitForNoDebuggerTarget(debuggingPort, (candidate) => !candidate.url.includes('panel=mini'))
  // Renderer-free Toggle: resume from the emergency pause, then pause again.
  const priorActiveNotificationCount = countLogMatches(/"title":"ChromaShift active"/g)
  await pressToggleShortcut()
  await waitForLogCount(
    /"title":"ChromaShift active"/g,
    priorActiveNotificationCount,
    'The renderer-free toggle shortcut did not resume ChromaShift.'
  )
  const priorPausedNotificationCount = countLogMatches(/"title":"ChromaShift paused"/g)
  await pressToggleShortcut()
  await waitForLogCount(
    /"title":"ChromaShift paused"/g,
    priorPausedNotificationCount,
    'The renderer-free toggle shortcut did not pause ChromaShift.'
  )
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
         document.querySelector('[data-part="chromashift-control"][data-status="paused"]')?.textContent?.trim() === 'Paused'
    })()`,
    'The renderer-free Toggle ChromaShift shortcut did not enter Paused.'
  )
  // Render envelope edges and unsupported temperature while Paused. Restore the
  // fixture before Resume; corner values must never reach a display in this check.
  const pausedColorFixture = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok || result.value.chromaShift.status !== 'paused' || result.value.preview.state !== 'inactive') throw new Error('Paused color fixture requires confirmed restoration')
      const state = result.value
      const id = state.chromaShift.intendedTarget?.kind === 'profile' ? state.chromaShift.intendedTarget.profileId : 'default'
      const profile = state.configuration.profiles.find((profile) => profile.id === id)
      const target = { displayId: ${JSON.stringify(guardedProductDisplayId)}, color: { ...${JSON.stringify(neutralColorSettings)}, brightness: 100, gamma: 2.3, colorTemperature: 63 } }
      const saved = await window.chromaShift.saveProfile({ ...profile, displays: [target, ...profile.displays.filter((display) => display.displayId !== target.displayId)] })
      if (!saved.ok) throw new Error(saved.error.message)
      return { profile, theme: state.settings.theme }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const pausedColors = pausedColorFixture.result.value
  if (pausedColors?.profile === undefined)
    throw new Error('Could not prepare paused color presentation fixture')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')].find((item) => item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(pausedColors.profile.name)})?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]')?.value === ${JSON.stringify(pausedColors.profile.name)} && document.querySelector('[aria-label="Profile name"]')?.disabled === true`,
    'The paused color fixture was not selected'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(guardedDisplayTabSelector)})?.click()`
  })
  for (const theme of ['dark', 'light']) {
    await debuggerClient.send('Runtime.evaluate', {
      expression: `(async () => { const state = await window.chromaShift.getState(); await window.chromaShift.updateSettings({ ...state.value.settings, theme: '${theme}' }) })()`,
      awaitPromise: true
    })
    await waitForExpression(
      debuggerClient,
      `(() => { const row = document.querySelector(${JSON.stringify(guardedDisplayRowSelector)}); const hatch = row?.querySelector('[data-part="slider-disabled-upper"]');
      return document.documentElement.classList.contains('${theme}') && hatch && getComputedStyle(hatch).backgroundImage.includes('repeating-linear-gradient') && row.querySelector('[data-control="colorTemperature"] [data-part="color-value"]')?.textContent?.trim() === '63%' && row.querySelector('[data-control="gamma"] [role="slider"]')?.getAttribute('aria-disabled') === 'true'
    })()`,
      'Paused color controls did not expose temperature and hatched gamma limits'
    )
    await captureNativeWindow(
      electron.pid,
      join(screenshotDirectory, `color-controls-app-limits-${theme}-native.png`)
    )
  }
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => { const state = await window.chromaShift.getState(); await window.chromaShift.updateSettings({ ...state.value.settings, theme: ${JSON.stringify(pausedColors.theme)} }) })()`,
    awaitPromise: true
  })
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
  await waitForExpression(
    pausedMiniDebugger,
    `document.querySelector('[data-control="colorTemperature"] [data-part="color-value"]')?.textContent?.trim() === '63%' && document.querySelectorAll('[data-part="color-control"]').length === 6`,
    'The mini panel did not include its sixth color-temperature row'
  )
  await captureScreenshot(pausedMiniDebugger, pausedMiniScreenshotPath)
  await captureNativeWindow(electron.pid, nativeMiniScreenshotPath)
  await pausedMiniDebugger.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      window.__smokeTheme = state.value.settings.theme
      await window.chromaShift.updateSettings({ ...state.value.settings, theme: 'light' })
    })()`,
    awaitPromise: true
  })
  await waitForExpression(
    pausedMiniDebugger,
    `document.documentElement.classList.contains('light')`,
    'The mini panel did not adopt the light theme.'
  )
  await captureNativeWindow(electron.pid, join(screenshotDirectory, 'mini-panel-light-native.png'))
  await pausedMiniDebugger.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      await window.chromaShift.updateSettings({ ...state.value.settings, theme: window.__smokeTheme })
    })()`,
    awaitPromise: true
  })
  // Use the real fixed-size, non-activating native mini window for both its
  // footer trigger and picker rows. A renderer viewport cannot prove this fit.
  const longMiniName = 'A very long mini panel profile name that must end in an ellipsis instead of being clipped'
  await pausedMiniDebugger.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = (await window.chromaShift.getState()).value
      const id = state.chromaShift.intendedTarget?.profileId ?? 'default'
      window.__smokeMiniProfile = state.configuration.profiles.find((item) => item.id === id)
      const result = await window.chromaShift.saveProfile({ ...window.__smokeMiniProfile, name: ${JSON.stringify(longMiniName)} })
      if (!result.ok) throw new Error(result.error.message)
    })()`,
    awaitPromise: true
  })
  try {
    for (const theme of ['dark', 'light']) {
      await setTheme(pausedMiniDebugger, theme)
      await waitForExpression(pausedMiniDebugger, `(() => {
        const name = document.querySelector('[data-part="active-profile-name"]')
        const trigger = document.querySelector('[data-part="active-profile"]')
        return name?.textContent === ${JSON.stringify(longMiniName)} && name.scrollWidth > name.clientWidth &&
          getComputedStyle(name).textOverflow === 'ellipsis' && trigger.scrollWidth <= trigger.clientWidth + 1
      })()`, `The mini-panel trigger did not truncate the long name (${theme}).`)
      await hoverElement(pausedMiniDebugger, '[data-part="active-profile-name"]')
      await delay(600)
      await waitForExpression(pausedMiniDebugger, `document.querySelector('[role="tooltip"]') === null`,
        'The mini-panel profile name unexpectedly showed a tooltip.')
      await captureNativeWindow(electron.pid, join(screenshotDirectory, `mini-long-name-${theme}-native.png`))
      await pausedMiniDebugger.send('Runtime.evaluate', {
        expression: `document.querySelector('[data-part="active-profile"]')?.click()`
      })
      await waitForExpression(pausedMiniDebugger, `(() => {
        const name = [...document.querySelectorAll('[data-part="mini-profile-name"]')]
          .find((item) => item.textContent === ${JSON.stringify(longMiniName)})
        const row = name?.closest('[data-scope="radio-group"][data-part="item"]')
        return name !== undefined && name.scrollWidth > name.clientWidth &&
          getComputedStyle(name).textOverflow === 'ellipsis' && row.scrollWidth <= row.clientWidth + 1 &&
          document.querySelector('[role="tooltip"]') === null
      })()`, `The mini-panel picker did not truncate the long name (${theme}).`)
      await hoverElement(pausedMiniDebugger, '[data-part="mini-profile-name"]')
      await delay(600)
      await captureNativeWindow(electron.pid, join(screenshotDirectory, `mini-picker-long-name-${theme}-native.png`))
      await pausedMiniDebugger.send('Runtime.evaluate', {
        expression: `[...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Back')?.click()`
      })
      await waitForExpression(pausedMiniDebugger, `document.querySelector('[data-part="active-profile"]') !== null`,
        'The mini-panel picker did not return to controls.')
    }
  } finally {
    await pausedMiniDebugger.send('Runtime.evaluate', {
      expression: `(async () => {
        await window.chromaShift.saveProfile(window.__smokeMiniProfile)
        const state = (await window.chromaShift.getState()).value
        await window.chromaShift.updateSettings({ ...state.settings, theme: window.__smokeTheme })
      })()`,
      awaitPromise: true
    })
  }
  await pausedMiniDebugger.send('Runtime.evaluate', {
    expression: `(async () => { const state = await window.chromaShift.getState(); if (state.value.chromaShift.status !== 'paused') throw new Error('Color fixture must be restored before Resume'); const result = await window.chromaShift.saveProfile(${JSON.stringify(pausedColors.profile)}); if (!result.ok) throw new Error(result.error.message) })()`,
    awaitPromise: true
  })
  const restoredPausedMiniLoaded = pausedMiniDebugger.waitForEvent('Page.loadEventFired')
  await pausedMiniDebugger.send('Page.reload', { ignoreCache: true })
  await restoredPausedMiniLoaded
  await waitForExpression(
    pausedMiniDebugger,
    `document.querySelector('[data-part="slider-disabled-upper"]') === null && document.querySelector('[aria-label="Resume ChromaShift"]') !== null`,
    'The paused presentation fixture remained after restoring the saved profile'
  )
  for (const display of guardedDisplays) {
    const unchanged = await restorationGuard.getDisplayState(display.id)
    if (displayStateFingerprint(unchanged) !== guardedBaselines.get(display.id))
      throw new Error('Paused color presentation changed native display output')
  }
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
        document.querySelector('[data-part="chromashift-control"][data-status="paused"]')?.textContent?.trim() === 'Paused'
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
        document.querySelector('[aria-label="Profile name"]') !== null &&
        document.querySelector('[aria-label="Profile name"]')?.disabled === false
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
        document.querySelector('[data-part="profile-name"]')?.value === 'Default profile' &&
        document.querySelector('[data-part="mode-toggle"] [aria-label="Automatic"]')?.getAttribute('aria-pressed') === 'true' &&
        document.querySelector('[data-part="profile-nav"] [data-part="mode-toggle"]') !== null &&
        document.querySelector('[aria-label="Profile active"]') === null &&
        [...document.querySelectorAll('[data-part="profile-status"]')].some((item) => item.textContent === 'Live · Automatic')
    })()`,
    'Profile navigation did not remain independent of Automatic selection.'
  )
  await openProfileFromSidebar(debuggerClient, 'Smoke profile')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="chromashift-control"]')?.textContent?.trim() === 'Previewing: Smoke profile' &&
      document.querySelector('[data-part="profile-preview-badge"]') !== null`,
    'A non-live preview did not show its accent pill and eye badge.'
  )
  await selectAppActivation(debuggerClient, 'Manual')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const state = await window.chromaShift.getState()
      return state.ok && state.value.chromaShift.intendedMode.profileId === 'default' &&
        document.querySelector('[data-part="chromashift-control"]')?.textContent?.trim() === 'Active · Manual: Default profile'
    })()`,
    'Manual did not keep the live Default profile while another profile was previewed.'
  )
  await selectAppActivation(debuggerClient, 'Automatic')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="chromashift-control"]')?.textContent?.trim() === 'Active · Automatic'`,
    'Automatic did not update the status pill.'
  )
  const doubleClickRow = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      const row = [...document.querySelectorAll('[data-part="profile-select"]')].find(item => item.querySelector('strong')?.textContent === 'Smoke profile')
      const rect = row?.getBoundingClientRect()
      return rect ? { x: rect.left + 20, y: rect.top + rect.height / 2 } : null
    })()`,
    returnByValue: true
  })
  if (!doubleClickRow.result.value) throw new Error('Double-click row was unavailable.')
  for (const clickCount of [1, 2]) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await debuggerClient.send('Input.dispatchMouseEvent', {
        type,
        button: 'left',
        clickCount,
        ...doubleClickRow.result.value
      })
    }
  }
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      const profile = result.ok ? result.value.configuration.profiles.find((item) => item.id !== 'default') : undefined
      return result.ok && result.value.activation.mode.kind === 'manual' &&
        result.value.activation.mode.profileId === profile?.id &&
        result.value.activation.currentTarget?.profileId === profile?.id &&
        document.querySelector('[data-part="mode-toggle"] [aria-label="Manual"]')?.getAttribute('aria-pressed') === 'true' &&
        [...document.querySelectorAll('[data-part="profile-status"]')].some((item) => item.textContent === 'Live · Manual')
    })()`,
    'Use this profile did not establish Manual mode.'
  )
  const selectorShortcut = 'CommandOrControl+Alt+Shift+F7'
  const assignedSelectorShortcut = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok) return false
      const updated = await window.chromaShift.updateSettings({ ...result.value.settings,
        shortcutBindings: [
          ...result.value.settings.shortcutBindings.filter(binding => !['defaultProfile', 'automatic'].includes(binding.action.kind)),
          { action: { kind: 'defaultProfile' }, accelerator: 'CommandOrControl+Alt+Shift+F6' },
          { action: { kind: 'automatic' }, accelerator: ${JSON.stringify(selectorShortcut)} }
        ]
      })
      return updated.ok
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (assignedSelectorShortcut.result.value !== true)
    throw new Error('Could not assign tooltip shortcuts.')
  await focusTooltip(
    debuggerClient,
    '[data-part="mode-toggle"] [aria-label="Automatic"]',
    'Automatic (Ctrl+Alt+Shift+F7)'
  )
  // Expanded names show a tooltip only when truncated. Check the profile
  // shortcut on the collapsed rail, whose row tooltip is always available.
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Collapse sidebar"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="profile-nav"]')).width === '40px'`,
    'The sidebar did not collapse for the profile-shortcut tooltip check.'
  )
  await focusTooltip(
    debuggerClient,
    '[data-reorder-id="default"] [data-part="profile-select"]',
    'Ctrl+Alt+Shift+F6'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Expand sidebar"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="profile-nav"]')).width !== '40px'`,
    'The sidebar did not expand after the profile-shortcut tooltip check.'
  )
  await debuggerClient.send('Runtime.evaluate', { expression: 'document.activeElement?.blur()' })
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) throw new Error('Could not read shortcut settings')
      const profile = state.value.configuration.profiles.find((item) => item.name === 'Smoke profile')
      const result = await window.chromaShift.updateSettings({ ...state.value.settings, shortcutBindings: [
        ...state.value.settings.shortcutBindings,
        { action: { kind: 'profile', profileId: profile.id }, accelerator: 'CommandOrControl+Alt+Shift+F8' }
      ] })
      if (!result.ok) throw new Error(result.error.message)
    })()`,
    awaitPromise: true
  })
  await selectProfileMenuItem(debuggerClient, 'Smoke profile', 'Disable profile')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="alertdialog"]')?.textContent?.includes('Its shortcut')`,
    'Disabling a bound profile did not open the shortcut-removal dialog.'
  )
  await clickAppButton(debuggerClient, 'Cancel', '[role="alertdialog"]')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="alertdialog"]') === null`,
    'The disable dialog did not cancel.'
  )
  await selectProfileMenuItem(debuggerClient, 'Smoke profile', 'Disable profile')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="alertdialog"]') !== null`,
    'The disable dialog did not reopen.'
  )
  await clickAppButton(debuggerClient, 'Disable', '[role="alertdialog"]')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      const profile = result.ok ? result.value.configuration.profiles.find((item) => item.id !== 'default') : undefined
      return result.ok && profile?.enabled === false && result.value.activation.mode.kind === 'automatic' &&
        !result.value.settings.shortcutBindings.some((binding) => binding.action.kind === 'profile' && binding.action.profileId === profile.id) &&
        result.value.activation.currentTarget?.profileId === 'default' &&
        [...document.querySelectorAll('[data-part="profile-status"]')].some((item) => item.textContent === 'Disabled')
    })()`,
    'Disabling the current profile did not return to Automatic.'
  )
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="profile-item"][data-disabled] [data-part="profile-disabled-badge"]') !== null &&
      document.querySelector('[data-part="profile-item"][data-disabled] .lucide-palette') !== null`,
    'The disabled profile lost its own image or disabled badge.'
  )
  await selectMenuItem(debuggerClient, 'More profile actions', 'Enable profile')
  await selectAppActivation(debuggerClient, 'Smoke profile')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')]
      .find((item) => item.querySelector('strong')?.textContent === 'Default profile')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="profile-name"]')?.value === 'Default profile' &&
      document.querySelector('[data-part="mode-toggle"] [aria-label="Manual"]')?.getAttribute('aria-pressed') === 'true'`,
    'Browsing Default changed the manual selection.'
  )
  await selectAppActivation(debuggerClient, 'Automatic')
  await selectAppActivation(debuggerClient, 'Default profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.activation.mode.kind === 'manual' &&
        result.value.activation.mode.profileId === 'default' &&
        document.querySelector('[data-part="chromashift-control"]')?.textContent?.trim() === 'Active · Manual: Default profile'
    })()`,
    'Default could not be selected manually.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Pause ChromaShift"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="chromashift-control"]')?.textContent?.trim() === 'Paused' &&
      [...document.querySelectorAll('[data-part="profile-status"]')].some((item) => item.textContent === 'Paused · Manual')`,
    'Paused display control was presented as a current applied profile.'
  )
  await selectAppActivation(debuggerClient, 'Automatic')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.chromaShift.status === 'paused' &&
        !result.value.chromaShift.transitionInProgress &&
        result.value.chromaShift.intendedMode.kind === 'automatic'
    })()`,
    'Selecting Automatic while Paused resumed display control or lost the selection.'
  )
  await selectAppActivation(debuggerClient, 'Default profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.chromaShift.status === 'paused' &&
        !result.value.chromaShift.transitionInProgress &&
        result.value.chromaShift.intendedMode.kind === 'manual' &&
        result.value.chromaShift.intendedMode.profileId === 'default'
    })()`,
    'Selecting a manual profile while Paused resumed display control or lost the selection.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Resume ChromaShift"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.chromaShift.status === 'active' &&
        result.value.activation.mode.kind === 'manual' &&
        result.value.activation.mode.profileId === 'default'
    })()`,
    'Resume did not apply the profile selected while Paused.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Collapse sidebar"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector('[data-part="profile-nav"]')).width === '40px' &&
      document.querySelector('[data-part="mode-toggle"] [aria-label="Automatic"]')?.textContent === 'A' &&
      document.querySelector('[data-part="mode-toggle"] [aria-label="Manual"]')?.textContent === 'M' &&
      (() => {
        const toggle = document.querySelector('[data-part="mode-toggle"]').getBoundingClientRect()
        return [...document.querySelectorAll('[data-part="mode-toggle"] button')].every(button => {
          const rect = button.getBoundingClientRect()
          return rect.left >= toggle.left && rect.right <= toggle.right && rect.width > 0
        })
      })()`,
    'The collapsed A | M toggle did not fit the 40px rail.'
  )
  await selectAppActivation(debuggerClient, 'Automatic')
  await selectAppActivation(debuggerClient, 'Manual')
  await selectAppActivation(debuggerClient, 'Automatic')
  await focusTooltip(
    debuggerClient,
    '[data-part="mode-toggle"] [aria-label="Automatic"]',
    'Automatic (Ctrl+Alt+Shift+F7)'
  )
  await captureNativeWindow(
    electron.pid,
    join(screenshotDirectory, 'mode-toggle-collapsed-native.png')
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Expand sidebar"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="mode-toggle"] [aria-label="Automatic"]')?.getAttribute('aria-pressed') === 'true'`,
    'Automatic selection was unavailable in the collapsed sidebar.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')]
      .find((item) => item.querySelector('strong')?.textContent === 'Smoke profile')?.click()`
  })

  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active'
    })()`,
    'The profile could not be previewed before changing selection.'
  )
  await clickAppButton(debuggerClient, 'Use this profile', '[data-part="preview-banner"]')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' && result.value.activation.mode.kind === 'manual'
    })()`,
    'Manual selection did not safely leave Preview.'
  )
  await selectAppActivation(debuggerClient, 'Automatic')

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

  // Empty-target Preview must hold Original settings, then restore the live
  // manual profile exactly. Read real state through the independent guard.
  const liveProfileFingerprints = new Map()
  for (const display of guardedDisplays) {
    const fingerprint = displayStateFingerprint(await restorationGuard.getDisplayState(display.id))
    if (fingerprint === guardedBaselines.get(display.id)) {
      throw new Error('The empty-target preview fixture did not start over a colored live profile.')
    }
    liveProfileFingerprints.set(display.id, fingerprint)
  }
  const emptyPreviewFixture = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const created = await window.chromaShift.createProfile('Original settings preview check')
      if (!created.ok) return created
      return window.chromaShift.saveProfile({ ...created.value, displays: [] })
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (
    emptyPreviewFixture.result.value?.ok !== true ||
    emptyPreviewFixture.result.value.value.displays.length !== 0
  ) {
    throw new Error('Could not create an empty-target preview fixture.')
  }
  const emptyPreviewProfileId = emptyPreviewFixture.result.value.value.id
  await openProfileFromSidebar(debuggerClient, 'Original settings preview check')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok) return false
      const state = result.value
      const live = state.configuration.profiles.find((profile) => profile.name === 'Smoke profile')
      return state.preview.state === 'active' && state.preview.kind === 'preview' &&
        state.preview.profileId === ${JSON.stringify(emptyPreviewProfileId)} &&
        state.preview.targets.length === 0 && state.activation.mode.kind === 'manual' &&
        state.activation.mode.profileId === live?.id &&
        document.querySelector('[data-part="preview-banner"]')?.textContent?.includes('Original settings preview check')
    })()`,
    'An empty-target profile did not start a real Preview while preserving the live manual target.'
  )
  for (const display of guardedDisplays) {
    const expected = guardedBaselines.get(display.id)
    const state = await waitForRestoredDisplayState(restorationGuard, display.id, expected)
    if (displayStateFingerprint(state) !== expected) {
      throw new Error(
        `Empty-target Preview did not restore Original settings on ${display.connection}.`
      )
    }
  }
  await captureNativeWindow(
    electron.pid,
    join(screenshotDirectory, 'empty-target-preview-native.png')
  )
  await clickAppButton(debuggerClient, 'End preview', '[data-part="preview-banner"]')
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      if (!result.ok) return false
      const live = result.value.configuration.profiles.find((profile) => profile.name === 'Smoke profile')
      return result.value.preview.state === 'inactive' &&
        result.value.activation.mode.kind === 'manual' &&
        result.value.activation.mode.profileId === live?.id &&
        document.querySelector('[aria-label="Profile name"]')?.value === 'Smoke profile' &&
        document.querySelector('[aria-label="Profile name"]')?.disabled === false
    })()`,
    'End preview of an empty-target profile did not return to the live manual profile.'
  )
  for (const display of guardedDisplays) {
    const expected = liveProfileFingerprints.get(display.id)
    const state = await waitForRestoredDisplayState(restorationGuard, display.id, expected)
    if (displayStateFingerprint(state) !== expected) {
      throw new Error(
        `End preview did not reapply the exact live profile state on ${display.connection}.`
      )
    }
  }
  const removedEmptyPreviewFixture = await debuggerClient.send('Runtime.evaluate', {
    expression: `window.chromaShift.deleteProfile(${JSON.stringify(emptyPreviewProfileId)})`,
    awaitPromise: true,
    returnByValue: true
  })
  if (removedEmptyPreviewFixture.result.value?.ok !== true) {
    throw new Error('Could not remove the empty-target preview fixture.')
  }
  globalThis.console.log(
    'Empty-target preview restored Original settings and returned to the exact live profile state.'
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

  await selectAppActivation(debuggerClient, 'Automatic')
  await openProfileFromSidebar(debuggerClient, 'Smoke profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
    const result = await window.chromaShift.getState()
    return result.ok && result.value.preview.state === 'active' &&
      result.value.preview.kind === 'preview' &&
      document.querySelector(':has(> [data-part="main-panel"]) + [data-part="preview-banner"]')?.textContent?.includes('Previewing: Smoke profile')
  })()`,
    'Clicking a profile did not start Preview or show the banner.'
  )
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="chromashift-control"]')?.textContent?.trim() === 'Previewing: Smoke profile' &&
      document.querySelector('[data-part="profile-item"][data-selected] [data-part="profile-preview-badge"]') !== null`,
    'The preview pill or eye badge did not name the non-live profile.'
  )
  await captureNativeWindow(electron.pid, join(screenshotDirectory, 'profile-preview-native.png'))
  await verifyPreviewToPreviewBanner(debuggerClient)
  const visualFixture = await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      if (!state.ok) throw new Error('Could not read theme')
      const created = await window.chromaShift.createProfile('Disabled profile with a deliberately long name to check title bar truncation')
      if (!created.ok) throw new Error(created.error.message)
      const disabled = await window.chromaShift.saveProfile({ ...created.value, enabled: false })
      if (!disabled.ok) throw new Error(disabled.error.message)
      return { id: created.value.id, theme: state.value.settings.theme }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (!visualFixture.result.value?.id) throw new Error('Could not create native visual fixture.')
  await openProfileFromSidebar(
    debuggerClient,
    'Disabled profile with a deliberately long name to check title bar truncation'
  )
  await waitForExpression(
    debuggerClient,
    `(() => {
      const pill = document.querySelector('[data-part="chromashift-control"]')
      const label = pill?.querySelector('span')
      const panelToggle = document.querySelector('[data-part="panel-toggle"]')
      return pill?.textContent?.startsWith('Previewing: Disabled profile') &&
        label && label.scrollWidth > label.clientWidth && getComputedStyle(label).textOverflow === 'ellipsis' &&
        pill.getBoundingClientRect().right < panelToggle.getBoundingClientRect().left
    })()`,
    'The long preview label did not truncate before the panel toggle.'
  )
  for (const theme of ['dark', 'light']) {
    await debuggerClient.send('Runtime.evaluate', {
      expression: `(async () => {
        const state = await window.chromaShift.getState()
        const updated = await window.chromaShift.updateSettings({ ...state.value.settings, theme: ${JSON.stringify(theme)} })
        if (!updated.ok) throw new Error(updated.error.message)
      })()`,
      awaitPromise: true
    })
    await waitForExpression(
      debuggerClient,
      `document.documentElement.classList.contains(${JSON.stringify(theme)})`,
      'The native capture theme did not settle.'
    )
    await waitForExpression(
      debuggerClient,
      `(() => {
        const nav = document.querySelector('[data-part="profile-nav"]').getBoundingClientRect()
        const row = document.querySelector('[data-part="profile-item"][data-selected]')
        const name = row?.querySelector('strong')
        return row && row.getBoundingClientRect().right <= nav.right + 1 &&
          name && name.scrollWidth > name.clientWidth && getComputedStyle(name).textOverflow === 'ellipsis' &&
          row.querySelector('[data-part="profile-actions-trigger"]').getBoundingClientRect().right <= nav.right + 1
      })()`,
      'The long sidebar name overflowed its rail or hid its row actions.'
    )
    await captureNativeWindow(
      electron.pid,
      join(screenshotDirectory, `phase3-${theme}-expanded-native.png`)
    )
    await captureNativeWindow(
      electron.pid,
      join(screenshotDirectory, `color-controls-app-${theme}-native.png`)
    )
    await debuggerClient.send('Runtime.evaluate', {
      expression: `document.querySelector('[aria-label="Collapse sidebar"]')?.click()`
    })
    await waitForExpression(
      debuggerClient,
      `getComputedStyle(document.querySelector('[data-part="profile-nav"]')).width === '40px' &&
        document.querySelector('[data-part="profile-live-ring"]') !== null &&
        document.querySelector('[data-part="profile-preview-badge"]') !== null &&
        document.querySelector('[data-part="profile-disabled-badge"]') !== null`,
      'Collapsed rail lost its live, preview or disabled markers.'
    )
    await captureNativeWindow(
      electron.pid,
      join(screenshotDirectory, `phase3-${theme}-collapsed-native.png`)
    )
    await debuggerClient.send('Runtime.evaluate', {
      expression: `document.querySelector('[aria-label="Expand sidebar"]')?.click()`
    })
  }
  await openProfileFromSidebar(debuggerClient, 'Smoke profile')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      await window.chromaShift.deleteProfile(${JSON.stringify(visualFixture.result.value.id)})
      const state = await window.chromaShift.getState()
      await window.chromaShift.updateSettings({ ...state.value.settings, theme: ${JSON.stringify(visualFixture.result.value.theme)} })
    })()`,
    awaitPromise: true
  })
  const unrelatedProfile = await debuggerClient.send('Runtime.evaluate', {
    expression: `window.chromaShift.createProfile('Delete unselected focus check')`,
    awaitPromise: true,
    returnByValue: true
  })
  if (unrelatedProfile.result.value?.ok !== true) {
    throw new Error('Could not create the unselected delete-focus fixture.')
  }
  await waitForExpression(
    debuggerClient,
    `[...document.querySelectorAll('[data-part="profile-select"] strong')]
      .some((item) => item.textContent?.trim() === 'Delete unselected focus check')`,
    'The unselected delete-focus fixture did not render.'
  )
  for (const decision of ['Cancel', 'Delete profile']) {
    await selectProfileMenuItem(debuggerClient, 'Delete unselected focus check', 'Delete')
    await waitForExpression(
      debuggerClient,
      `document.querySelector('[role="alertdialog"]')?.textContent?.includes('Delete unselected focus check') === true`,
      'Unselected profile deletion did not open the confirmation dialog.'
    )
    // A visible dialog can precede its focus scope initialization. Wait for
    // the documented initial Cancel focus before taking either human action.
    await waitForExpression(
      debuggerClient,
      `document.activeElement?.closest('[role="alertdialog"]') !== null &&
        document.activeElement?.textContent?.trim() === 'Cancel'`,
      'The unselected-profile dialog did not focus its Cancel action.'
    )
    await clickAppButton(debuggerClient, decision, '[role="alertdialog"]')
    await waitForExpression(
      debuggerClient,
      `(async () => {
        const result = await window.chromaShift.getState()
        if (!result.ok || document.querySelector('[data-scope="dialog"]') !== null) return false
        const state = result.value
        const previewed = state.configuration.profiles.find((item) => item.name === 'Smoke profile')
        const unrelatedExists = state.configuration.profiles.some((item) => item.name === 'Delete unselected focus check')
        return unrelatedExists === ${decision === 'Cancel'} &&
          state.preview.state === 'active' && state.preview.kind === 'preview' &&
          state.preview.profileId === previewed?.id &&
          document.querySelector('[aria-label="Profile name"]')?.value === 'Smoke profile' &&
          document.activeElement?.matches('[data-part="profile-item"][data-selected] [data-part="profile-select"]') === true
      })()`,
      `${decision} on an unselected profile lost the open preview, selection, or keyboard focus.`
    )
  }
  await clickAppButton(debuggerClient, 'End preview', '[data-part="preview-banner"]')
  await waitForExpression(
    debuggerClient,
    `(async () => {
    const result = await window.chromaShift.getState()
    return result.ok && result.value.preview.state === 'inactive' &&
      document.querySelector('[aria-label="Profile name"]')?.value === 'Default profile'
  })()`,
    'End preview did not cancel and select the live profile.'
  )
  await openProfileFromSidebar(debuggerClient, 'Smoke profile')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      document.querySelector('[data-part="profile-title"]')?.click()
      const input = document.querySelector('[aria-label="Profile name"]')
      input?.focus(); input?.select()
    })()`
  })
  await waitForExpression(
    debuggerClient,
    `document.activeElement?.getAttribute('aria-label') === 'Profile name'`,
    'The inline profile name input did not receive focus.'
  )
  await debuggerClient.send('Input.insertText', { text: 'Smoke profile unsaved' })
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
    `(async () => {
    const result = await window.chromaShift.getState()
    return result.ok && result.value.preview.state === 'active' &&
      result.value.preview.kind === 'edit' &&
      document.querySelector('[data-part="chromashift-control"]')?.textContent?.includes('Auto-switching on hold') &&
      document.querySelector('[data-part="profile-item"][data-selected] strong')?.textContent?.includes('•')
  })()`,
    'The first change did not promote Preview to Edit or mark unsaved changes.'
  )
  await captureNativeWindow(
    electron.pid,
    join(screenshotDirectory, 'profile-dirty-header-native.png')
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Collapse sidebar"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="profile-item"][data-selected] [aria-label="Unsaved changes"]') !== null`,
    'The collapsed dirty profile lost its unsaved dot.'
  )
  await captureNativeWindow(
    electron.pid,
    join(screenshotDirectory, 'phase3-dirty-collapsed-native.png')
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Expand sidebar"]')?.click()`
  })
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="mode-toggle"] [aria-label="Manual"]')?.click()`
  })
  await answerUnsavedChanges(debuggerClient, 'Cancel')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="mode-toggle"] [aria-label="Automatic"]')?.getAttribute('aria-pressed') === 'true' &&
      document.querySelector('[aria-label="Profile name"]')?.value === 'Smoke profile unsaved'`,
    'Cancelling a mode change did not preserve Automatic and its draft.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Settings"]')?.click()`
  })
  await answerUnsavedChanges(debuggerClient, 'Cancel')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]')?.value === 'Smoke profile unsaved'`,
    'Cancel did not retain the draft and profile view.'
  )
  // Main-requested navigation uses the same guard as Settings clicks.
  await debuggerClient.send('Runtime.evaluate', {
    expression: `window.chromaShift.openAppPanel('settings')`,
    awaitPromise: true
  })
  await answerUnsavedChanges(debuggerClient, 'Discard changes')
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="settings-nav"]') !== null`,
    'Discard did not continue main-requested Settings navigation.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `window.chromaShift.openAppPanel('profiles')`,
    awaitPromise: true
  })
  await openProfileFromSidebar(debuggerClient, 'Smoke profile')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => { document.querySelector('[data-part="profile-title"]')?.click()
      const input = document.querySelector('[aria-label="Profile name"]'); input?.focus(); input?.select() })()`
  })
  await waitForExpression(
    debuggerClient,
    `document.activeElement?.getAttribute('aria-label') === 'Profile name'`,
    'The inline profile name input did not receive focus.'
  )
  await debuggerClient.send('Input.insertText', { text: 'Smoke profile updated' })
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
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Settings"]')?.click()`
  })
  await answerUnsavedChanges(debuggerClient, 'Update profile')
  await waitForExpression(
    debuggerClient,
    `(async () => {
    const state = await window.chromaShift.getState()
    return state.ok && state.value.preview.state === 'inactive' &&
      state.value.configuration.profiles.some((item) => item.name === 'Smoke profile updated') &&
      document.querySelector('[data-part="settings-nav"]') !== null
  })()`,
    'Update profile did not save and continue navigation.'
  )
  // Restore the fixture name for the remaining mini-panel checks.
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      const profile = state.ok && state.value.configuration.profiles.find((item) => item.name === 'Smoke profile updated')
      const saved = profile && await window.chromaShift.saveProfile({ ...profile, name: 'Smoke profile' })
      if (!saved?.ok) throw new Error('Could not restore the profile name fixture')
      await window.chromaShift.openAppPanel('profiles')
    })()`,
    awaitPromise: true
  })
  await openProfileFromSidebar(debuggerClient, 'Smoke profile')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-select"]')]
      .find((item) => item.querySelector('strong')?.textContent?.trim() === 'Default profile')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
    const result = await window.chromaShift.getState()
    return result.ok && result.value.preview.state === 'inactive' &&
      result.value.activation.mode.kind === 'automatic' &&
      document.querySelector('[aria-label="Profile name"]')?.value === 'Default profile'
  })()`,
    'Clicking the live profile did not end Preview and preserve activation mode.'
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
    `document.querySelector('[data-part="profile-name"]')?.value === 'Delete focus check'`,
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
  await captureNativeWindow(
    electron.pid,
    join(screenshotDirectory, 'delete-profile-dialog-native.png')
  )
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

  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') !== null`,
    'The remaining profile did not enter Edit mode after deletion.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-part="profile-title"]')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]')?.hidden === false`,
    'Inline naming did not open after deletion.'
  )
  const nameInputBounds = await debuggerClient.send('Runtime.evaluate', {
    expression: `(() => {
      document.querySelector('[data-part="profile-title"]')?.click()
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
  await waitForExpression(
    debuggerClient,
    `document.activeElement?.getAttribute('aria-label') === 'Profile name'`,
    'The inline profile name input did not receive focus.'
  )
  await debuggerClient.send('Input.insertText', { text: 'Default after delete' })
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
    `document.querySelector('[aria-label="Profile name"]')?.value === 'Default after delete'`,
    'The profile name input did not accept keyboard text after another profile was deleted.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="profile-detail"] header [data-part="unsaved-changes-actions"] button')]
      .find((candidate) => candidate.textContent?.trim() === 'Discard changes')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[aria-label="Profile name"]') !== null`,
    'Delete-focus coverage did not discard unsaved changes.'
  )

  await selectAppActivation(debuggerClient, 'Smoke profile')
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
        document.body.innerText.includes('Discard changes')
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

  // An unsaved override must open Profiles even if Settings was remembered.
  await debuggerClient.send('Emulation.clearDeviceMetricsOverride')
  await debuggerClient.send('Runtime.evaluate', {
    expression: `localStorage.setItem('chromashift.app-panel.view', 'settings');
      history.replaceState({}, '', location.pathname)`
  })
  const overrideAppLoaded = debuggerClient.waitForEvent('Page.loadEventFired')
  await debuggerClient.send('Page.reload', { ignoreCache: true })
  await overrideAppLoaded
  await waitForExpression(
    debuggerClient,
    `
    document.querySelector('[data-part="chromashift-control"]')?.textContent?.includes('Auto-switching on hold') &&
    document.querySelector('[data-part="profile-detail"] [role="slider"]')?.getAttribute('aria-valuenow') === '56' &&
    document.querySelector('[data-part="unsaved-changes-actions"]')?.textContent?.includes('Update profile') &&
    document.querySelector('[data-part="unsaved-changes-actions"]')?.textContent?.includes('Discard changes') &&
    document.querySelector('[data-part="override-banner"]') === null &&
    document.querySelector('[data-scope="dialog"]') === null`,
    'The app did not show the mini-panel override in its normal editable profile view.'
  )
  await captureNativeWindow(electron.pid, join(screenshotDirectory, 'app-override-hold-native.png'))
  await delay(400)
  await waitForExpression(debuggerClient, `(async () => {
    const result = await window.chromaShift.getState()
    return result.ok && result.value.preview.state === 'active' && result.value.preview.kind === 'override'
  })()`, 'Opening the app unnecessarily promoted the unchanged mini-panel override.')

  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Discard changes')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        result.value.activation.mode.kind === 'manual'
    })()`,
    'Discard changes did not restore the saved manual profile after mini-panel coverage.'
  )

  // Repeat with Update and assert persistence, then restore the smoke fixture.
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.chromaShift.getState()
      const profile = state.value.configuration.profiles.find((item) => item.id !== 'default')
      window.__smokeOverrideSaved = profile
      const draft = structuredClone(profile)
      draft.displays.find((target) => target.displayId === ${JSON.stringify(guardedProductDisplayId)}).color.brightness = 56
      const result = await window.chromaShift.startPreview(draft, 'override')
      if (!result.ok) throw new Error(result.error.message)
    })()`,
    awaitPromise: true
  })
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="unsaved-changes-actions"]')?.textContent?.includes('Update profile')`,
    'The second override did not expose Update profile.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('[data-part="unsaved-changes-actions"] button')].find((button) => button.textContent?.trim() === 'Update profile')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
    const state = await window.chromaShift.getState()
    return state.ok && state.value.preview.state === 'inactive' &&
      state.value.configuration.profiles.find((profile) => profile.id !== 'default')?.displays.find((target) => target.displayId === ${JSON.stringify(guardedProductDisplayId)})?.color.brightness === 56
  })()`,
    'Update profile did not persist the mini-panel override.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      const result = await window.chromaShift.saveProfile(window.__smokeOverrideSaved)
      if (!result.ok) throw new Error(result.error.message)
      history.replaceState({}, '', location.pathname + '?panel=mini')
    })()`,
    awaitPromise: true
  })
  const overrideMiniLoaded = debuggerClient.waitForEvent('Page.loadEventFired')
  await debuggerClient.send('Page.reload', { ignoreCache: true })
  await overrideMiniLoaded
  await waitForText(debuggerClient, 'Manually selected')

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
    expression: `document.querySelector('[data-control="brightness"] [data-part="color-value"]')?.click()`
  })
  await waitForExpression(debuggerClient, `(() => {
    const row = document.querySelector('[data-control="brightness"]')
    const value = row?.querySelector('[data-part="color-value"]')
    return value?.tagName === 'P' && value.textContent.trim() === '50%' &&
      value.parentElement.querySelector('input') === null
  })()`, 'Mini-panel values did not remain plain text after a click.')
  // getState can see the first override before its broadcast reaches React.
  // The mini-panel power color changes to amber only when that state renders.
  await debuggerClient.send('Runtime.evaluate', {
    expression: `window.__smokeDefaultControlColor = getComputedStyle(
      document.querySelector('[data-part="chromashift-control"]')
    ).color`
  })
  await debuggerClient.send('Runtime.evaluate', {
    expression: `document.querySelector('[data-control="brightness"] [data-slot="slider"]')?.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'active' &&
        result.value.preview.kind === 'override' &&
        result.value.preview.targets[0]?.color.brightness === 51 &&
        getComputedStyle(document.querySelector('[data-part="chromashift-control"]')).color !== window.__smokeDefaultControlColor &&
        document.querySelector('[data-part="color-control"] [role="slider"]')?.getAttribute('aria-valuenow') === '51' &&
        document.querySelector('[data-control="brightness"] [aria-label="Reset to neutral"]') !== null
    })()`,
    'Changing Default brightness did not start the mini-panel override.'
  )
  await debuggerClient.send('Runtime.evaluate', {
    expression: `(async () => {
      // Let effects from the matching product render hydrate the draft first.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      delete window.__smokeDefaultControlColor
      document.querySelector('[data-control="brightness"] [aria-label="Reset to neutral"]')?.click()
    })()`,
    awaitPromise: true
  })
  try {
    await waitForExpression(
      debuggerClient,
      `(async () => {
        const result = await window.chromaShift.getState()
        return result.ok && result.value.preview.state === 'active' &&
          result.value.preview.targets[0]?.color.brightness === 50 &&
          document.querySelector('[data-control="brightness"] [aria-label="Reset to neutral"]') === null
      })()`,
      'The Default brightness reset did not restore the neutral value.'
    )
  } catch (error) {
    // Failure-only evidence for #81. Keep the reset assertion and timing intact.
    try {
      const snapshot = await debuggerClient.send('Runtime.evaluate', {
        expression: `(async () => {
          const state = await window.chromaShift.getState()
          const reset = document.querySelector('[data-control="brightness"] [aria-label="Reset to neutral"]')
          const slider = document.querySelector('[data-part="color-control"] [role="slider"]')
          return {
            preview: state.ok ? state.value.preview : state.error,
            control: state.ok ? state.value.chromaShift : null,
            focused: document.activeElement?.outerHTML.slice(0, 800),
            reset: reset?.outerHTML,
            slider: slider?.outerHTML,
            profile: document.querySelector('[data-part="active-profile"]')?.textContent,
            alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent)
          }
        })()`,
        awaitPromise: true,
        returnByValue: true
      })
      globalThis.console.error('Default brightness reset failure snapshot: ' + JSON.stringify(snapshot.result.value))
    } catch (diagnosticError) {
      globalThis.console.error('Default brightness reset snapshot unavailable: ' + diagnosticError.message)
    }
    throw error
  }
  await debuggerClient.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Discard changes')?.click()`
  })
  await waitForExpression(
    debuggerClient,
    `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok && result.value.preview.state === 'inactive' &&
        !document.body.innerText.includes('Update profile') &&
        !document.body.innerText.includes('Discard changes')
    })()`,
    'Discard changes did not discard the neutral Default-profile override session.'
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

  await verifyNativeQuitPrompt(debuggerClient)

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
}

let smokeFailure
try {
  await runSmoke()
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
    await waitForExit(electron).catch((exitError) => {
      smokeFailure ??= exitError
    })
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
  cleanupDevelopmentShortcut(electronPath)
  if (await pathExists(developmentElectronShortcut)) {
    // A shortcut for a different Electron application is intentionally preserved.
    globalThis.console.log('Preserved the existing Electron shortcut owned by another application.')
  }
}

if (smokeFailure !== undefined) {
  if (standardOutput !== '') globalThis.console.error(`Electron stdout:\n${standardOutput}`)
  if (standardError !== '') globalThis.console.error(`Electron stderr:\n${standardError}`)
  throw smokeFailure
}
