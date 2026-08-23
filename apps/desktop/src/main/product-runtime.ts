import { basename, extname } from 'node:path'
import {
  describeMigrationNotice,
  JsonProfileRepository,
  type ProfileRepository
} from '@chromashift/core'
import { NativeClient, PROTOCOL_VERSION } from '@chromashift/native-client'
import { ActivationCoordinator } from './activation-coordinator.js'
import type { UserPreferences } from '../shared/product-api.js'
import type { ChromaShiftIntent } from './app-settings.js'
import { attachActivationOutcomeRouter } from './activation-outcome-router.js'
import { applicationFriendlyName } from './application-friendly-name.js'
import { AutomaticActivationController } from './automatic-activation-controller.js'
import { ChromaShiftController } from './chroma-shift-controller.js'
import { DisplayTransitionController } from './display-transition-controller.js'
import { EmergencyRestoreController } from './emergency-restore-controller.js'
import { attachNativeEventRouter } from './native-event-router.js'
import {
  nativeRecoveryTerminalMessage,
  nativeRecoveryTerminalTitle
} from './native-recovery-user-message.js'
import { NativeServiceRecoveryController } from './native-service-recovery-controller.js'
import { PhysicalDisplayClient } from './physical-display-client.js'
import { rewriteProfilesForPhysicalDisplays } from './physical-display-profile-rewrite.js'
import { PowerEventAdapter, type PowerMonitorPort } from './power-event-adapter.js'
import { PreviewSessionController } from './preview-session-controller.js'
import { ProductController } from './product-controller.js'
import { migrateLegacyProfileConfiguration } from './profile-configuration-migration.js'
import { AppDataProfileConfigurationStorage } from './profile-configuration-storage.js'
import {
  ProfileNotificationController,
  type ProductNotificationPort
} from './profile-notification-controller.js'
import {
  EMERGENCY_RESTORE_ACCELERATOR,
  ShortcutController,
  type ShortcutRegistrationPort
} from './shortcut-controller.js'
import { ShutdownCoordinator, type ShutdownApplicationPort } from './shutdown-coordinator.js'
import { describeError, type StructuredLogger } from './structured-logger.js'
import { TrayController, type TrayMenuPort } from './tray-controller.js'

export interface ProductRuntimePorts {
  logger: StructuredLogger
  configuration: {
    profileConfigurationPath: string
    legacyProfileConfigurationPaths: string[]
    resolveServicePath: () => string
    appVersion: string
  }
  settings: {
    preferences: {
      current: () => UserPreferences
      get: () => Promise<UserPreferences>
      update: (updater: (current: UserPreferences) => UserPreferences) => Promise<UserPreferences>
      applyToShell: (preferences: UserPreferences) => void
    }
    chromaShiftIntent: {
      current: () => ChromaShiftIntent
      update: (
        updater: (current: ChromaShiftIntent) => ChromaShiftIntent
      ) => Promise<ChromaShiftIntent>
    }
  }
  shell: {
    openWindow: () => void
    openProfile: (profileId: string | null) => void
    openAppPanel: () => void
    openMiniPanel: () => void
    createTrayMenu: () => Promise<TrayMenuPort>
    broadcastProductState: () => void
  }
  dialogs: {
    showError: (title: string, message: string) => void
    confirmShutdownRetry: (title: string, message: string) => Promise<'retry' | 'cancel'>
    warnShortcutsUnavailable: (message: string) => void
    pickApplicationFile: () => Promise<string | null>
  }
  icons: {
    applicationIconDataUrl: (executablePath: string) => Promise<string | null>
  }
  system: {
    application: ShutdownApplicationPort
    shortcutRegistrations: ShortcutRegistrationPort
    powerMonitor: PowerMonitorPort
    registerEmergencyRestoreShortcut: (handler: () => void) => boolean
    onDisplayEvent: (
      listener: (event: 'displayAdded' | 'displayRemoved' | 'displayMetricsChanged') => void
    ) => void
  }
  notifications: ProductNotificationPort
}

/**
 * Owns the product side of the desktop process: the native client, the domain
 * controllers, and every subscription between them. The Electron shell reaches
 * product behavior only through this interface, and the runtime reaches the
 * shell only through its ports.
 */
export class ProductRuntime {
  #nativeClient: NativeClient | undefined
  #physicalDisplayClient: PhysicalDisplayClient | undefined
  #profileRepository: ProfileRepository | undefined
  #automaticActivation: AutomaticActivationController | undefined
  #startupForegroundApplication:
    Awaited<ReturnType<NativeClient['getForegroundApplication']>> | undefined
  #trayController: TrayController | undefined
  #shutdownCoordinator: ShutdownCoordinator | undefined
  #productController: ProductController | undefined
  #previewController: PreviewSessionController | undefined
  #displayTransitionController: DisplayTransitionController | undefined
  #powerEventAdapter: PowerEventAdapter | undefined
  #nativeRecoveryController: NativeServiceRecoveryController | undefined
  #unsubscribeOutcomeRouter: (() => void) | undefined
  #shortcutController: ShortcutController | undefined

  public constructor(private readonly ports: ProductRuntimePorts) {}

  public get productController(): ProductController | undefined {
    return this.#productController
  }

  public get shutdownCoordinator(): ShutdownCoordinator | undefined {
    return this.#shutdownCoordinator
  }

  public get previewController(): PreviewSessionController | undefined {
    return this.#previewController
  }

  public async start(): Promise<void> {
    await this.#startNativeService()
    await this.#configureProductLifecycle()
  }

  public dispose(): void {
    this.#unsubscribeOutcomeRouter?.()
    this.#unsubscribeOutcomeRouter = undefined
    this.#powerEventAdapter?.dispose()
    this.#displayTransitionController?.dispose()
    this.#shortcutController?.dispose()
    this.#shortcutController = undefined
    this.#trayController?.dispose()
  }

  async #startNativeService(): Promise<void> {
    const { logger, configuration } = this.ports
    const configurationPath = configuration.profileConfigurationPath
    try {
      const migratedFrom = await migrateLegacyProfileConfiguration(
        configurationPath,
        configuration.legacyProfileConfigurationPaths
      )
      if (migratedFrom !== null) {
        logger.write({
          level: 'information',
          eventName: 'ProfileConfigurationMigrated',
          sourcePath: migratedFrom,
          destinationPath: configurationPath
        })
      }
      const nativeClient = new NativeClient({
        executablePath: configuration.resolveServicePath(),
        executableArguments: [`--parent-pid=${process.pid}`],
        detached: process.platform === 'win32'
      })
      this.#nativeClient = nativeClient
      this.#profileRepository = new JsonProfileRepository(
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
      this.#physicalDisplayClient = physicalClient
      const coordinator = new ActivationCoordinator(this.#profileRepository, physicalClient, logger)
      this.#automaticActivation = new AutomaticActivationController(
        this.#profileRepository,
        coordinator,
        logger,
        (application) => application?.pid === process.pid
      )
      attachNativeEventRouter(nativeClient, {
        activation: () => this.#automaticActivation,
        displayTransitions: () => this.#displayTransitionController,
        recovery: () => this.#nativeRecoveryController,
        isExiting: () => this.#shutdownCoordinator?.exiting === true,
        broadcastProductState: () => this.ports.shell.broadcastProductState(),
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
          this.#profileRepository,
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
      this.#startupForegroundApplication = await nativeClient.getForegroundApplication()
    } catch (error) {
      logger.write({
        level: 'error',
        eventName: 'NativeServiceStartupFailed',
        ...describeError(error)
      })
    }
  }

  async #configureProductLifecycle(): Promise<void> {
    const { logger, settings, shell, dialogs, icons, system, notifications, configuration } =
      this.ports
    const nativeClient = this.#nativeClient
    const physicalDisplayClient = this.#physicalDisplayClient
    const automaticActivation = this.#automaticActivation
    const profileRepository = this.#profileRepository
    if (
      nativeClient === undefined ||
      physicalDisplayClient === undefined ||
      automaticActivation === undefined ||
      profileRepository === undefined
    ) {
      return
    }

    this.#shutdownCoordinator = new ShutdownCoordinator(
      automaticActivation,
      nativeClient,
      system.application,
      {
        show: () => shell.openWindow(),
        showError: (title, message) => dialogs.confirmShutdownRetry(title, message)
      },
      logger
    )
    const previewController = new PreviewSessionController(
      physicalDisplayClient,
      automaticActivation,
      () => shell.broadcastProductState()
    )
    this.#previewController = previewController
    const chromaShiftController = new ChromaShiftController(
      automaticActivation,
      {
        refreshTopology: () => nativeClient.refreshDisplayTopology(),
        getForegroundApplication: () => nativeClient.getForegroundApplication()
      },
      { cancel: () => previewController.cancel() },
      {
        status: settings.chromaShiftIntent.current().chromaShiftStatus,
        pendingOperation: settings.chromaShiftIntent.current().pendingControlOperation,
        intendedMode: settings.chromaShiftIntent.current().intendedActivationMode,
        intendedTarget: settings.chromaShiftIntent.current().intendedTarget
      },
      async (state) => {
        await settings.chromaShiftIntent.update((intent) => ({
          ...intent,
          chromaShiftStatus: state.status,
          pendingControlOperation: state.pendingOperation ?? null,
          intendedActivationMode: state.intendedMode,
          intendedTarget: state.intendedTarget
        }))
        shell.broadcastProductState()
      },
      logger
    )
    try {
      if (settings.chromaShiftIntent.current().chromaShiftStatus === 'active') {
        await automaticActivation.start(this.#startupForegroundApplication ?? null)
        await chromaShiftController.syncActiveIntent()
      } else {
        await automaticActivation.startSuspended(
          this.#startupForegroundApplication ?? null,
          settings.chromaShiftIntent.current().intendedActivationMode,
          settings.chromaShiftIntent.current().intendedTarget
        )
      }
    } catch (error) {
      logger.write({
        level: 'error',
        eventName: 'AutomaticActivationUnavailable',
        ...describeError(error)
      })
    }
    const trayController = new TrayController(
      profileRepository,
      chromaShiftController,
      {
        openAppPanel: () => shell.openAppPanel(),
        openMiniPanel: () => shell.openMiniPanel()
      },
      this.#shutdownCoordinator,
      await shell.createTrayMenu(),
      logger
    )
    this.#trayController = trayController
    const profileNotifications = new ProfileNotificationController(
      profileRepository,
      () => settings.preferences.current(),
      notifications,
      (profileId) => shell.openProfile(profileId)
    )
    this.#unsubscribeOutcomeRouter = attachActivationOutcomeRouter(
      automaticActivation,
      chromaShiftController,
      profileNotifications,
      () => shell.broadcastProductState(),
      logger
    )
    this.#nativeRecoveryController = new NativeServiceRecoveryController(
      nativeClient,
      {
        handleNativeServiceExit: () => automaticActivation.handleNativeServiceExit(),
        start: (application) => {
          const state = chromaShiftController.chromaShiftState
          return state.status === 'active'
            ? automaticActivation.start(application)
            : automaticActivation.startSuspended(
                application,
                state.intendedMode,
                state.intendedTarget
              )
        }
      },
      () => this.#shutdownCoordinator?.exiting === true,
      {
        recovered: () => {
          void chromaShiftController.syncActiveIntent()
          shell.broadcastProductState()
          void trayController.refresh()
        },
        terminal: () => {
          shell.openWindow()
          dialogs.showError(nativeRecoveryTerminalTitle, nativeRecoveryTerminalMessage)
        }
      },
      logger
    )
    const emergencyRestoreController = new EmergencyRestoreController(
      previewController,
      automaticActivation,
      logger
    )
    if (
      !system.registerEmergencyRestoreShortcut(() => {
        void emergencyRestoreController.request().then((restored) => {
          if (!restored) {
            dialogs.showError(
              'Emergency restore failed',
              'ChromaShift could not confirm that every captured display baseline was restored.'
            )
          }
          shell.broadcastProductState()
        })
      })
    ) {
      logger.write({
        level: 'warning',
        eventName: 'EmergencyRestoreShortcutUnavailable',
        shortcut: EMERGENCY_RESTORE_ACCELERATOR
      })
    }
    const shortcutController = new ShortcutController(
      system.shortcutRegistrations,
      profileRepository,
      {
        get currentTarget() {
          return chromaShiftController.chromaShiftState.intendedTarget ?? null
        },
        selectManualProfile: (profileId) =>
          chromaShiftController.selectManualProfile(profileId, 'shortcut'),
        enableAutomatic: () => chromaShiftController.enableAutomatic('shortcut'),
        toggleChromaShift: () => chromaShiftController.toggle('shortcut')
      },
      async () => {
        await trayController.refresh()
        shell.broadcastProductState()
      },
      logger
    )
    this.#shortcutController = shortcutController
    try {
      shortcutController.replace(settings.preferences.current().shortcutBindings)
      const normalizedBindings = shortcutController.bindings
      if (
        JSON.stringify(normalizedBindings) !==
        JSON.stringify(settings.preferences.current().shortcutBindings)
      ) {
        await settings.preferences.update((preferences) => ({
          ...preferences,
          shortcutBindings: normalizedBindings
        }))
      }
    } catch (error) {
      logger.write({
        level: 'warning',
        eventName: 'ShortcutRegistrationFailed',
        ...describeError(error)
      })
      dialogs.warnShortcutsUnavailable(describeError(error).message)
    }
    this.#displayTransitionController = new DisplayTransitionController(
      nativeClient,
      automaticActivation,
      previewController,
      logger,
      750,
      () => {
        this.#productController?.invalidateHardwareCache()
        shell.broadcastProductState()
        if (chromaShiftController.chromaShiftState.status === 'safetyBlocked') {
          void chromaShiftController.retrySafetyCheck('automatic')
        }
      }
    )
    this.#powerEventAdapter = new PowerEventAdapter(system.powerMonitor)
    this.#powerEventAdapter.start((event) =>
      this.#displayTransitionController?.handlePowerEvent(event)
    )
    system.onDisplayEvent((event) => this.#displayTransitionController?.handleDisplayEvent(event))
    this.#productController = new ProductController(
      profileRepository,
      physicalDisplayClient,
      chromaShiftController,
      previewController,
      {
        pick: async () => {
          const executablePath = await dialogs.pickApplicationFile()
          if (executablePath === null) return null
          return {
            executableName: basename(executablePath),
            executablePath,
            friendlyName: basename(executablePath, extname(executablePath)),
            iconDataUrl: await icons.applicationIconDataUrl(executablePath)
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
            iconDataUrl: await icons.applicationIconDataUrl(application.path)
          }
        },
        resolveIcon: (executablePath) => icons.applicationIconDataUrl(executablePath)
      },
      {
        get: () => settings.preferences.get(),
        save: (value) => settings.preferences.update(() => value),
        apply: (value) => settings.preferences.applyToShell(value),
        prepareShortcuts: (bindings) => {
          const controller = this.#shortcutController
          if (controller === undefined) throw new Error('Shortcut registration is unavailable.')
          const rollback = controller.replace(bindings)
          return { bindings: controller.bindings, rollback }
        }
      },
      {
        refreshTray: () => trayController.refresh(),
        stateChanged: () => shell.broadcastProductState()
      },
      configuration.appVersion
    )
    return trayController.start()
  }
}

export function createProductRuntime(ports: ProductRuntimePorts): ProductRuntime {
  return new ProductRuntime(ports)
}
