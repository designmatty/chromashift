import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import electronPath from 'electron'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const electronVersion = require('electron/package.json').version
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const defaultDesktopDirectory = resolve(scriptDirectory, '..')
const timeoutMilliseconds = 15_000
const sampleCount = 5
const cpuSampleCount = 3
const cpuSampleMilliseconds = 1_000

const performanceBudgets = {
  startupReadyMilliseconds: 2_000,
  miniOpenMilliseconds: 1_500,
  appReopenMilliseconds: 2_000,
  visiblePrivateBytes: 230 * 1024 * 1024,
  miniPrivateBytes: 230 * 1024 * 1024,
  trayPrivateBytes: 150 * 1024 * 1024,
  reopenedAppPrivateBytes: 230 * 1024 * 1024,
  idleCpuCorePercent: 5
}

function argumentValue(name, fallback) {
  const prefix = `--${name}=`
  return (
    globalThis.process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ??
    fallback
  )
}

function hasArgument(name) {
  return globalThis.process.argv.includes(`--${name}`)
}

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
  if (address === null || typeof address === 'string')
    throw new Error('Could not reserve a debugging port.')
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose()))
  )
  return address.port
}

async function debuggerTargets(port) {
  const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) return []
  return response.json()
}

async function waitForDebuggerTarget(port, predicate = () => true) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      const targets = await debuggerTargets(port)
      const page = targets.find(
        (target) => target.type === 'page' && predicate(target) && target.webSocketDebuggerUrl
      )
      if (page !== undefined) return page
    } catch {
      // Electron has not opened its debugging endpoint yet.
    }
    await delay(100)
  }
  throw new Error('Electron did not expose a renderer debugging target.')
}

async function waitForNoDebuggerTarget(port, predicate) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      const targets = await debuggerTargets(port)
      if (!targets.some((target) => target.type === 'page' && predicate(target))) return
    } catch {
      return
    }
    await delay(100)
  }
  throw new Error('Electron retained a renderer debugging target after its release deadline.')
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
    send(method, params = {}, responseTimeout = timeoutMilliseconds) {
      const id = nextId++
      const response = new Promise((resolveResponse, reject) => {
        pending.set(id, { resolve: resolveResponse, reject })
      })
      socket.send(JSON.stringify({ id, method, params }))
      return withTimeout(response, responseTimeout, method)
    }
  }
}

async function waitForUi(debuggerClient) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    const evaluation = await debuggerClient.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' &&
        typeof window.chromaShift?.getState === 'function' &&
        document.body.innerText.includes('Default profile')`,
      returnByValue: true
    })
    if (evaluation.result.value === true) return
    await delay(100)
  }
  throw new Error('The ChromaShift renderer did not become ready.')
}

async function waitForExpression(debuggerClient, expression, description) {
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
  throw new Error(`Timed out waiting for ${description}.`)
}

async function waitForMiniUi(debuggerClient) {
  await waitForExpression(
    debuggerClient,
    `document.readyState === 'complete' &&
      document.visibilityState === 'visible' &&
      document.querySelector('[data-part="mini-panel"]') !== null`,
    'the mini panel renderer'
  )
}

function evaluate(debuggerClient, expression) {
  return debuggerClient.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
}

function metricFailures(measurement) {
  const metrics = [
    ['startupReadyMilliseconds', measurement.startupReadyMilliseconds],
    ['miniOpenMilliseconds', measurement.miniOpenMilliseconds],
    ['appReopenMilliseconds', measurement.appReopenMilliseconds],
    ['visiblePrivateBytes', measurement.states.visible.privateBytes],
    ['miniPrivateBytes', measurement.states.mini.privateBytes],
    ['trayPrivateBytes', measurement.states.tray.privateBytes],
    ['reopenedAppPrivateBytes', measurement.states.reopenedApp.privateBytes]
  ]
  for (const [state, value] of Object.entries(measurement.states)) {
    metrics.push([`${state}IdleCpuCorePercent`, value.idleCpuCorePercent])
  }

  return metrics.flatMap(([name, value]) => {
    const budgetName = name.endsWith('IdleCpuCorePercent') ? 'idleCpuCorePercent' : name
    const budget = performanceBudgets[budgetName]
    return budget !== undefined && value > budget ? [{ name, value, budget }] : []
  })
}

async function closeAppPanel(processId) {
  const source = `
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public static class NativeWindowCloser {
      [StructLayout(LayoutKind.Sequential)]
      private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
      private delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);
      [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
      [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
      [DllImport("user32.dll")] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
      [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr handle, out Rect bounds);
      [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
      public static bool CloseAppPanel(uint processId) {
        IntPtr target = IntPtr.Zero;
        EnumWindows((handle, parameter) => {
          uint owner;
          GetWindowThreadProcessId(handle, out owner);
          if (owner != processId) return true;
          var title = new StringBuilder(256);
          GetWindowText(handle, title, title.Capacity);
          if (title.ToString() != "ChromaShift") return true;
          Rect bounds;
          if (!GetWindowRect(handle, out bounds) || bounds.Right - bounds.Left < 700) return true;
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
[NativeWindowCloser]::CloseAppPanel(${processId})`
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
  if (stdout.trim().toLowerCase() !== 'true')
    throw new Error('Windows did not accept the app-panel close request.')
}

async function readProcessTree(processId) {
  const command = `
$rootId = ${processId}
$all = @(Get-CimInstance Win32_Process)
$included = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$included.Add($rootId)
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($item in $all) {
    if ($included.Contains([int]$item.ParentProcessId) -and -not $included.Contains([int]$item.ProcessId)) {
      [void]$included.Add([int]$item.ProcessId)
      $changed = $true
    }
  }
}
$rows = foreach ($item in $all) {
  if (-not $included.Contains([int]$item.ProcessId)) { continue }
  $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process) { continue }
  [pscustomobject]@{
    processId = [int]$item.ProcessId
    parentProcessId = [int]$item.ParentProcessId
    name = [string]$item.Name
    commandLine = [string]$item.CommandLine
    workingSetBytes = [long]$process.WorkingSet64
    privateBytes = [long]$process.PrivateMemorySize64
    totalProcessorSeconds = [double]$process.CPU
  }
}
@($rows) | ConvertTo-Json -Compress
`
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      globalThis.Buffer.from(command, 'utf16le').toString('base64')
    ],
    { windowsHide: true, maxBuffer: 1024 * 1024 }
  )
  const parsed = JSON.parse(stdout.trim())
  return Array.isArray(parsed) ? parsed : [parsed]
}

function processKind(process, rootProcessId) {
  if (process.processId === rootProcessId) return 'electron-main'
  if (process.name.toLowerCase() === 'chromashift.displayservice.exe') return 'display-service'
  if (process.commandLine.includes('--type=renderer')) return 'renderer'
  if (process.commandLine.includes('--type=gpu-process')) return 'gpu'
  if (process.commandLine.includes('--type=utility')) return 'utility'
  return 'other'
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function summarizeSamples(samples, rootProcessId) {
  const kinds = new Set(
    samples.flatMap((sample) => sample.map((process) => processKind(process, rootProcessId)))
  )
  const byKind = Object.fromEntries(
    [...kinds].sort().map((kind) => {
      const workingSets = samples.map((sample) =>
        sample
          .filter((process) => processKind(process, rootProcessId) === kind)
          .reduce((total, process) => total + process.workingSetBytes, 0)
      )
      const privateBytes = samples.map((sample) =>
        sample
          .filter((process) => processKind(process, rootProcessId) === kind)
          .reduce((total, process) => total + process.privateBytes, 0)
      )
      return [
        kind,
        {
          workingSetBytes: median(workingSets),
          privateBytes: median(privateBytes)
        }
      ]
    })
  )
  return {
    sampleCount: samples.length,
    processCount: median(samples.map((sample) => sample.length)),
    workingSetBytes: median(
      samples.map((sample) => sample.reduce((total, process) => total + process.workingSetBytes, 0))
    ),
    privateBytes: median(
      samples.map((sample) => sample.reduce((total, process) => total + process.privateBytes, 0))
    ),
    byKind
  }
}

async function sampleState(processId) {
  const samples = []
  for (let index = 0; index < sampleCount; index += 1) {
    samples.push(await readProcessTree(processId))
    await delay(250)
  }
  const summary = summarizeSamples(samples, processId)
  const cpuSamples = []
  for (let index = 0; index < cpuSampleCount; index += 1) {
    const before = await readProcessTree(processId)
    const beforeByProcess = new Map(
      before.map((process) => [process.processId, process.totalProcessorSeconds])
    )
    const startedAt = globalThis.performance.now()
    await delay(cpuSampleMilliseconds)
    const after = await readProcessTree(processId)
    const elapsedSeconds = (globalThis.performance.now() - startedAt) / 1_000
    const processorSeconds = after.reduce((total, process) => {
      const previous = beforeByProcess.get(process.processId)
      return previous === undefined
        ? total
        : total + Math.max(0, process.totalProcessorSeconds - previous)
    }, 0)
    cpuSamples.push((processorSeconds / elapsedSeconds) * 100)
  }
  return { ...summary, idleCpuCorePercent: median(cpuSamples) }
}

async function waitForExit(child) {
  if (child.exitCode !== null) return child.exitCode
  return withTimeout(
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    timeoutMilliseconds,
    'Electron to exit'
  )
}

const desktopDirectory = resolve(argumentValue('desktop', defaultDesktopDirectory))
const label = argumentValue('label', 'current')
const packaged = hasArgument('packaged')
const check = hasArgument('check')
const executablePath = packaged
  ? resolve(desktopDirectory, 'release/win-unpacked/ChromaShift.exe')
  : electronPath
const debuggingPort = await reservePort()
const userDataDirectory = await mkdtemp(join(tmpdir(), 'chromashift-memory-'))
const environment = { ...globalThis.process.env }
delete environment.ELECTRON_RUN_AS_NODE

function launchArguments(includeDebugger) {
  const arguments_ = [
    ...(includeDebugger ? [`--remote-debugging-port=${debuggingPort}`] : []),
    `--user-data-dir=${userDataDirectory}`
  ]
  if (!packaged) arguments_.push('.')
  return arguments_
}

const startedAt = globalThis.performance.now()
const electron = spawn(executablePath, launchArguments(true), {
  cwd: desktopDirectory,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})

const debuggerClients = new Set()
let exitClient
let standardError = ''
electron.stderr.setEncoding('utf8')
electron.stderr.on('data', (data) => {
  standardError += data
})

try {
  const appTarget = await waitForDebuggerTarget(
    debuggingPort,
    (target) => !target.url.includes('panel=mini')
  )
  const appClient = await connectToDebugger(appTarget.webSocketDebuggerUrl)
  debuggerClients.add(appClient)
  exitClient = appClient
  await appClient.send('Runtime.enable')
  await waitForUi(appClient)
  const startupReadyMilliseconds = Math.round(globalThis.performance.now() - startedAt)
  await delay(1_000)
  const visible = await sampleState(electron.pid)

  const miniOpenedAt = globalThis.performance.now()
  const miniResult = await evaluate(
    appClient,
    `(async () => (await window.chromaShift.showMiniPanel()).ok)()`
  )
  if (miniResult.result.value !== true) throw new Error('The app could not open the mini panel.')
  await waitForExpression(
    appClient,
    `document.visibilityState === 'hidden'`,
    'the app panel to hide'
  )
  const miniTarget = await waitForDebuggerTarget(debuggingPort, (target) =>
    target.url.includes('panel=mini')
  )
  const miniClient = await connectToDebugger(miniTarget.webSocketDebuggerUrl)
  debuggerClients.add(miniClient)
  exitClient = miniClient
  await miniClient.send('Runtime.enable')
  await waitForMiniUi(miniClient)
  const miniOpenMilliseconds = Math.round(globalThis.performance.now() - miniOpenedAt)

  const targetsAfterMiniOpen = await debuggerTargets(debuggingPort)
  const retainedAppRendererAfterMiniOpen = targetsAfterMiniOpen.some(
    (target) => target.type === 'page' && !target.url.includes('panel=mini')
  )
  const miniWithRetainedApp = retainedAppRendererAfterMiniOpen
    ? await sampleState(electron.pid)
    : undefined
  if (retainedAppRendererAfterMiniOpen) {
    await closeAppPanel(electron.pid)
    await waitForNoDebuggerTarget(debuggingPort, (target) => !target.url.includes('panel=mini'))
  }
  await delay(1_000)
  const mini = await sampleState(electron.pid)

  await evaluate(miniClient, `window.chromaShift.hideMiniPanel()`)
  await waitForNoDebuggerTarget(debuggingPort, (target) => target.url.includes('panel=mini'))
  await delay(500)
  const tray = await sampleState(electron.pid)

  const appReopenedAt = globalThis.performance.now()
  const reopen = spawn(executablePath, launchArguments(false), {
    cwd: desktopDirectory,
    env: environment,
    stdio: 'ignore',
    windowsHide: true
  })
  await waitForExit(reopen)
  const reopenedAppTarget = await waitForDebuggerTarget(
    debuggingPort,
    (target) => !target.url.includes('panel=mini')
  )
  const reopenedAppClient = await connectToDebugger(reopenedAppTarget.webSocketDebuggerUrl)
  debuggerClients.add(reopenedAppClient)
  exitClient = reopenedAppClient
  await reopenedAppClient.send('Runtime.enable')
  await waitForUi(reopenedAppClient)
  const appReopenMilliseconds = Math.round(globalThis.performance.now() - appReopenedAt)
  await waitForNoDebuggerTarget(debuggingPort, (target) => target.url.includes('panel=mini'))
  await delay(500)
  const reopenedApp = await sampleState(electron.pid)

  const measurement = {
    label,
    measuredAt: new Date().toISOString(),
    desktopDirectory,
    executablePath,
    runtime: packaged ? 'packaged' : 'development',
    electronVersion,
    startupReadyMilliseconds,
    miniOpenMilliseconds,
    appReopenMilliseconds,
    retainedAppRendererAfterMiniOpen,
    states: {
      visible,
      ...(miniWithRetainedApp === undefined ? {} : { miniWithRetainedApp }),
      mini,
      tray,
      reopenedApp
    },
    ...(check ? { performanceBudgets } : {})
  }
  globalThis.console.log(JSON.stringify(measurement, null, 2))
  if (check) {
    const failures = metricFailures(measurement)
    if (retainedAppRendererAfterMiniOpen) {
      failures.push({ name: 'retainedAppRendererAfterMiniOpen', value: true, budget: false })
    }
    if (failures.length > 0) {
      throw new Error(
        `Performance budget exceeded: ${failures
          .map(({ name, value, budget }) => `${name} ${String(value)} > ${String(budget)}`)
          .join(', ')}`
      )
    }
  }
} catch (error) {
  if (standardError.trim() !== '') globalThis.console.error(standardError.trim())
  throw error
} finally {
  if (exitClient !== undefined) {
    try {
      await exitClient.send(
        'Runtime.evaluate',
        {
          expression: 'void window.chromaShift.requestExit()'
        },
        1_000
      )
    } catch {
      // Restore-safe shutdown usually closes the debugger before it responds.
    }
  }
  for (const client of debuggerClients) client.close()
  try {
    await waitForExit(electron)
  } catch {
    electron.kill()
  }
  await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
