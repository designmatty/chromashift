import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JsonProfileRepository, type ProfileRepository } from '@chromashift/core'
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
import { resolveDisplayServicePath } from './display-service-path.js'
import { ElectronTrayMenu } from './electron-tray-menu.js'
import { AppDataProfileConfigurationStorage } from './profile-configuration-storage.js'
import { ShutdownCoordinator } from './shutdown-coordinator.js'
import { describeError, JsonConsoleLogger } from './structured-logger.js'
import { TrayController } from './tray-controller.js'
import { WindowController } from './window-controller.js'

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

let mainWindow: BrowserWindow | undefined
let nativeClient: NativeClient | undefined
let profileRepository: ProfileRepository | undefined
let automaticActivation: AutomaticActivationController | undefined
let trayController: TrayController | undefined
let shutdownCoordinator: ShutdownCoordinator | undefined
let nativeStatus: NativeStatus = { state: 'starting' }
let lastForegroundEvent: ForegroundApplication | null = null
const logger = new JsonConsoleLogger()
const windowController = new WindowController(
  () => mainWindow,
  () => createWindow(),
  () => shutdownCoordinator?.exiting === true
)

function servicePath(): string {
  return resolveDisplayServicePath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    configuredPath: process.env['CHROMASHIFT_DISPLAY_SERVICE_PATH']
  })
}

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : resolve(app.getAppPath(), 'build', 'icon.png')
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url
  if (senderUrl === undefined) throw new Error('Renderer IPC sender is unavailable.')
  const developmentUrl = process.env['ELECTRON_RENDERER_URL']
  if (developmentUrl !== undefined) {
    if (new URL(senderUrl).origin === new URL(developmentUrl).origin) return
  } else if (senderUrl === pathToFileURL(join(__dirname, '../renderer/index.html')).toString()) {
    return
  }
  throw new Error(`Renderer IPC sender is not trusted: ${senderUrl}`)
}

async function startNativeService(): Promise<void> {
  const configurationPath = join(app.getPath('userData'), 'profiles.json')
  try {
    nativeClient = new NativeClient({ executablePath: servicePath() })
    profileRepository = new JsonProfileRepository(
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
      if (shutdownCoordinator?.exiting !== true) {
        nativeStatus = {
          state: 'error',
          message: `DisplayService exited (code=${String(code)}, signal=${String(signal)})`
        }
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
      capabilityReports: Object.fromEntries(
        await Promise.all(
          displays.map(async (display) => [
            display.id,
            await nativeClient!.getDisplayCapabilityReport(display.id)
          ])
        )
      ),
      automaticActivation: automaticActivationStatus
    }
  } catch (error) {
    nativeStatus = {
      state: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function createWindow(): BrowserWindow {
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
  mainWindow = window
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Preload script failed: ${preloadPath}`, error)
  })
  window.on('close', (event) => {
    const wasExiting = shutdownCoordinator?.exiting === true
    windowController.handleClose(event, window)
    if (!wasExiting) {
      logger.write({ level: 'information', eventName: 'MainWindowHiddenToTray' })
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.once('ready-to-show', () => window.show())
  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function openWindow(): void {
  windowController.open()
}

function configureDesktopLifecycle(): Promise<void> {
  if (nativeClient === undefined || automaticActivation === undefined || profileRepository === undefined) {
    return Promise.resolve()
  }

  shutdownCoordinator = new ShutdownCoordinator(
    automaticActivation,
    nativeClient,
    app,
    {
      show: openWindow,
      showError: (title, message) => dialog.showErrorBox(title, message)
    },
    logger
  )
  const trayMenu = new ElectronTrayMenu(trayIconPath(), openWindow)
  trayController = new TrayController(
    profileRepository,
    automaticActivation,
    { open: openWindow },
    shutdownCoordinator,
    trayMenu,
    logger
  )
  return trayController.start()
}

ipcMain.handle('diagnostics:get-native-status', async (event): Promise<NativeStatus> => {
  assertTrustedRenderer(event)
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
        capabilityReports: Object.fromEntries(
          await Promise.all(
            displays.map(async (display) => [
              display.id,
              await nativeClient!.getDisplayCapabilityReport(display.id)
            ])
          )
        ),
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

ipcMain.handle('application:request-exit', async (event): Promise<boolean> => {
  assertTrustedRenderer(event)
  if (shutdownCoordinator === undefined) return false
  return shutdownCoordinator.request('application')
})

void app.whenReady().then(async () => {
  await startNativeService()
  createWindow()
  await configureDesktopLifecycle()
  app.on('activate', openWindow)
})

app.on('window-all-closed', () => {
  // Closing the diagnostics window hides it; the tray keeps activation alive.
})

app.on('before-quit', (event) => {
  if (shutdownCoordinator === undefined || shutdownCoordinator.state === 'complete') return
  event.preventDefault()
  void shutdownCoordinator.request('application')
})

app.on('will-quit', () => trayController?.dispose())
