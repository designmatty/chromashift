import { spawn } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const releaseDirectory = join(desktopDirectory, 'release')
const unpackedDirectory = join(releaseDirectory, 'win-unpacked')
const timeoutMilliseconds = 30_000

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

async function assertFile(path) {
  await access(path)
  if (!(await stat(path)).isFile()) throw new Error(`Expected a file at ${path}.`)
}

async function runProcess(executable, args, description, timeout = 120_000) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const code = await withTimeout(
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    timeout,
    description
  ).catch((error) => {
    child.kill()
    throw error
  })
  if (code !== 0) {
    throw new Error(`${description} exited with code ${String(code)}.\n${stdout}\n${stderr}`)
  }
}

async function smokeService(servicePath, label) {
  const child = spawn(servicePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.setDefaultEncoding('utf8')
  const lines = createInterface({ input: child.stdout })
  const pending = new Map()
  let readyResolve
  const ready = new Promise((resolveReady) => { readyResolve = resolveReady })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.event === 'service.ready') readyResolve()
    if (message.id !== undefined) {
      const request = pending.get(message.id)
      if (request !== undefined) {
        pending.delete(message.id)
        if (message.ok) request.resolve(message.result)
        else request.reject(new Error(`${message.error.code}: ${message.error.message}`))
      }
    }
  })
  let nextId = 1
  const request = (command, params) => {
    const id = String(nextId++)
    const response = new Promise((resolveResponse, reject) => {
      pending.set(id, { resolve: resolveResponse, reject })
    })
    child.stdin.write(`${JSON.stringify({ id, command, params })}\n`)
    return withTimeout(response, timeoutMilliseconds, `${label} ${command}`)
  }

  try {
    await withTimeout(ready, timeoutMilliseconds, `${label} service readiness`)
    const info = await request('system.info')
    if (info.protocolVersion !== 1) throw new Error(`${label} returned the wrong protocol version.`)
    const displayResult = await request('displays.list')
    const display = displayResult.displays?.[0]
    if (display === undefined) throw new Error(`${label} did not enumerate a display.`)
    await request('baseline.capture', { displayId: display.id })
    const restored = await request('service.shutdown')
    if (!restored.displays?.some((result) => result.displayId === display.id && result.restored)) {
      throw new Error(`${label} did not confirm baseline restoration for ${display.id}.`)
    }
    const code = await withTimeout(
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      timeoutMilliseconds,
      `${label} service exit`
    )
    if (code !== 0) throw new Error(`${label} service exited with code ${String(code)}.`)
  } finally {
    lines.close()
    if (child.exitCode === null) child.kill()
  }
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
    server.close((error) => error === undefined ? resolveClose() : reject(error))
  )
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
      // The packaged app has not opened its debugging endpoint yet.
    }
    await delay(100)
  }
  throw new Error('The packaged app did not expose a renderer debugging target.')
}

async function smokeApplication(executablePath, userDataDirectory, label) {
  const port = await reservePort()
  const environment = { ...globalThis.process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawn(
    executablePath,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDirectory}`],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: environment }
  )
  let output = ''
  let exitIssued = false
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  let socket
  try {
    const target = await waitForDebuggerTarget(port)
    socket = new globalThis.WebSocket(target.webSocketDebuggerUrl)
    await withTimeout(
      new Promise((resolveOpen, reject) => {
        socket.addEventListener('open', resolveOpen, { once: true })
        socket.addEventListener('error', reject, { once: true })
      }),
      timeoutMilliseconds,
      `${label} debugger connection`
    )
    let nextId = 1
    const pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id === undefined) return
      const entry = pending.get(message.id)
      if (entry === undefined) return
      pending.delete(message.id)
      if (message.error !== undefined) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
    })
    const send = (method, params = {}) => {
      const id = nextId++
      const response = new Promise((resolveResponse, reject) => {
        pending.set(id, { resolve: resolveResponse, reject })
      })
      socket.send(JSON.stringify({ id, method, params }))
      return withTimeout(response, timeoutMilliseconds, `${label} ${method}`)
    }

    const deadline = Date.now() + timeoutMilliseconds
    let body = ''
    let productReady = false
    while (Date.now() < deadline) {
      const evaluation = await send('Runtime.evaluate', {
        expression: `(async () => ({
          body: document.body.innerText,
          ready: typeof window.chromaShift?.getState === 'function' &&
            (await window.chromaShift.getState()).ok
        }))()`,
        awaitPromise: true,
        returnByValue: true
      })
      body = typeof evaluation.result.value?.body === 'string' ? evaluation.result.value.body : ''
      productReady = evaluation.result.value?.ready === true
      if (productReady && body.includes('Profiles')) break
      await delay(100)
    }
    if (!productReady || !body.includes('Profiles')) {
      throw new Error(`${label} did not become ready.\n${body}\n${output}`)
    }
    try {
      exitIssued = true
      const exitRequest = await send('Runtime.evaluate', {
        expression: 'void window.chromaShift.requestExit()',
        returnByValue: true
      })
      if (exitRequest.exceptionDetails !== undefined) {
        throw new Error(`${label} exit request failed: ${exitRequest.exceptionDetails.text}`)
      }
    } catch {
      // Restore-safe exit can tear down the debugger before acknowledging.
    }
    let code
    try {
      code = await withTimeout(
        new Promise((resolveExit) => child.once('exit', resolveExit)),
        timeoutMilliseconds,
        `${label} restore-safe exit`
      )
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`)
    }
    if (code !== 0) throw new Error(`${label} exited with code ${String(code)}.\n${output}`)
    if (!output.includes('"eventName":"ApplicationExiting"') || !output.includes('"baselineRestored":true')) {
      throw new Error(`${label} did not log confirmed restoration before exit.\n${output}`)
    }
    await delay(500)
  } finally {
    if (!exitIssued && socket?.readyState === globalThis.WebSocket.OPEN) socket.close()
    if (child.exitCode === null) child.kill()
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'chromashift-package-smoke-'))
const installedDirectory = join(temporaryRoot, 'installed')
const unpackedUserData = join(temporaryRoot, 'unpacked-user-data')
const installedUserData = join(temporaryRoot, 'installed-user-data')
const unpackedApplication = join(unpackedDirectory, 'ChromaShift.exe')
const unpackedService = join(unpackedDirectory, 'resources', 'display-service', 'DisplayService.exe')
const unpackedAsar = join(unpackedDirectory, 'resources', 'app.asar')

try {
  await Promise.all([
    assertFile(unpackedApplication),
    assertFile(unpackedService),
    assertFile(unpackedAsar),
    assertFile(join(unpackedDirectory, 'resources', 'display-service', 'DisplayService.runtimeconfig.json')),
    assertFile(join(unpackedDirectory, 'resources', 'icon.png'))
  ])
  await smokeService(unpackedService, 'unpacked')
  await smokeApplication(unpackedApplication, unpackedUserData, 'unpacked app')

  const artifacts = await readdir(releaseDirectory)
  const installerName = artifacts.find((name) => /^ChromaShift-.*-x64-setup\.exe$/i.test(name))
  if (installerName === undefined) throw new Error('The NSIS installer artifact was not found.')
  const installer = join(releaseDirectory, installerName)

  await runProcess(installer, ['/S', `/D=${installedDirectory}`], 'NSIS install')
  const installedApplication = join(installedDirectory, 'ChromaShift.exe')
  const installedService = join(installedDirectory, 'resources', 'display-service', 'DisplayService.exe')
  await Promise.all([assertFile(installedApplication), assertFile(installedService)])

  await mkdir(installedUserData, { recursive: true })
  const configurationPath = join(installedUserData, 'profiles.json')
  const configuration = '{\n  "schemaVersion": 2,\n  "profiles": [],\n  "settings": { "defaultProfileId": null }\n}\n'
  await writeFile(configurationPath, configuration)
  await smokeService(installedService, 'installed')
  await smokeApplication(installedApplication, installedUserData, 'installed app')

  await runProcess(installer, ['/S', `/D=${installedDirectory}`], 'NSIS upgrade')
  if (await readFile(configurationPath, 'utf8') !== configuration) {
    throw new Error('The profile configuration changed during the upgrade.')
  }

  const uninstaller = join(installedDirectory, 'Uninstall ChromaShift.exe')
  await assertFile(uninstaller)
  await runProcess(uninstaller, ['/S'], 'NSIS uninstall')
  if (await readFile(configurationPath, 'utf8') !== configuration) {
    throw new Error('The profile configuration did not survive uninstall.')
  }

  globalThis.console.log('Packaged application smoke test passed.')
  globalThis.console.log(`Unpacked layout: ${unpackedDirectory}`)
  globalThis.console.log(`Installer: ${installer}`)
  globalThis.console.log('External sidecar launch, IPC, baseline restoration, upgrade, and uninstall data safety: verified')
} finally {
  await rm(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250
  })
}
