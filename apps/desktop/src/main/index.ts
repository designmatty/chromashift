import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  type IpcMainInvokeEvent,
  type OpenDialogOptions
} from 'electron'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  describeMigrationNotice,
  JsonProfileRepository,
  type ProfileRepository
} from '@chromashift/core'
import { NativeClient, foregroundApplicationChangedDataSchema } from '@chromashift/native-client'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, resolveWindowBounds } from '../shared/layout.js'
import { productIpcChannels, type AppPanelView } from '../shared/product-api.js'
import { ActivationCoordinator } from './activation-coordinator.js'
import { AppSettingsRepository, defaultAppSettings } from './app-settings.js'
import { resolveApplicationDataPaths } from './application-data-path.js'
import { applicationFriendlyName } from './application-friendly-name.js'
import { AutomaticActivationController } from './automatic-activation-controller.js'
import { resolveDisplayServicePath } from './display-service-path.js'
import { ElectronTrayMenu } from './electron-tray-menu.js'
import { AppDataProfileConfigurationStorage } from './profile-configuration-storage.js'
import { migrateLegacyProfileConfiguration } from './profile-configuration-migration.js'
import { MiniPanelController } from './mini-panel-controller.js'
import { PanelController } from './panel-controller.js'
import { registerProductIpcHandlers } from './product-ipc.js'
import { ProductController } from './product-controller.js'
import { PreviewSessionController } from './preview-session-controller.js'
import { ShutdownCoordinator } from './shutdown-coordinator.js'
import { describeError, JsonConsoleLogger } from './structured-logger.js'
import { TrayController } from './tray-controller.js'
import { WindowController } from './window-controller.js'

app.disableHardwareAcceleration()

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
let windowStateSaveTimer: NodeJS.Timeout | undefined
const TITLE_BAR_HEIGHT = 37
const logger = new JsonConsoleLogger()
const hasUserDataOverride = app.commandLine.hasSwitch('user-data-dir')
const applicationDataPaths = resolveApplicationDataPaths(
  app.getPath('appData'),
  hasUserDataOverride ? app.getPath('userData') : undefined
)
const settingsRepository = new AppSettingsRepository(applicationDataPaths.settingsPath)
let currentSettings = defaultAppSettings
if (!hasUserDataOverride) app.setPath('userData', applicationDataPaths.userDataDirectory)
const ownsSingleInstanceLock = app.requestSingleInstanceLock()
if (!ownsSingleInstanceLock) app.quit()
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
  (position) => saveMiniPanelPosition(position),
  () => miniPanelHeightAdjustment()
)
const panelController = new PanelController(
  () => mainWindow,
  () => miniWindow,
  () => windowController.open(),
  () => mainWindow?.hide(),
  (bounds) => miniPanelController.show(bounds),
  () => miniPanelController.hide()
)

function saveMiniPanelPosition(position: { x: number; y: number }): void {
  const currentPosition = currentSettings.miniPanelPosition
  if (currentPosition?.x === position.x && currentPosition.y === position.y) return
  currentSettings = { ...currentSettings, miniPanelPosition: position }
  void settingsRepository
    .save(currentSettings)
    .then(() => {
      scheduleProductStateBroadcast()
    })
    .catch((error: unknown) => {
      logger.write({
        level: 'warning',
        eventName: 'MiniPanelPositionSaveFailed',
        ...describeError(error)
      })
    })
}

function titleBarOverlayOptions(): { color: string; symbolColor: string; height: number } {
  const dark =
    currentSettings.theme === 'dark' ||
    (currentSettings.theme === 'system' && nativeTheme.shouldUseDarkColors)
  return {
    color: dark ? '#111114' : '#f1f1f3',
    symbolColor: dark ? '#f1f1f3' : '#111114',
    height: TITLE_BAR_HEIGHT
  }
}

function appPanelBackgroundColor(): string {
  const dark =
    currentSettings.theme === 'dark' ||
    (currentSettings.theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#111114' : '#f1f1f3'
}

function applyTitleBarOverlay(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  mainWindow.setTitleBarOverlay(titleBarOverlayOptions())
  mainWindow.setBackgroundColor(appPanelBackgroundColor())
  // Blend Windows' resizable-frame accent into the app instead of drawing a second border.
  if (process.platform === 'win32') mainWindow.setAccentColor(appPanelBackgroundColor())
}

/**
 * Window geometry changes arrive in bursts while dragging or resizing, so the
 * write is debounced and skipped entirely while maximized bounds are transient.
 */
function scheduleWindowStateSave(window: BrowserWindow): void {
  if (windowStateSaveTimer !== undefined) clearTimeout(windowStateSaveTimer)
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = undefined
    if (window.isDestroyed() || window.isMinimized()) return
    const maximized = window.isMaximized()
    const bounds = maximized ? currentSettings.windowBounds : window.getNormalBounds()
    if (
      maximized === (currentSettings.windowMaximized ?? false) &&
      bounds?.x === currentSettings.windowBounds?.x &&
      bounds?.y === currentSettings.windowBounds?.y &&
      bounds?.width === currentSettings.windowBounds?.width &&
      bounds?.height === currentSettings.windowBounds?.height
    ) {
      return
    }

    currentSettings = {
      ...currentSettings,
      windowMaximized: maximized,
      ...(bounds === undefined ? {} : { windowBounds: bounds })
    }
    void settingsRepository.save(currentSettings).catch((error: unknown) => {
      logger.write({
        level: 'warning',
        eventName: 'WindowStateSaveFailed',
        ...describeError(error)
      })
    })
  }, 400)
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
      new AppDataProfileConfigurationStorage(configurationPath),
      {
        onMigrationNotice: (notice) => {
          logger.write({
            level: 'warning',
            eventName: 'ProfileConfigurationMigrationNotice',
            message: describeMigrationNotice(notice),
            ...notice
          })
        }
      }
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
    logger.write({
      level: 'error',
      eventName: 'NativeServiceStartupFailed',
      ...describeError(error)
    })
  }
}

function createWindow(): BrowserWindow {
  const bounds = resolveWindowBounds(
    currentSettings.windowBounds,
    screen.getAllDisplays().map((display) => display.workArea)
  )
  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    // The renderer draws the title bar content but Windows keeps ownership of the
    // caption buttons, keyboard handling, DPI scaling, and Snap behavior.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayOptions(),
    backgroundColor: appPanelBackgroundColor(),
    ...(process.platform === 'win32' ? { accentColor: appPanelBackgroundColor() } : {}),
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
    if (!wasExiting) {
      window.webContents.send(productIpcChannels.appPanelClosed)
      void previewController?.cancelNonOverride().catch((error: unknown) => {
        logger.write({
          level: 'warning',
          eventName: 'PreviewCancelOnCloseFailed',
          ...describeError(error)
        })
      })
    }
    windowController.handleClose(event, window)
    if (!wasExiting) {
      logger.write({ level: 'information', eventName: 'MainWindowReleasedToTray' })
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  if (currentSettings.windowMaximized === true) window.maximize()
  window.on('resize', () => scheduleWindowStateSave(window))
  window.on('move', () => scheduleWindowStateSave(window))
  window.on('maximize', () => scheduleWindowStateSave(window))
  window.on('unmaximize', () => scheduleWindowStateSave(window))
  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function createMiniWindow(): BrowserWindow {
  const panel = new BrowserWindow({
    width: 400,
    height: 596 + miniPanelHeightAdjustment(),
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
  if (process.platform !== 'win32') panel.on('blur', () => miniPanelController.hide())
  let userMovedPanel = false
  panel.on('will-move', () => {
    userMovedPanel = true
  })
  panel.on('moved', () => {
    if (!userMovedPanel) return
    userMovedPanel = false
    miniPanelController.rememberPosition(panel.getBounds())
  })
  panel.on('closed', () => {
    if (miniWindow === panel) miniWindow = undefined
  })
  panel.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      miniPanelController.hide()
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
  panelController.openAppPanel()
  const window = mainWindow
  if (window === undefined || window.webContents.isDestroyed()) return
  const navigate = (): void => window.webContents.send(productIpcChannels.navigateAppPanel, view)
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', navigate)
  else navigate()
}

if (ownsSingleInstanceLock) {
  app.on('second-instance', () => {
    if (app.isReady()) openWindow()
  })
}

function configureDesktopLifecycle(): Promise<void> {
  if (
    nativeClient === undefined ||
    automaticActivation === undefined ||
    profileRepository === undefined
  ) {
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
  const trayMenu = new ElectronTrayMenu(trayIconPath(), (bounds) =>
    panelController.reopenLastPanel(bounds)
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
  previewController = new PreviewSessionController(nativeClient, automaticActivation, () =>
    scheduleProductStateBroadcast()
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
        const result =
          mainWindow === undefined
            ? await dialog.showOpenDialog(options)
            : await dialog.showOpenDialog(mainWindow, options)
        const executablePath = result.filePaths[0]
        if (result.canceled || executablePath === undefined) return null
        const executableName = basename(executablePath)
        return {
          executableName,
          executablePath,
          friendlyName: basename(executablePath, extname(executablePath)),
          iconDataUrl: await applicationIconDataUrl(executablePath)
        }
      },
      describe: async (application) => {
        if (
          application.path === null ||
          application.executable === null ||
          application.pid === process.pid
        )
          return null
        return {
          executableName: application.executable,
          executablePath: application.path,
          friendlyName: applicationFriendlyName(application.title, application.path),
          iconDataUrl: await applicationIconDataUrl(application.path)
        }
      },
      resolveIcon: applicationIconDataUrl
    },
    {
      get: () => settingsRepository.get(),
      save: (settings) => settingsRepository.save(settings),
      apply: (settings) => {
        currentSettings = settings
        app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup })
        applyTitleBarOverlay()
        miniPanelController.refreshSize()
      }
    },
    {
      refreshTray: () => trayController?.refresh() ?? Promise.resolve(),
      stateChanged: () => scheduleProductStateBroadcast()
    },
    app.getVersion()
  )
  return trayController.start()
}

async function applicationIconDataUrl(executablePath: string): Promise<string | null> {
  try {
    const icon = await app.getFileIcon(executablePath, { size: 'normal' })
    return icon.isEmpty() ? null : icon.toDataURL()
  } catch (error) {
    logger.write({
      level: 'warning',
      eventName: 'ApplicationIconReadFailed',
      executablePath,
      ...describeError(error)
    })
    return null
  }
}

function miniPanelHeightAdjustment(): number {
  const dark =
    currentSettings.theme === 'dark' ||
    (currentSettings.theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? 0 : 6
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
    void controller
      .getStateForBroadcast()
      .then((state) => {
        for (const window of windows) {
          if (!window.webContents.isDestroyed()) {
            window.webContents.send(productIpcChannels.stateChanged, state)
          }
        }
      })
      .catch((error: unknown) => {
        logger.write({
          level: 'warning',
          eventName: 'ProductStateBroadcastFailed',
          ...describeError(error)
        })
      })
  }, 25)
}

registerProductIpcHandlers(
  ipcMain,
  () => productController,
  assertTrustedRenderer,
  () => shutdownCoordinator?.request('application') ?? Promise.resolve(false),
  openWindow,
  () => miniPanelController.hide(),
  () => panelController.openMiniPanel(),
  async (event) => {
    const contents = event.sender
    if (contents.isDevToolsOpened()) {
      contents.devToolsWebContents?.focus()
      return
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('The browser inspector did not open.')),
        5_000
      )
      contents.once('devtools-opened', () => {
        clearTimeout(timeout)
        resolve()
      })
      contents.openDevTools({ mode: 'detach', activate: true })
    })
  },
  (view) => miniPanelController.setView(view)
)

void app.whenReady().then(async () => {
  if (!ownsSingleInstanceLock) return
  currentSettings = await settingsRepository.get()
  app.setLoginItemSettings({ openAtLogin: currentSettings.launchAtStartup })
  nativeTheme.on('updated', () => applyTitleBarOverlay())
  await startNativeService()
  await configureDesktopLifecycle()
  if (!app.getLoginItemSettings().wasOpenedAtLogin || currentSettings.launchBehavior === 'app') {
    openWindow()
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
