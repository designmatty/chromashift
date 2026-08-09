import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { JsonProfileRepository } from '@chromashift/core'
import {
  NativeClient,
  foregroundApplicationChangedDataSchema,
  type ForegroundApplication,
  type Display,
  type DisplayCapabilityReport,
  type SystemInfo
} from '@chromashift/native-client'
import { ActivationCoordinator } from './activation-coordinator.js'
import { AutomaticActivationController } from './automatic-activation-controller.js'
import { AppDataProfileConfigurationStorage } from './profile-configuration-storage.js'
import { describeError, JsonConsoleLogger } from './structured-logger.js'

type AutomaticActivationStatus =
  | {
      state: 'enabled'
      configurationPath: string
      initialOutcome: 'activated' | 'skipped' | 'partialFailure' | 'failed' | null
    }
  | { state: 'disabled'; configurationPath: string; message: string }

type NativeStatus =
  | {
      state: 'ready'
      info: SystemInfo
      currentApplication: ForegroundApplication | null
      lastForegroundEvent: ForegroundApplication | null
      displays: Display[]
      capabilityReports: Record<string, DisplayCapabilityReport>
      automaticActivation: AutomaticActivationStatus
    }
  | { state: 'error'; message: string }
  | { state: 'starting' }

let nativeClient: NativeClient | undefined
let automaticActivation: AutomaticActivationController | undefined
let nativeStatus: NativeStatus = { state: 'starting' }
let lastForegroundEvent: ForegroundApplication | null = null
let shutdownStarted = false
const logger = new JsonConsoleLogger()

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
    const configurationPath = join(app.getPath('userData'), 'profiles.json')
    const profileRepository = new JsonProfileRepository(
      new AppDataProfileConfigurationStorage(configurationPath)
    )
    const coordinator = new ActivationCoordinator(profileRepository, nativeClient, logger)
    automaticActivation = new AutomaticActivationController(
      profileRepository,
      coordinator,
      logger
    )
    nativeClient.on('diagnostic', (message) => console.error(`[DisplayService] ${message}`))
    nativeClient.on('event', (event) => {
      if (event.event === 'foregroundApplicationChanged') {
        const parsed = foregroundApplicationChangedDataSchema.safeParse(event.data)
        if (parsed.success) lastForegroundEvent = parsed.data.application
      }
      void automaticActivation?.handleNativeEvent(event).catch((error: unknown) => {
        logger.write({
          level: 'error',
          eventName: 'AutomaticActivationEventFailed',
          ...describeError(error)
        })
      })
    })
    nativeClient.on('exit', (code, signal) => {
      void automaticActivation?.handleNativeServiceExit().catch((error: unknown) => {
        logger.write({
          level: 'error',
          eventName: 'ActivationStateResetFailed',
          ...describeError(error)
        })
      })
      nativeStatus = {
        state: 'error',
        message: `DisplayService exited (code=${String(code)}, signal=${String(signal)})`
      }
    })
    const info = await nativeClient.start()
    const displays = await nativeClient.getDisplays()
    const currentApplication = await nativeClient.getForegroundApplication()
    let automaticActivationStatus: AutomaticActivationStatus
    try {
      const initialOutcome = await automaticActivation.start(currentApplication)
      automaticActivationStatus = {
        state: 'enabled',
        configurationPath,
        initialOutcome: initialOutcome?.status ?? null
      }
    } catch (error) {
      automaticActivationStatus = {
        state: 'disabled',
        configurationPath,
        message: describeError(error).message
      }
    }
    nativeStatus = {
      state: 'ready',
      info,
      currentApplication,
      lastForegroundEvent,
      displays,
      capabilityReports: Object.fromEntries(await Promise.all(displays.map(async (display) => [display.id, await nativeClient!.getDisplayCapabilityReport(display.id)]))),
      automaticActivation: automaticActivationStatus
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
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Preload script failed: ${preloadPath}`, error)
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
      const automaticActivationStatus = nativeStatus.state === 'ready'
        ? nativeStatus.automaticActivation
        : {
            state: 'disabled' as const,
            configurationPath: join(app.getPath('userData'), 'profiles.json'),
            message: 'Automatic activation status is unavailable.'
          }
      nativeStatus = {
        state: 'ready',
        info: await nativeClient.getSystemInfo(),
        currentApplication: await nativeClient.getForegroundApplication(),
        lastForegroundEvent,
        displays,
        capabilityReports: Object.fromEntries(await Promise.all(displays.map(async (display) => [display.id, await nativeClient!.getDisplayCapabilityReport(display.id)]))),
        automaticActivation: automaticActivationStatus
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
  const activationIdle = automaticActivation?.waitForIdle() ?? Promise.resolve()
  void activationIdle
    .then(() => nativeClient?.stop())
    .then(() => app.exit())
    .catch((error: unknown) => {
      shutdownStarted = false
      console.error('DisplayService could not restore the baseline; ChromaShift will remain open', error)
    })
})
