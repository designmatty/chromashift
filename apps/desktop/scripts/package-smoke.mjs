import { spawn } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { FuseState } from '@electron/fuses/dist/constants.js'

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

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function assertProductionFuses(executablePath) {
  const fuses = await getCurrentFuseWire(executablePath)
  const expected = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.ENABLE]
  ])
  for (const [fuse, state] of expected) {
    if (fuses[fuse] !== state) {
      throw new Error(
        `Packaged Electron fuse ${FuseV1Options[fuse]} was ${String(fuses[fuse])}; expected ${String(state)}.`
      )
    }
  }
}

async function runProcess(executable, args, description, timeout = 120_000) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
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
  return { stdout, stderr }
}

async function pressNotificationShortcut() {
  const command = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ChromaShiftPackageKeys {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
'@
$keys = @(0x11, 0x12, 0x10, 0x78)
foreach ($key in $keys) { [ChromaShiftPackageKeys]::keybd_event($key, 0, 0, [UIntPtr]::Zero) }
[Array]::Reverse($keys)
foreach ($key in $keys) { [ChromaShiftPackageKeys]::keybd_event($key, 0, 2, [UIntPtr]::Zero) }
`
  await runProcess(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      globalThis.Buffer.from(command, 'utf16le').toString('base64')
    ],
    'installed global shortcut dispatch'
  )
}

async function clickNewestWindowsNotification(expectedText) {
  const command = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ChromaShiftPackagePointer {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
'@
$expected = ${JSON.stringify(expectedText)}
$primary = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
[ChromaShiftPackagePointer]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
[ChromaShiftPackagePointer]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 250
$clockX = $primary.Right - 40
$taskbarY = $primary.Bottom - 24
[ChromaShiftPackagePointer]::SetCursorPos($clockX, $taskbarY) | Out-Null
[ChromaShiftPackagePointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
[ChromaShiftPackagePointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 750
$notificationX = $primary.Right - 220
$notificationY = $primary.Top + 115
[ChromaShiftPackagePointer]::SetCursorPos($notificationX, $notificationY) | Out-Null
[ChromaShiftPackagePointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
[ChromaShiftPackagePointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "Clicked newest notification '$expected' at $notificationX,$notificationY."
`
  await runProcess(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      globalThis.Buffer.from(command, 'utf16le').toString('base64')
    ],
    'installed notification click',
    30_000
  )
}

async function smokeService(servicePath, label) {
  const child = spawn(servicePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.setDefaultEncoding('utf8')
  const lines = createInterface({ input: child.stdout })
  const pending = new Map()
  let readyResolve
  const ready = new Promise((resolveReady) => {
    readyResolve = resolveReady
  })
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
    await request('service.heartbeat')
    const health = await request('service.health')
    if (
      health.protocolVersion !== info.protocolVersion ||
      health.serviceVersion !== info.serviceVersion ||
      health.watchdogArmed !== true ||
      health.baselineCount !== 0
    ) {
      throw new Error(`${label} failed its health/version/watchdog handshake.`)
    }
    const displayResult = await request('displays.list')
    let display
    for (const candidate of displayResult.displays ?? []) {
      if (candidate.hdr) continue
      const report = await request('display.capabilities', { displayId: candidate.id })
      if (report.capabilities?.brightness?.supported === true) {
        display = candidate
        break
      }
    }
    if (display === undefined) {
      await request('service.shutdown')
      throw new Error(`${label} did not enumerate an SDR display with brightness support.`)
    }
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
    server.close((error) => (error === undefined ? resolveClose() : reject(error)))
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

async function smokeApplication(
  executablePath,
  userDataDirectory,
  label,
  verifyInstalledNotification = false
) {
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
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
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
          csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
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
    const security = await send('Runtime.evaluate', {
      expression: `({
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
        node: typeof globalThis.require,
        preloadApi: Object.keys(window.chromaShift ?? {}).sort()
      })`,
      returnByValue: true
    })
    const policy = security.result.value?.csp
    if (
      typeof policy !== 'string' ||
      !policy.includes("object-src 'none'") ||
      !policy.includes("base-uri 'none'") ||
      policy.includes('ws:')
    ) {
      throw new Error(`${label} did not enforce the production CSP: ${String(policy)}`)
    }
    if (security.result.value?.node !== 'undefined') {
      throw new Error(`${label} exposed Node in the sandboxed renderer.`)
    }
    if (verifyInstalledNotification) {
      const configured = await send('Runtime.evaluate', {
        expression: `(async () => {
          const state = await window.chromaShift.getState()
          if (!state.ok) return null
          const created = await window.chromaShift.createProfile('Notification gate')
          if (!created.ok) return null
          const result = await window.chromaShift.updateSettings({
            ...state.value.settings,
            profileChangeNotifications: true,
            shortcutBindings: [{
              action: { kind: 'profile', profileId: created.value.id },
              accelerator: 'CommandOrControl+Alt+Shift+F9'
            }]
          })
          return result.ok ? { id: created.value.id, name: created.value.name } : null
        })()`,
        awaitPromise: true,
        returnByValue: true
      })
      const notificationProfile = configured.result.value
      if (
        typeof notificationProfile?.id !== 'string' ||
        notificationProfile.name !== 'Notification gate'
      ) {
        throw new Error(`${label} could not configure its notification shortcut.`)
      }
      await pressNotificationShortcut()
      const notificationDeadline = Date.now() + timeoutMilliseconds
      while (!output.includes('"eventName":"ProfileNotificationShown"')) {
        if (output.includes('"eventName":"ProfileNotificationFailed"')) {
          throw new Error(`${label} native notification delivery failed.\n${output}`)
        }
        if (Date.now() >= notificationDeadline) {
          throw new Error(`${label} native notification was not confirmed as shown.\n${output}`)
        }
        await delay(100)
      }
      await clickNewestWindowsNotification(`${notificationProfile.name} activated`)
      const selectionDeadline = Date.now() + timeoutMilliseconds
      let selectedProfile = ''
      while (Date.now() < selectionDeadline) {
        const selection = await send('Runtime.evaluate', {
          expression: `document.querySelector(
            '[data-part="profile-item"][data-selected] [data-part="profile-select"] strong'
          )?.textContent?.trim() ?? ''`,
          returnByValue: true
        })
        selectedProfile = selection.result.value
        if (selectedProfile === notificationProfile.name) break
        await delay(100)
      }
      if (selectedProfile !== notificationProfile.name) {
        throw new Error(
          `${label} notification click did not select ${notificationProfile.name}; selected ${selectedProfile}.`
        )
      }
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
    if (
      !output.includes('"eventName":"ApplicationExiting"') ||
      !output.includes('"baselineRestored":true')
    ) {
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
const unpackedService = join(
  unpackedDirectory,
  'resources',
  'display-service',
  'DisplayService.exe'
)
const unpackedAsar = join(unpackedDirectory, 'resources', 'app.asar')

try {
  await Promise.all([
    assertFile(unpackedApplication),
    assertFile(unpackedService),
    assertFile(unpackedAsar),
    assertFile(join(unpackedDirectory, 'ffmpeg.dll'))
  ])
  const serviceFiles = await readdir(join(unpackedDirectory, 'resources', 'display-service'))
  if (serviceFiles.length !== 1 || serviceFiles[0] !== 'DisplayService.exe') {
    throw new Error(`Unexpected packaged DisplayService files: ${serviceFiles.join(', ')}`)
  }
  for (const unusedRuntimeFile of [
    'dxcompiler.dll',
    'dxil.dll',
    'vk_swiftshader.dll',
    'vk_swiftshader_icd.json',
    'vulkan-1.dll'
  ]) {
    if (await pathExists(join(unpackedDirectory, unusedRuntimeFile))) {
      throw new Error(`Unused Electron runtime file was packaged: ${unusedRuntimeFile}`)
    }
  }
  if (await pathExists(join(unpackedDirectory, 'resources', 'icon.png'))) {
    throw new Error('The packaged tray icon duplicates the icon embedded in ChromaShift.exe.')
  }
  await assertProductionFuses(unpackedApplication)
  await smokeService(unpackedService, 'unpacked')
  await smokeApplication(unpackedApplication, unpackedUserData, 'unpacked app')

  const artifacts = await readdir(releaseDirectory)
  const installerName = artifacts.find((name) => /^ChromaShift-.*-x64-setup\.exe$/i.test(name))
  if (installerName === undefined) throw new Error('The NSIS installer artifact was not found.')
  const installer = join(releaseDirectory, installerName)

  await runProcess(installer, ['/S', `/D=${installedDirectory}`], 'NSIS install')
  const installedApplication = join(installedDirectory, 'ChromaShift.exe')
  const installedService = join(
    installedDirectory,
    'resources',
    'display-service',
    'DisplayService.exe'
  )
  await Promise.all([assertFile(installedApplication), assertFile(installedService)])
  await assertProductionFuses(installedApplication)

  await mkdir(installedUserData, { recursive: true })
  const configurationPath = join(installedUserData, 'profiles.json')
  const configuration =
    '{\n  "schemaVersion": 2,\n  "profiles": [],\n  "settings": { "defaultProfileId": null }\n}\n'
  await writeFile(configurationPath, configuration)
  await smokeService(installedService, 'installed')
  await smokeApplication(installedApplication, installedUserData, 'installed app', true)
  const configurationAfterSmoke = await readFile(configurationPath, 'utf8')

  await runProcess(installer, ['/S', `/D=${installedDirectory}`], 'NSIS upgrade')
  if ((await readFile(configurationPath, 'utf8')) !== configurationAfterSmoke) {
    throw new Error('The profile configuration changed during the upgrade.')
  }

  const uninstaller = join(installedDirectory, 'Uninstall ChromaShift.exe')
  await assertFile(uninstaller)
  await runProcess(uninstaller, ['/S'], 'NSIS uninstall')
  if ((await readFile(configurationPath, 'utf8')) !== configurationAfterSmoke) {
    throw new Error('The profile configuration did not survive uninstall.')
  }

  globalThis.console.log('Packaged application smoke test passed.')
  globalThis.console.log(`Unpacked layout: ${unpackedDirectory}`)
  globalThis.console.log(`Installer: ${installer}`)
  globalThis.console.log(
    'External sidecar launch, IPC, native notification delivery and click routing, baseline restoration, upgrade, and uninstall data safety: verified'
  )
} finally {
  await rm(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250
  })
}
