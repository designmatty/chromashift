import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  type IpcMainInvokeEvent,
  type OpenDialogOptions
} from 'electron'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JsonProfileRepository, type ProfileRepository } from '@chromashift/core'
import {
  NativeClient,
  foregroundApplicationChangedDataSchema
} from '@chromashift/native-client'
import { productIpcChannels, type AppPanelView } from '../shared/product-api.js'
import { ActivationCoordinator } from './activation-coordinator.js'
import { AppSettingsRepository, defaultAppSettings } from './app-settings.js'
import { resolveApplicationDataPaths } from './application-data-path.js'
import { AutomaticActivationController } from './automatic-activation-controller.js'
import { resolveDisplayServicePath } from './display-service-path.js'
import { ElectronTrayMenu } from './electron-tray-menu.js'
import { AppDataProfileConfigurationStorage } from './profile-configuration-storage.js'
import { migrateLegacyProfileConfiguration } from './profile-configuration-migration.js'
import { MiniPanelController } from './mini-panel-controller.js'
import { registerProductIpcHandlers } from './product-ipc.js'
import { ProductController } from './product-controller.js'
import { PreviewSessionController } from './preview-session-controller.js'
import { ShutdownCoordinator } from './shutdown-coordinator.js'
import { describeError, JsonConsoleLogger } from './structured-logger.js'
import { TrayController } from './tray-controller.js'
import { WindowController } from './window-controller.js'

let mainWindow: BrowserWindow | undefined
let miniWindow: BrowserWindow | undefined
let nativeClient: NativeClient | undefined
let profileRepository: ProfileRepository | undefined
let automaticActivation: AutomaticActivationController | undefined
let trayController: TrayController | undefined
let shutdownCoordinator: ShutdownCoordinator | undefined
let productController: ProductController | undefined
let previewController: PreviewSessionController | undefined
let productStateBroadcastPending = false
const logger = new JsonConsoleLogger()
const hasUserDataOverride = app.commandLine.hasSwitch('user-data-dir')
const applicationDataPaths = resolveApplicationDataPaths(
  app.getPath('appData'),
  hasUserDataOverride ? app.getPath('userData') : undefined
)
const settingsRepository = new AppSettingsRepository(applicationDataPaths.settingsPath)
let currentSettings = defaultAppSettings
if (!hasUserDataOverride) app.setPath('userData', applicationDataPaths.userDataDirectory)
const windowController = new WindowController(
  () => mainWindow,
  () => createWindow(),
  () => shutdownCoordinator?.exiting === true
)
const miniPanelController = new MiniPanelController(
  () => miniWindow,
  () => createMiniWindow(),
  (bounds) => screen.getDisplayMatching(bounds),
  () => currentSettings.miniPanelPosition,
  (position) => saveMiniPanelPosition(position)
)

function saveMiniPanelPosition(position: { x: number, y: number }): void {
  const currentPosition = currentSettings.miniPanelPosition
  if (currentPosition?.x === position.x && currentPosition.y === position.y) return
  currentSettings = { ...currentSettings, miniPanelPosition: position }
  void settingsRepository.save(currentSettings).then(() => {
    scheduleProductStateBroadcast()
  }).catch((error: unknown) => {
    logger.write({ level: 'warning', eventName: 'MiniPanelPositionSaveFailed', ...describeError(error) })
  })
}

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
  } else {
    const expected = new URL(pathToFileURL(join(__dirname, '../renderer/index.html')).toString())
    const actual = new URL(senderUrl)
    if (actual.protocol === expected.protocol && actual.pathname === expected.pathname) return
  }
  throw new Error(`Renderer IPC sender is not trusted: ${senderUrl}`)
}

async function startNativeService(): Promise<void> {
  const configurationPath = applicationDataPaths.profileConfigurationPath
  try {
    const migratedFrom = await migrateLegacyProfileConfiguration(
      configurationPath,
      applicationDataPaths.legacyProfileConfigurationPaths
    )
    if (migratedFrom !== null) {
      logger.write({
        level: 'information',
        eventName: 'ProfileConfigurationMigrated',
        sourcePath: migratedFrom,
        destinationPath: configurationPath
      })
    }
    nativeClient = new NativeClient({
      executablePath: servicePath(),
      executableArguments: [`--parent-pid=${process.pid}`],
      detached: process.platform === 'win32'
    })
    profileRepository = new JsonProfileRepository(
      new AppDataProfileConfigurationStorage(configurationPath)
    )
    const coordinator = new ActivationCoordinator(profileRepository, nativeClient, logger)
    automaticActivation = new AutomaticActivationController(
      profileRepository,
      coordinator,
      logger,
      (application) => application?.pid === process.pid
    )
    nativeClient.on('diagnostic', (message) => console.error(`[DisplayService] ${message}`))
    nativeClient.on('event', (event) => {
      if (event.event === 'foregroundApplicationChanged') {
        const parsed = foregroundApplicationChangedDataSchema.safeParse(event.data)
        if (parsed.success) scheduleProductStateBroadcast()
      }
      void automaticActivation?.handleNativeEvent(event).catch((error: unknown) => {
        logger.write({
          level: 'error',
          eventName: 'AutomaticActivationEventFailed',
          ...describeError(error)
        })
      })
    })
    nativeClient.on('exit', () => {
      void automaticActivation?.handleNativeServiceExit().catch((error: unknown) => {
        logger.write({
          level: 'error',
          eventName: 'ActivationStateResetFailed',
          ...describeError(error)
        })
      })
      if (shutdownCoordinator?.exiting !== true) scheduleProductStateBroadcast()
    })
    await nativeClient.start()
    const currentApplication = await nativeClient.getForegroundApplication()
    try {
      await automaticActivation.start(currentApplication)
    } catch (error) {
      logger.write({
        level: 'error',
        eventName: 'AutomaticActivationUnavailable',
        configurationPath,
        ...describeError(error)
      })
    }
  } catch (error) {
    logger.write({ level: 'error', eventName: 'NativeServiceStartupFailed', ...describeError(error) })
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 640,
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.on('close', (event) => {
    const wasExiting = shutdownCoordinator?.exiting === true
    if (!wasExiting && currentSettings.closeBehavior === 'shutdown') {
      event.preventDefault()
      void shutdownCoordinator?.request('application')
      return
    }
    if (!wasExiting && previewController?.state.state === 'active' &&
      previewController.state.kind !== 'override') {
      void previewController.cancel().catch((error: unknown) => {
        logger.write({ level: 'warning', eventName: 'PreviewCancelOnCloseFailed', ...describeError(error) })
      })
    }
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

function createMiniWindow(): BrowserWindow {
  const panel = new BrowserWindow({
    width: 330,
    height: 388,
    useContentSize: true,
    show: false,
    frame: false,
    roundedCorners: true,
    hasShadow: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    skipTaskbar: true,
    ...(process.platform === 'win32' ? { focusable: false } : {}),
    backgroundColor: process.platform === 'win32' ? '#00000000' : '#18181b',
    ...(process.platform === 'win32' ? { transparent: true } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  miniWindow = panel
  if (process.platform !== 'win32') panel.on('blur', () => panel.hide())
  let userMovedPanel = false
  panel.on('will-move', () => { userMovedPanel = true })
  panel.on('moved', () => {
    if (!userMovedPanel) return
    userMovedPanel = false
    miniPanelController.rememberPosition(panel.getBounds())
  })
  panel.on('closed', () => { if (miniWindow === panel) miniWindow = undefined })
  panel.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      panel.hide()
    }
  })
  panel.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Mini-panel preload script failed: ${preloadPath}`, error)
  })
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  panel.webContents.on('will-navigate', (event, url) => {
    if (url !== panel.webContents.getURL()) event.preventDefault()
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void panel.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?panel=mini`)
  } else {
    void panel.loadFile(join(__dirname, '../renderer/index.html'), { query: { panel: 'mini' } })
  }
  return panel
}

function openWindow(view: AppPanelView = 'profiles'): void {
  miniPanelController.hide()
  windowController.open()
  const window = mainWindow
  if (window === undefined || window.webContents.isDestroyed()) return
  const navigate = (): void => window.webContents.send(productIpcChannels.navigateAppPanel, view)
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', navigate)
  else navigate()
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
      show: () => openWindow(),
      showError: (title, message) => dialog.showErrorBox(title, message)
    },
    logger
  )
  const trayMenu = new ElectronTrayMenu(
    trayIconPath(),
    (bounds) => miniPanelController.toggle(bounds)
  )
  trayController = new TrayController(
    profileRepository,
    automaticActivation,
    { open: () => openWindow() },
    shutdownCoordinator,
    trayMenu,
    logger
  )
  automaticActivation.subscribe(() => scheduleProductStateBroadcast())
  previewController = new PreviewSessionController(
    nativeClient,
    automaticActivation,
    () => scheduleProductStateBroadcast()
  )
  productController = new ProductController(
    profileRepository,
    nativeClient,
    automaticActivation,
    previewController,
    {
      pick: async () => {
        const options: OpenDialogOptions = {
          title: 'Choose an application',
          properties: ['openFile'],
          filters: [{ name: 'Windows applications', extensions: ['exe'] }]
        }
        const result = mainWindow === undefined
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(mainWindow, options)
        const executablePath = result.filePaths[0]
        if (result.canceled || executablePath === undefined) return null
        const executableName = basename(executablePath)
        const icon = await app.getFileIcon(executablePath, { size: 'normal' })
        return {
          executableName,
          executablePath,
          friendlyName: basename(executablePath, extname(executablePath)),
          iconDataUrl: icon.isEmpty() ? null : icon.toDataURL()
        }
      },
      describe: async (application) => {
        if (application.path === null || application.executable === null ||
          application.pid === process.pid) return null
        const icon = await app.getFileIcon(application.path, { size: 'normal' })
        return {
          executableName: application.executable,
          executablePath: application.path,
          friendlyName: application.title || basename(application.path, extname(application.path)),
          iconDataUrl: icon.isEmpty() ? null : icon.toDataURL()
        }
      }
    },
    {
      get: () => settingsRepository.get(),
      save: (settings) => settingsRepository.save(settings),
      apply: (settings) => {
        currentSettings = settings
        app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup })
      }
    },
    {
      refreshTray: () => trayController?.refresh() ?? Promise.resolve(),
      stateChanged: () => scheduleProductStateBroadcast()
    }
  )
  return trayController.start()
}

function scheduleProductStateBroadcast(): void {
  if (productStateBroadcastPending) return
  productStateBroadcastPending = true
  setTimeout(() => {
    productStateBroadcastPending = false
    const controller = productController
    const windows = [mainWindow, miniWindow].filter(
      (window): window is BrowserWindow => window !== undefined && !window.webContents.isDestroyed()
    )
    if (controller === undefined || windows.length === 0) return
    void controller.getStateForBroadcast().then((state) => {
      for (const window of windows) {
        if (!window.webContents.isDestroyed()) {
          window.webContents.send(productIpcChannels.stateChanged, state)
        }
      }
    }).catch((error: unknown) => {
      logger.write({ level: 'warning', eventName: 'ProductStateBroadcastFailed', ...describeError(error) })
    })
  }, 25)
}

registerProductIpcHandlers(
  ipcMain,
  () => productController,
  assertTrustedRenderer,
  () => shutdownCoordinator?.request('application') ?? Promise.resolve(false),
  openWindow,
  () => miniPanelController.hide()
)

void app.whenReady().then(async () => {
  currentSettings = await settingsRepository.get()
  app.setLoginItemSettings({ openAtLogin: currentSettings.launchAtStartup })
  await startNativeService()
  await configureDesktopLifecycle()
  if (!app.getLoginItemSettings().wasOpenedAtLogin || currentSettings.launchBehavior === 'app') {
    createWindow()
  }
  app.on('activate', () => openWindow())
})

app.on('window-all-closed', () => {
  // The tray keeps ChromaShift alive when windows are hidden or closed.
})

app.on('before-quit', (event) => {
  if (shutdownCoordinator === undefined || shutdownCoordinator.state === 'complete') return
  event.preventDefault()
  void shutdownCoordinator.request('application')
})

app.on('will-quit', () => trayController?.dispose())
