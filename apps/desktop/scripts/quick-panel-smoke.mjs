import { execFile as execFileCallback, spawn } from 'node:child_process'
import console from 'node:console'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const execFile = promisify(execFileCallback)
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const win32Script = join(scriptDirectory, 'quick-panel-win32.ps1')
const foregroundProbeScript = join(scriptDirectory, 'quick-panel-foreground-probe.ps1')
const timeoutMilliseconds = 15_000
const noActivateStyle = 0x08000000n

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function withTimeout(promise, description) {
  let timeout
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${description}.`)),
      timeoutMilliseconds
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
  if (address === null || typeof address === 'string') throw new Error('Could not reserve a port.')
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return address.port
}

async function waitForTarget(port, predicate) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const target = (await response.json()).find(
          (candidate) => candidate.type === 'page' && predicate(candidate)
        )
        if (target?.webSocketDebuggerUrl !== undefined) return target
      }
    } catch {
      // Electron has not exposed this target yet.
    }
    await delay(100)
  }
  throw new Error('Electron did not expose the expected renderer target.')
}

async function connectToDebugger(url) {
  const socket = new globalThis.WebSocket(url)
  await withTimeout(new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', reject, { once: true })
  }), 'the renderer debugger connection')
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id === undefined) return
    const request = pending.get(message.id)
    if (request === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      const id = nextId++
      const response = new Promise((resolveResponse, reject) => {
        pending.set(id, { resolve: resolveResponse, reject })
      })
      socket.send(JSON.stringify({ id, method, params }))
      return withTimeout(response, method)
    }
  }
}

async function runWin32(mode, argumentsByName = {}) {
  const argumentsList = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', win32Script,
    '-Mode', mode
  ]
  for (const [name, value] of Object.entries(argumentsByName)) {
    argumentsList.push(`-${name}`, String(value))
  }
  const result = await execFile('powershell.exe', argumentsList, { windowsHide: true })
  const values = result.stdout.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return values.at(-1) ?? ''
}

async function foregroundHandle() {
  return BigInt(await runWin32('foreground'))
}

async function waitForProbeHandle(probe) {
  let output = ''
  probe.stdout.setEncoding('utf8')
  probe.stdout.on('data', (data) => { output += data })
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    const match = output.match(/\d+/)
    if (match !== null) return BigInt(match[0])
    if (probe.exitCode !== null) throw new Error(`Foreground probe exited with ${probe.exitCode}.`)
    await delay(50)
  }
  throw new Error('Foreground probe did not expose its window handle.')
}

async function waitForPanelEvent(readOutput) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    for (const line of readOutput().split(/\r?\n/)) {
      if (!line.includes('QuickPanelSpikeShown')) continue
      try {
        const event = JSON.parse(line)
        if (event.eventName === 'QuickPanelSpikeShown') return event
      } catch {
        // Ignore unrelated native-service output.
      }
    }
    await delay(50)
  }
  throw new Error('The quick panel did not report its native window state.')
}

async function waitForExpression(debuggerClient, expression, description) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    const evaluation = await debuggerClient.send('Runtime.evaluate', {
      expression,
      returnByValue: true
    })
    if (evaluation.result.value === true) return
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${description}.`)
}

const debuggingPort = await reservePort()
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'chromashift-quick-panel-'))
const userDataDirectory = join(temporaryDirectory, 'user-data')
const keystrokeLogPath = join(temporaryDirectory, 'keystrokes.txt')
const environment = {
  ...process.env,
  CHROMASHIFT_QUICK_PANEL_SPIKE: '1',
  CHROMASHIFT_QUICK_PANEL_SPIKE_DELAY_MS: '3000'
}
delete environment.ELECTRON_RUN_AS_NODE

let electronOutput = ''
let electronError = ''
const electron = spawn(electronPath, [
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${userDataDirectory}`,
  '.'
], {
  cwd: desktopDirectory,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})
electron.stdout.setEncoding('utf8')
electron.stderr.setEncoding('utf8')
electron.stdout.on('data', (data) => { electronOutput += data })
electron.stderr.on('data', (data) => { electronError += data })

const foregroundProbe = spawn('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-STA',
  '-File', foregroundProbeScript,
  '-KeystrokeLogPath', keystrokeLogPath
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

let mainDebugger
let panelDebugger
let failure
try {
  const mainTarget = await waitForTarget(debuggingPort, (target) => !target.url.includes('panel=mini'))
  mainDebugger = await connectToDebugger(mainTarget.webSocketDebuggerUrl)
  const probeHandle = await waitForProbeHandle(foregroundProbe)
  await runWin32('focus', { Handle: probeHandle })
  await delay(150)
  if (await foregroundHandle() !== probeHandle) {
    throw new Error('The foreground probe could not become the foreground window.')
  }

  const panelEvent = await waitForPanelEvent(() => electronOutput)
  const panelHandle = BigInt(panelEvent.handle)
  if (panelEvent.focusable !== false || panelEvent.focused !== false) {
    throw new Error(`Quick panel activation flags were incorrect: ${JSON.stringify(panelEvent)}`)
  }
  const extendedStyle = BigInt(await runWin32('style', { Handle: panelHandle }))
  if ((extendedStyle & noActivateStyle) === 0n) {
    throw new Error(`Quick panel HWND did not have WS_EX_NOACTIVATE: ${extendedStyle}.`)
  }
  if (await foregroundHandle() !== probeHandle) {
    throw new Error('Showing the quick panel changed the foreground window.')
  }

  const panelTarget = await waitForTarget(debuggingPort, (target) => target.url.includes('panel=mini'))
  panelDebugger = await connectToDebugger(panelTarget.webSocketDebuggerUrl)
  await waitForExpression(
    panelDebugger,
    `document.readyState === 'complete' && document.querySelector('.active-profile') !== null`,
    'the interactive quick-panel controls'
  )
  const control = await panelDebugger.send('Runtime.evaluate', {
    expression: `(() => {
      const element = document.querySelector('.active-profile')
      if (element === null) return null
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    })()`,
    returnByValue: true
  })
  const controlBounds = control.result.value
  if (controlBounds === null) throw new Error('The quick-panel profile control was unavailable.')
  const nativeBounds = JSON.parse(await runWin32('rect', { Handle: panelHandle }))
  const nativeWidth = nativeBounds.right - nativeBounds.left
  const nativeHeight = nativeBounds.bottom - nativeBounds.top
  const clickX = Math.round(
    nativeBounds.left +
      ((controlBounds.x + controlBounds.width / 2) / panelEvent.bounds.width) * nativeWidth
  )
  const clickY = Math.round(
    nativeBounds.top +
      ((controlBounds.y + controlBounds.height / 2) / panelEvent.bounds.height) * nativeHeight
  )
  await runWin32('click', { X: clickX, Y: clickY })
  await waitForExpression(
    panelDebugger,
    `document.querySelector('.mini-picker') !== null`,
    'the native mouse click to open profile controls'
  )
  if (await foregroundHandle() !== probeHandle) {
    throw new Error('Clicking the interactive quick panel changed the foreground window.')
  }

  await runWin32('key', { VirtualKey: 0x41 })
  const keyDeadline = Date.now() + timeoutMilliseconds
  let keystrokes = ''
  while (Date.now() < keyDeadline) {
    try {
      keystrokes = await readFile(keystrokeLogPath, 'utf8')
      if (/a/i.test(keystrokes)) break
    } catch {
      // The probe creates its log on the first key press.
    }
    await delay(50)
  }
  if (!/a/i.test(keystrokes)) {
    throw new Error('Keyboard input did not continue to the original foreground window.')
  }

  console.log('Native quick-panel smoke passed.')
  console.log(`Foreground HWND retained: ${probeHandle}`)
  console.log(`Quick-panel HWND: ${panelHandle}`)
  console.log('WS_EX_NOACTIVATE: present')
  console.log('Native mouse interaction: received without activation')
  console.log('Keyboard routing: remained with the foreground probe')
} catch (error) {
  failure = error
} finally {
  try {
    if (mainDebugger !== undefined) {
      await mainDebugger.send('Runtime.evaluate', {
        expression: 'window.chromaShift.requestExit()',
        awaitPromise: true,
        returnByValue: true
      })
    }
  } catch {
    // The process cleanup below is the final fallback.
  }
  panelDebugger?.close()
  mainDebugger?.close()
  if (electron.exitCode === null) electron.kill()
  if (foregroundProbe.exitCode === null) foregroundProbe.kill()
  await delay(250)
  await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

if (failure !== undefined) {
  console.error(electronOutput)
  console.error(electronError)
  throw failure
}
