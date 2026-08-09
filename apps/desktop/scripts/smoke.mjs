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
  while (Date.now() < deadline) {
    const evaluation = await debuggerClient.send('Runtime.evaluate', {
      expression: `({
        body: document.body.innerText,
        bridgeReady: typeof window.chromaShift?.getNativeStatus === 'function',
        documentReady: document.readyState,
        title: document.title
      })`,
      returnByValue: true
    })
    const snapshot = evaluation.result.value
    if (snapshot.documentReady === 'complete' && !snapshot.body.includes('Starting DisplayService')) {
      return snapshot
    }
    await delay(100)
  }
  throw new Error('The diagnostics UI did not finish rendering.')
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

  const loaded = debuggerClient.waitForEvent('Page.loadEventFired')
  await debuggerClient.send('Page.reload', { ignoreCache: true })
  await loaded

  const ui = await waitForUi(debuggerClient)
  const failures = debuggerClient.events.filter((event) =>
    event.method === 'Runtime.exceptionThrown' ||
    (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
    (event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
  )

  if (!ui.bridgeReady) throw new Error('The preload bridge was not exposed.')
  if (!ui.body.includes('ChromaShift') || !ui.body.includes('Native service')) {
    throw new Error(`The diagnostics UI was incomplete:\n${ui.body}`)
  }
  if (!ui.body.includes('Status\nReady')) {
    throw new Error(`The native service was not ready:\n${ui.body}`)
  }
  if (!ui.body.includes('Automatic activation\nEnabled')) {
    throw new Error(`Automatic activation was not enabled:\n${ui.body}`)
  }
  if (failures.length > 0) {
    throw new Error(`The renderer reported ${failures.length} error event(s): ${JSON.stringify(failures)}`)
  }
  if (/preload script failed|unable to load preload/i.test(`${standardOutput}\n${standardError}`)) {
    throw new Error(`Electron reported a preload failure:\n${standardError}`)
  }

  const screenshot = await debuggerClient.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  })
  await mkdir(screenshotDirectory, { recursive: true })
  await writeFile(screenshotPath, globalThis.Buffer.from(screenshot.data, 'base64'))

  globalThis.console.log('Desktop smoke test passed.')
  globalThis.console.log(`Renderer: ${ui.title} (${target.url})`)
  globalThis.console.log('Preload bridge: ready')
  globalThis.console.log('Native service: ready')
  globalThis.console.log(`Renderer errors: ${failures.length}`)
  globalThis.console.log(`Screenshot: ${screenshotPath}`)
} catch (error) {
  smokeFailure = error
} finally {
  if (debuggerClient !== undefined) {
    try {
      await debuggerClient.send('Browser.close', {}, 1_000)
    } catch {
      // Browser.close tears down the debugging socket before acknowledging on some Electron versions.
    }
    debuggerClient.close()
  }

  try {
    await waitForExit(electron)
  } catch (error) {
    electron.kill()
    smokeFailure ??= error
  }
  await rm(userDataDirectory, { recursive: true, force: true })
}

if (smokeFailure !== undefined) throw smokeFailure
