import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  screen,
  type IpcMainInvokeEvent,
  type NativeImage,
  type OpenDialogOptions
} from 'electron'
import { join, resolve } from 'node:path'
import { NativeClient } from '@chromashift/native-client'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, resolveWindowBounds } from '../shared/layout.js'
import { productIpcChannels, type AppPanelView } from '../shared/product-api.js'
import { AppWindowStateController } from './app-window-state-controller.js'
import { createSettingsStores } from './app-settings.js'
import { findGitWorktreeRoot, resolveApplicationDataPaths } from './application-data-path.js'
import { ElectronNotificationPort } from './electron-notification.js'
import { resolveDisplayServicePath } from './display-service-path.js'
import { ElectronTrayMenu } from './electron-tray-menu.js'
import { MiniPanelController } from './mini-panel-controller.js'
import { PanelController } from './panel-controller.js'
import { registerProductIpcHandlers } from './product-ipc.js'
import { createProductRuntime } from './product-runtime.js'
import {
  RendererRecoveryController,
  type RendererExitReason,
  type RendererSurface
} from './renderer-recovery-controller.js'
import { isSameDocumentNavigation, isTrustedRendererUrl } from './renderer-security.js'
import { EMERGENCY_RESTORE_ACCELERATOR } from './shortcut-controller.js'
import { describeError, PersistentJsonLogger, readDiagnosticLog } from './structured-logger.js'
import { WindowController } from './window-controller.js'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-software-rasterizer')
if (process.platform === 'win32') app.setAppUserModelId('com.chromashift.desktop')

let mainWindow: BrowserWindow | undefined
let miniWindow: BrowserWindow | undefined
let productStateBroadcastPending = false
const TITLE_BAR_HEIGHT = 37
const hasUserDataOverride = app.commandLine.hasSwitch('user-data-dir')
const developmentWorktreeRoot = app.isPackaged
  ? undefined
  : findGitWorktreeRoot([process.cwd(), app.getAppPath()])
const applicationDataPaths = resolveApplicationDataPaths(
  app.getPath('appData'),
  hasUserDataOverride ? app.getPath('userData') : undefined,
  developmentWorktreeRoot
)
const diagnosticLogPath = join(applicationDataPaths.userDataDirectory, 'logs', 'main.jsonl')
const logger = new PersistentJsonLogger(diagnosticLogPath)
const rendererRecoveryController = new RendererRecoveryController(logger)
const settingsStores = createSettingsStores(applicationDataPaths.userDataDirectory)
const appWindowStateController = new AppWindowStateController(
  settingsStores.windowState,
  () => screen.getAllDisplays().map((display) => display.workArea),
  logger
)
if (!hasUserDataOverride) app.setPath('userData', applicationDataPaths.userDataDirectory)
logger.write({
  level: 'information',
  eventName: 'ApplicationStarted',
  processId: process.pid,
  version: app.getVersion(),
  packaged: app.isPackaged,
  userDataDirectory: applicationDataPaths.userDataDirectory,
  developmentWorktreeRoot
})
const ownsSingleInstanceLock = app.requestSingleInstanceLock()
if (!ownsSingleInstanceLock) app.quit()
const windowController = new WindowController(
  () => mainWindow,
  () => createWindow(),
  () => runtime.shutdownCoordinator?.exiting === true
)
const miniPanelController = new MiniPanelController(
  () => miniWindow,
  () => createMiniWindow(),
  (bounds) => screen.getDisplayMatching(bounds),
  () => settingsStores.windowState.current.miniPanelPosition,
  (position) => saveMiniPanelPosition(position),
  () => miniPanelHeightAdjustment()
)
const panelController = new PanelController(
  () => mainWindow,
  () => miniWindow,
  () => windowController.open(),
  () => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) return
    window.hide()
    // Let the renderer receive the successful handoff response, then release
    // it through the same close lifecycle used by close-to-tray.
    setTimeout(() => {
      if (mainWindow === window && !window.isDestroyed() && !window.isVisible()) window.close()
    }, 250)
  },
  (bounds) => miniPanelController.show(bounds),
  () => miniPanelController.hide()
)
const runtime = createProductRuntime({
  logger,
  configuration: {
    profileConfigurationPath: applicationDataPaths.profileConfigurationPath,
    legacyProfileConfigurationPaths: applicationDataPaths.legacyProfileConfigurationPaths,
    appVersion: app.getVersion()
  },
  native: {
    createClient: () =>
      new NativeClient({
        executablePath: servicePath(),
        executableArguments: [`--parent-pid=${process.pid}`],
        detached: process.platform === 'win32'
      })
  },
  settings: {
    preferences: {
      current: () => settingsStores.preferences.current,
      get: () => settingsStores.preferences.load(),
      update: (updater) => settingsStores.preferences.update(updater),
      applyToShell: (preferences) => {
        app.setLoginItemSettings({ openAtLogin: preferences.launchAtStartup })
        applyTitleBarOverlay()
        miniPanelController.refreshSize()
      }
    },
    chromaShiftIntent: {
      current: () => settingsStores.chromaShiftIntent.current,
      update: (updater) => settingsStores.chromaShiftIntent.update(updater)
    }
  },
  shell: {
    openWindow: () => openWindow(),
    openProfile: (profileId) => openProfile(profileId),
    openAppPanel: () => panelController.openAppPanel(),
    openMiniPanel: () => panelController.openMiniPanel(),
    createTrayMenu: async () =>
      new ElectronTrayMenu(await loadTrayIcon(), (bounds) =>
        panelController.reopenLastPanel(bounds)
      ),
    broadcastProductState: () => scheduleProductStateBroadcast()
  },
  dialogs: {
    showError: (title, message) => dialog.showErrorBox(title, message),
    confirmShutdownRetry: async (title, message) => {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title,
        message,
        buttons: ['Try again', 'Keep ChromaShift running'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      return result.response === 0 ? 'retry' : 'cancel'
    },
    warnShortcutsUnavailable: (message) => {
      void dialog.showMessageBox({
        type: 'warning',
        title: 'Shortcuts unavailable',
        message,
        detail:
          'Your saved shortcuts were not changed. Open Shortcut settings to choose another binding.',
        buttons: ['OK'],
        noLink: true
      })
    },
    pickApplicationFile: async () => {
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
      return executablePath
    }
  },
  icons: {
    applicationIconDataUrl: (executablePath) => applicationIconDataUrl(executablePath)
  },
  system: {
    application: app,
    shortcutRegistrations: globalShortcut,
    powerMonitor,
    registerEmergencyRestoreShortcut: (handler) =>
      globalShortcut.register(EMERGENCY_RESTORE_ACCELERATOR, handler),
    onDisplayEvent: (listener) => {
      screen.on('display-added', () => listener('displayAdded'))
      screen.on('display-removed', () => listener('displayRemoved'))
      screen.on('display-metrics-changed', () => listener('displayMetricsChanged'))
    }
  },
  notifications: new ElectronNotificationPort(logger)
})

function saveMiniPanelPosition(position: { x: number; y: number }): void {
  const currentPosition = settingsStores.windowState.current.miniPanelPosition
  if (currentPosition?.x === position.x && currentPosition.y === position.y) return
  void settingsStores.windowState
    .update((state) => ({ ...state, miniPanelPosition: position }))
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
    settingsStores.preferences.current.theme === 'dark' ||
    (settingsStores.preferences.current.theme === 'system' && nativeTheme.shouldUseDarkColors)
  return {
    color: dark ? '#111114' : '#f1f1f3',
    symbolColor: dark ? '#f1f1f3' : '#111114',
    height: TITLE_BAR_HEIGHT
  }
}

function appPanelBackgroundColor(): string {
  const dark =
    settingsStores.preferences.current.theme === 'dark' ||
    (settingsStores.preferences.current.theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#111114' : '#f1f1f3'
}

function applyTitleBarOverlay(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  mainWindow.setTitleBarOverlay(titleBarOverlayOptions())
  mainWindow.setBackgroundColor(appPanelBackgroundColor())
  // Blend Windows' resizable-frame accent into the app instead of drawing a second border.
  if (process.platform === 'win32') mainWindow.setAccentColor(appPanelBackgroundColor())
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

async function loadTrayIcon(): Promise<NativeImage> {
  if (app.isPackaged) return app.getFileIcon(process.execPath, { size: 'small' })
  return nativeImage.createFromPath(resolve(app.getAppPath(), 'build', 'icon.png'))
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url
  if (senderUrl === undefined) throw new Error('Renderer IPC sender is unavailable.')
  if (
    isTrustedRendererUrl(
      senderUrl,
      join(__dirname, '../renderer/index.html'),
      process.env['ELECTRON_RENDERER_URL']
    )
  )
    return
  throw new Error(`Renderer IPC sender is not trusted: ${senderUrl}`)
}

function handleRendererExit(
  surface: RendererSurface,
  window: BrowserWindow,
  reason: RendererExitReason,
  recreate: () => void
): void {
  if (runtime.shutdownCoordinator?.exiting === true) return
  const wasVisible = window.isVisible()
  if (!window.isDestroyed()) window.destroy()
  if (!wasVisible) return
  rendererRecoveryController.handle(surface, reason, recreate, (message) => {
    dialog.showErrorBox('ChromaShift renderer stopped', message)
  })
}

function createWindow(): BrowserWindow {
  const bounds = resolveWindowBounds(
    settingsStores.windowState.current.windowBounds,
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
    logger.write({
      level: 'error',
      eventName: 'PreloadFailed',
      preloadPath,
      ...describeError(error)
    })
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    handleRendererExit('appPanel', window, details.reason as RendererExitReason, () => openWindow())
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isSameDocumentNavigation(window.webContents.getURL(), url)) event.preventDefault()
  })
  window.on('close', (event) => {
    appWindowStateController.flush(window)
    const wasExiting = runtime.shutdownCoordinator?.exiting === true
    if (!wasExiting && settingsStores.preferences.current.closeBehavior === 'shutdown') {
      event.preventDefault()
      void runtime.shutdownCoordinator?.request('application')
      return
    }
    if (!wasExiting) {
      window.webContents.send(productIpcChannels.appPanelClosed)
      void runtime.previewController?.cancelNonOverride().catch((error: unknown) => {
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
  if (settingsStores.windowState.current.windowMaximized === true) window.maximize()
  window.on('resize', () => appWindowStateController.schedule(window))
  window.on('move', () => appWindowStateController.schedule(window))
  window.on('maximize', () => appWindowStateController.schedule(window))
  window.on('unmaximize', () => appWindowStateController.schedule(window))
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
    logger.write({
      level: 'error',
      eventName: 'MiniPanelPreloadFailed',
      preloadPath,
      ...describeError(error)
    })
  })
  panel.webContents.on('render-process-gone', (_event, details) => {
    handleRendererExit('miniPanel', panel, details.reason as RendererExitReason, () =>
      miniPanelController.show()
    )
  })
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  panel.webContents.on('will-navigate', (event, url) => {
    if (!isSameDocumentNavigation(panel.webContents.getURL(), url)) event.preventDefault()
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

function openProfile(profileId: string | null): void {
  openWindow('profiles')
  if (profileId === null) return
  const window = mainWindow
  if (window === undefined || window.webContents.isDestroyed()) return
  const select = (): void =>
    window.webContents.send(productIpcChannels.selectAppPanelProfile, { profileId })
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', select)
  else select()
}

if (ownsSingleInstanceLock) {
  app.on('second-instance', () => {
    if (app.isReady()) openWindow()
  })
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
    settingsStores.preferences.current.theme === 'dark' ||
    (settingsStores.preferences.current.theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? 0 : 6
}

function scheduleProductStateBroadcast(): void {
  if (productStateBroadcastPending) return
  productStateBroadcastPending = true
  setTimeout(() => {
    productStateBroadcastPending = false
    const controller = runtime.productController
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
  () => runtime.productController,
  assertTrustedRenderer,
  () => runtime.shutdownCoordinator?.request('application') ?? Promise.resolve(false),
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
  (view, showColorTemperature) =>
    miniPanelController.setView(view, showColorTemperature),
  () => readDiagnosticLog(diagnosticLogPath)
)

void app.whenReady().then(async () => {
  if (!ownsSingleInstanceLock) return
  await Promise.all([
    settingsStores.preferences.load(),
    settingsStores.windowState.load(),
    settingsStores.chromaShiftIntent.load()
  ])
  app.setLoginItemSettings({ openAtLogin: settingsStores.preferences.current.launchAtStartup })
  nativeTheme.on('updated', () => applyTitleBarOverlay())
  await runtime.start()
  if (
    !app.getLoginItemSettings().wasOpenedAtLogin ||
    settingsStores.preferences.current.launchBehavior === 'app'
  ) {
    openWindow()
  }
  app.on('activate', () => openWindow())
})

app.on('window-all-closed', () => {
  // The tray keeps ChromaShift alive when windows are hidden or closed.
})

app.on('before-quit', (event) => {
  const coordinator = runtime.shutdownCoordinator
  if (coordinator === undefined || coordinator.state === 'complete') return
  event.preventDefault()
  void coordinator.request('application')
})

app.on('will-quit', () => {
  runtime.dispose()
  appWindowStateController.dispose()
  globalShortcut.unregister(EMERGENCY_RESTORE_ACCELERATOR)
})
