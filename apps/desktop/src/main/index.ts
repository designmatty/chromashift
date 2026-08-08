import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  NativeClient,
  foregroundApplicationChangedDataSchema,
  type ForegroundApplication,
  type Display,
  type DisplayCapabilityReport,
  type SystemInfo
} from '@chromashift/native-client'

type NativeStatus =
  | {
      state: 'ready'
      info: SystemInfo
      currentApplication: ForegroundApplication | null
      lastForegroundEvent: ForegroundApplication | null
      displays: Display[]
      capabilityReports: Record<string, DisplayCapabilityReport>
    }
  | { state: 'error'; message: string }
  | { state: 'starting' }

let nativeClient: NativeClient | undefined
let nativeStatus: NativeStatus = { state: 'starting' }
let lastForegroundEvent: ForegroundApplication | null = null
let shutdownStarted = false

function resolveServicePath(): string {
  const configured = process.env['CHROMASHIFT_DISPLAY_SERVICE_PATH']
  const candidates = [
    configured,
    resolve(app.getAppPath(), '..', '..', 'native', 'DisplayService', 'bin', 'Debug', 'net10.0-windows', 'DisplayService.exe'),
    resolve(process.cwd(), 'native', 'DisplayService', 'bin', 'Debug', 'net10.0-windows', 'DisplayService.exe')
  ].filter((candidate): candidate is string => candidate !== undefined)
  const executable = candidates.find(existsSync)
  if (executable === undefined) {
    throw new Error(`DisplayService executable not found. Checked: ${candidates.join(', ')}`)
  }
  return executable
}

async function startNativeService(): Promise<void> {
  try {
    nativeClient = new NativeClient({ executablePath: resolveServicePath() })
    nativeClient.on('diagnostic', (message) => console.error(`[DisplayService] ${message}`))
    nativeClient.on('event', (event) => {
      if (event.event !== 'foregroundApplicationChanged') return
      const parsed = foregroundApplicationChangedDataSchema.safeParse(event.data)
      if (parsed.success) lastForegroundEvent = parsed.data.application
    })
    nativeClient.on('exit', (code, signal) => {
      nativeStatus = {
        state: 'error',
        message: `DisplayService exited (code=${String(code)}, signal=${String(signal)})`
      }
    })
    const info = await nativeClient.start()
    const displays = await nativeClient.getDisplays()
    nativeStatus = {
      state: 'ready',
      info,
      currentApplication: await nativeClient.getForegroundApplication(),
      lastForegroundEvent,
      displays,
      capabilityReports: Object.fromEntries(await Promise.all(displays.map(async (display) => [display.id, await nativeClient!.getDisplayCapabilityReport(display.id)])))
    }
  } catch (error) {
    nativeStatus = {
      state: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 820,
    height: 580,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.once('ready-to-show', () => window.show())
  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('diagnostics:get-native-status', async (): Promise<NativeStatus> => {
  if (nativeClient?.running) {
    try {
      const displays = await nativeClient.getDisplays()
      nativeStatus = {
        state: 'ready',
        info: await nativeClient.getSystemInfo(),
        currentApplication: await nativeClient.getForegroundApplication(),
        lastForegroundEvent,
        displays,
        capabilityReports: Object.fromEntries(await Promise.all(displays.map(async (display) => [display.id, await nativeClient!.getDisplayCapabilityReport(display.id)])))
      }
    } catch (error) {
      nativeStatus = {
        state: 'error',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
  return nativeStatus
})

void app.whenReady().then(async () => {
  await startNativeService()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', (event) => {
  if (shutdownStarted || nativeClient === undefined) return
  event.preventDefault()
  shutdownStarted = true
  void nativeClient
    .stop()
    .then(() => app.exit())
    .catch((error: unknown) => {
      shutdownStarted = false
      console.error('DisplayService could not restore the baseline; ChromaShift will remain open', error)
    })
})
