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
import { basename, extname, join, resolve } from 'node:path'
import {
  describeMigrationNotice,
  JsonProfileRepository,
  type ProfileRepository
} from '@chromashift/core'
import { NativeClient, PROTOCOL_VERSION } from '@chromashift/native-client'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, resolveWindowBounds } from '../shared/layout.js'
import { productIpcChannels, type AppPanelView } from '../shared/product-api.js'
import { ActivationCoordinator } from './activation-coordinator.js'
import { AppWindowStateController } from './app-window-state-controller.js'
import { AppSettingsRepository, defaultAppSettings } from './app-settings.js'
import { findGitWorktreeRoot, resolveApplicationDataPaths } from './application-data-path.js'
import { applicationFriendlyName } from './application-friendly-name.js'
import {
  AutomaticActivationController,
  type CompletedActivationOutcome
} from './automatic-activation-controller.js'
import { ChromaShiftController } from './chroma-shift-controller.js'
import { DisplayTransitionController } from './display-transition-controller.js'
import { ElectronNotificationPort } from './electron-notification.js'
import { EmergencyRestoreController } from './emergency-restore-controller.js'
import { resolveDisplayServicePath } from './display-service-path.js'
import { ElectronTrayMenu } from './electron-tray-menu.js'
import { AppDataProfileConfigurationStorage } from './profile-configuration-storage.js'
import { migrateLegacyProfileConfiguration } from './profile-configuration-migration.js'
import { MiniPanelController } from './mini-panel-controller.js'
import { attachNativeEventRouter } from './native-event-router.js'
import { NativeServiceRecoveryController } from './native-service-recovery-controller.js'
import {
  nativeRecoveryTerminalMessage,
  nativeRecoveryTerminalTitle
} from './native-recovery-user-message.js'
import { PanelController } from './panel-controller.js'
import { PhysicalDisplayClient } from './physical-display-client.js'
import { rewriteProfilesForPhysicalDisplays } from './physical-display-profile-rewrite.js'
import { ProfileNotificationController } from './profile-notification-controller.js'
import { registerProductIpcHandlers } from './product-ipc.js'
import { ProductController } from './product-controller.js'
import { PreviewSessionController } from './preview-session-controller.js'
import { PowerEventAdapter } from './power-event-adapter.js'
import {
  RendererRecoveryController,
  type RendererExitReason,
  type RendererSurface
} from './renderer-recovery-controller.js'
import { isSameDocumentNavigation, isTrustedRendererUrl } from './renderer-security.js'
import { ShutdownCoordinator } from './shutdown-coordinator.js'
import { EMERGENCY_RESTORE_ACCELERATOR, ShortcutController } from './shortcut-controller.js'
import { describeError, PersistentJsonLogger, readDiagnosticLog } from './structured-logger.js'
import { TrayController } from './tray-controller.js'
import { WindowController } from './window-controller.js'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-software-rasterizer')
if (process.platform === 'win32') app.setAppUserModelId('com.chromashift.desktop')

let mainWindow: BrowserWindow | undefined
let miniWindow: BrowserWindow | undefined
let nativeClient: NativeClient | undefined
let physicalDisplayClient: PhysicalDisplayClient | undefined
let profileRepository: ProfileRepository | undefined
let automaticActivation: AutomaticActivationController | undefined
let chromaShiftController: ChromaShiftController | undefined
let startupForegroundApplication: Awaited<ReturnType<NativeClient['getForegroundApplication']>>
let trayController: TrayController | undefined
let shutdownCoordinator: ShutdownCoordinator | undefined
let productController: ProductController | undefined
let previewController: PreviewSessionController | undefined
let displayTransitionController: DisplayTransitionController | undefined
let powerEventAdapter: PowerEventAdapter | undefined
let nativeRecoveryController: NativeServiceRecoveryController | undefined
let emergencyRestoreController: EmergencyRestoreController | undefined
let unsubscribeProfileNotifications: (() => void) | undefined
let shortcutController: ShortcutController | undefined
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
const settingsRepository = new AppSettingsRepository(applicationDataPaths.settingsPath)
let currentSettings = defaultAppSettings
const appWindowStateController = new AppWindowStateController(
  () => currentSettings,
  (settings) => {
    currentSettings = settings
  },
  (settings) => settingsRepository.save(settings),
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
  if (shutdownCoordinator?.exiting === true) return
  const wasVisible = window.isVisible()
  if (!window.isDestroyed()) window.destroy()
  if (!wasVisible) return
  rendererRecoveryController.handle(surface, reason, recreate, (message) => {
    dialog.showErrorBox('ChromaShift renderer stopped', message)
  })
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
    const physicalClient = new PhysicalDisplayClient(nativeClient)
    physicalDisplayClient = physicalClient
    const coordinator = new ActivationCoordinator(profileRepository, physicalClient, logger)
    automaticActivation = new AutomaticActivationController(
      profileRepository,
      coordinator,
      logger,
      (application) => application?.pid === process.pid
    )
    attachNativeEventRouter(nativeClient, {
      activation: () => automaticActivation,
      displayTransitions: () => displayTransitionController,
      recovery: () => nativeRecoveryController,
      isExiting: () => shutdownCoordinator?.exiting === true,
      broadcastProductState: () => scheduleProductStateBroadcast(),
      logger
    })
    const info = await nativeClient.start()
    const health = await nativeClient.getServiceHealth()
    if (
      info.protocolVersion !== PROTOCOL_VERSION ||
      health.protocolVersion !== PROTOCOL_VERSION ||
      info.serviceVersion !== health.serviceVersion ||
      !health.watchdogArmed
    ) {
      throw new Error('DisplayService failed its startup health/version handshake.')
    }
    logger.write({
      level: 'information',
      eventName: 'NativeServiceHealthVerified',
      processId: health.processId,
      serviceVersion: health.serviceVersion,
      serviceInstanceId: health.serviceInstanceId,
      baselineOwnerId: health.baselineOwnerId,
      watchdogArmed: health.watchdogArmed
    })
    try {
      const identityRewrite = await rewriteProfilesForPhysicalDisplays(
        profileRepository,
        await physicalClient.getDisplays()
      )
      if (identityRewrite.rewrittenProfiles > 0) {
        logger.write({
          level: identityRewrite.discardedConflicts > 0 ? 'warning' : 'information',
          eventName: 'ProfileDisplayIdentityRewritten',
          ...identityRewrite
        })
      }
    } catch (error) {
      logger.write({
        level: 'warning',
        eventName: 'ProfileDisplayIdentityRewriteFailed',
        ...describeError(error)
      })
    }
    startupForegroundApplication = await nativeClient.getForegroundApplication()
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

async function configureDesktopLifecycle(): Promise<void> {
  if (
    nativeClient === undefined ||
    physicalDisplayClient === undefined ||
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
      showError: async (title, message) => {
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
      }
    },
    logger
  )
  previewController = new PreviewSessionController(physicalDisplayClient, automaticActivation, () =>
    scheduleProductStateBroadcast()
  )
  chromaShiftController = new ChromaShiftController(
    automaticActivation,
    {
      refreshTopology: () => nativeClient!.refreshDisplayTopology(),
      getForegroundApplication: () => nativeClient!.getForegroundApplication()
    },
    { cancel: () => previewController!.cancel() },
    {
      status: currentSettings.chromaShiftStatus,
      pendingOperation: currentSettings.pendingControlOperation,
      intendedMode: currentSettings.intendedActivationMode,
      intendedTarget: currentSettings.intendedTarget
    },
    async (state) => {
      currentSettings = await settingsRepository.save({
        ...currentSettings,
        chromaShiftStatus: state.status,
        pendingControlOperation: state.pendingOperation ?? null,
        intendedActivationMode: state.intendedMode,
        intendedTarget: state.intendedTarget
      })
      scheduleProductStateBroadcast()
    },
    logger
  )
  try {
    if (currentSettings.chromaShiftStatus === 'active') {
      await automaticActivation.start(startupForegroundApplication ?? null)
      await chromaShiftController.syncActiveIntent()
    } else {
      await automaticActivation.startSuspended(
        startupForegroundApplication ?? null,
        currentSettings.intendedActivationMode,
        currentSettings.intendedTarget
      )
    }
  } catch (error) {
    logger.write({
      level: 'error',
      eventName: 'AutomaticActivationUnavailable',
      ...describeError(error)
    })
  }
  const trayMenu = new ElectronTrayMenu(await loadTrayIcon(), (bounds) =>
    panelController.reopenLastPanel(bounds)
  )
  trayController = new TrayController(
    profileRepository,
    chromaShiftController,
    {
      openAppPanel: () => panelController.openAppPanel(),
      openMiniPanel: () => panelController.openMiniPanel()
    },
    shutdownCoordinator,
    trayMenu,
    logger
  )
  automaticActivation.subscribe(() => {
    void chromaShiftController?.syncActiveIntent().catch((error: unknown) => {
      logger.write({
        level: 'error',
        eventName: 'ChromaShiftIntentPersistenceFailed',
        ...describeError(error)
      })
    })
    scheduleProductStateBroadcast()
  })
  const profileNotifications = new ProfileNotificationController(
    profileRepository,
    () => currentSettings,
    new ElectronNotificationPort(logger),
    openProfile
  )
  const handleNotificationOutcome = (outcome: CompletedActivationOutcome): void => {
    void chromaShiftController?.recordCompletedOutcome(outcome).catch((error: unknown) => {
      logger.write({
        level: 'error',
        eventName: 'ChromaShiftIntentPersistenceFailed',
        ...describeError(error)
      })
    })
    void profileNotifications.handle(outcome).catch((error: unknown) => {
      logger.write({
        level: 'error',
        eventName: 'ProfileNotificationFailed',
        message: describeError(error)
      })
    })
  }
  const finalizedControlOrigins = new Set<CompletedActivationOutcome['origin']>([
    'pause',
    'resume',
    'safetyRetry',
    'originalSettingsRestore'
  ])
  const unsubscribeActivationNotifications = automaticActivation.subscribeOutcomes((outcome) => {
    if (!finalizedControlOrigins.has(outcome.origin)) handleNotificationOutcome(outcome)
  })
  const unsubscribeOperationalNotifications =
    chromaShiftController.subscribeOperationalOutcomes(handleNotificationOutcome)
  unsubscribeProfileNotifications = () => {
    unsubscribeActivationNotifications()
    unsubscribeOperationalNotifications()
  }
  nativeRecoveryController = new NativeServiceRecoveryController(
    nativeClient,
    {
      handleNativeServiceExit: () => automaticActivation!.handleNativeServiceExit(),
      start: (application) => {
        const state = chromaShiftController!.chromaShiftState
        return state.status === 'active'
          ? automaticActivation!.start(application)
          : automaticActivation!.startSuspended(
              application,
              state.intendedMode,
              state.intendedTarget
            )
      }
    },
    () => shutdownCoordinator?.exiting === true,
    {
      recovered: () => {
        void chromaShiftController?.syncActiveIntent()
        scheduleProductStateBroadcast()
        void trayController?.refresh()
      },
      terminal: () => {
        openWindow()
        dialog.showErrorBox(nativeRecoveryTerminalTitle, nativeRecoveryTerminalMessage)
      }
    },
    logger
  )
  emergencyRestoreController = new EmergencyRestoreController(
    previewController,
    automaticActivation,
    logger
  )
  if (
    !globalShortcut.register(EMERGENCY_RESTORE_ACCELERATOR, () => {
      void emergencyRestoreController?.request().then((restored) => {
        if (!restored) {
          dialog.showErrorBox(
            'Emergency restore failed',
            'ChromaShift could not confirm that every captured display baseline was restored.'
          )
        }
        scheduleProductStateBroadcast()
      })
    })
  ) {
    logger.write({
      level: 'warning',
      eventName: 'EmergencyRestoreShortcutUnavailable',
      shortcut: EMERGENCY_RESTORE_ACCELERATOR
    })
  }
  shortcutController = new ShortcutController(
    globalShortcut,
    profileRepository,
    {
      get currentTarget() {
        return chromaShiftController?.chromaShiftState.intendedTarget ?? null
      },
      selectManualProfile: (profileId) =>
        chromaShiftController!.selectManualProfile(profileId, 'shortcut'),
      enableAutomatic: () => chromaShiftController!.enableAutomatic('shortcut'),
      toggleChromaShift: () => chromaShiftController!.toggle('shortcut')
    },
    async () => {
      await trayController?.refresh()
      scheduleProductStateBroadcast()
    },
    logger
  )
  try {
    shortcutController.replace(currentSettings.shortcutBindings)
    const normalizedBindings = shortcutController.bindings
    if (JSON.stringify(normalizedBindings) !== JSON.stringify(currentSettings.shortcutBindings)) {
      currentSettings = await settingsRepository.save({
        ...currentSettings,
        shortcutBindings: normalizedBindings
      })
    }
  } catch (error) {
    logger.write({
      level: 'warning',
      eventName: 'ShortcutRegistrationFailed',
      ...describeError(error)
    })
    void dialog.showMessageBox({
      type: 'warning',
      title: 'Shortcuts unavailable',
      message: describeError(error).message,
      detail:
        'Your saved shortcuts were not changed. Open Shortcut settings to choose another binding.',
      buttons: ['OK'],
      noLink: true
    })
  }
  displayTransitionController = new DisplayTransitionController(
    nativeClient,
    automaticActivation,
    previewController,
    logger,
    750,
    () => {
      productController?.invalidateHardwareCache()
      scheduleProductStateBroadcast()
      if (chromaShiftController?.chromaShiftState.status === 'safetyBlocked') {
        void chromaShiftController.retrySafetyCheck('automatic')
      }
    }
  )
  powerEventAdapter = new PowerEventAdapter(powerMonitor)
  powerEventAdapter.start((event) => displayTransitionController?.handlePowerEvent(event))
  screen.on('display-added', () => displayTransitionController?.handleDisplayEvent('displayAdded'))
  screen.on('display-removed', () =>
    displayTransitionController?.handleDisplayEvent('displayRemoved')
  )
  screen.on('display-metrics-changed', () =>
    displayTransitionController?.handleDisplayEvent('displayMetricsChanged')
  )
  productController = new ProductController(
    profileRepository,
    physicalDisplayClient,
    chromaShiftController,
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
      },
      prepareShortcuts: (bindings) => {
        const controller = shortcutController
        if (controller === undefined) throw new Error('Shortcut registration is unavailable.')
        const rollback = controller.replace(bindings)
        return { bindings: controller.bindings, rollback }
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
  (view) => miniPanelController.setView(view),
  () => readDiagnosticLog(diagnosticLogPath)
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

app.on('will-quit', () => {
  unsubscribeProfileNotifications?.()
  unsubscribeProfileNotifications = undefined
  appWindowStateController.dispose()
  powerEventAdapter?.dispose()
  displayTransitionController?.dispose()
  shortcutController?.dispose()
  shortcutController = undefined
  globalShortcut.unregister(EMERGENCY_RESTORE_ACCELERATOR)
  trayController?.dispose()
})
