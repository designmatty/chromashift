import { basename, dirname, extname, join } from 'node:path'
import {
  describeMigrationNotice,
  JsonProfileRepository,
  type ProfileRepository
} from '@chromashift/core'
import type { ForegroundApplication } from '@chromashift/native-client'
import { ActivationCoordinator } from '@main/activation-coordinator.js'
import type { UserPreferences } from '@shared/product-api.js'
import type { ChromaShiftIntent } from '@main/app-settings.js'
import { attachActivationOutcomeRouter } from '@main/activation-outcome-router.js'
import { applicationFriendlyName } from '@main/application-friendly-name.js'
import { AutomaticActivationController } from '@main/automatic-activation-controller.js'
import { ChromaShiftController } from '@main/chroma-shift-controller.js'
import { DisplayTransitionController } from '@main/display-transition-controller.js'
import { EmergencyRestoreController } from '@main/emergency-restore-controller.js'
import { attachNativeEventRouter, type NativeEventSource } from '@main/native-event-router.js'
import {
  nativeRecoveryTerminalMessage,
  nativeRecoveryTerminalTitle
} from '@main/native-recovery-user-message.js'
import {
  NativeServiceRecoveryController,
  type RecoverableNativeServicePort
} from '@main/native-service-recovery-controller.js'
import { PhysicalDisplayClient, type EndpointDisplayPort } from '@main/physical-display-client.js'
import { rewriteProfilesForPhysicalDisplays } from '@main/physical-display-profile-rewrite.js'
import { PowerEventAdapter, type PowerMonitorPort } from '@main/power-event-adapter.js'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { prepareUnsavedQuit, type UnsavedQuitDecision } from '@main/unsaved-quit.js'
import { hasUnsavedSession } from '@shared/unsaved-changes.js'
import { requestEndPreview } from '@main/end-preview-shortcut.js'
import { ProductController } from '@main/product-controller.js'
import { migrateLegacyProfileConfiguration } from '@main/profile-configuration-migration.js'
import { AppDataProfileConfigurationStorage } from '@main/profile-configuration-storage.js'
import {
  ProfileNotificationController,
  type ProductNotificationPort
} from '@main/profile-notification-controller.js'
import {
  EMERGENCY_RESTORE_ACCELERATOR,
  ShortcutController,
  type ShortcutRegistrationPort
} from '@main/shortcut-controller.js'
import {
  ShutdownCoordinator,
  type ShutdownApplicationPort,
  type ShutdownNativePort
} from '@main/shutdown-coordinator.js'
import { describeError, type StructuredLogger } from '@main/structured-logger.js'
import { TrayController, type TrayMenuPort } from '@main/tray-controller.js'
import { LearnedGammaLimits } from '@main/learned-gamma-limits.js'
import { NativeServiceGate } from '@main/native-service-gate.js'

/**
 * Everything the runtime needs from the DisplayService connection: lifecycle
 * events, health and recovery, shutdown, and per-endpoint display operations.
 * The production NativeClient satisfies it structurally; tests substitute an
 * in-process fake through the createClient factory port.
 */
export type ProductRuntimeNativeClient = NativeEventSource &
  RecoverableNativeServicePort &
  ShutdownNativePort &
  EndpointDisplayPort

export interface ProductRuntimePorts {
  logger: StructuredLogger
  configuration: {
    profileConfigurationPath: string
    legacyProfileConfigurationPaths: string[]
    appVersion: string
  }
  native: {
    createClient: () => ProductRuntimeNativeClient
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
    flushRendererDrafts?: () => Promise<void>
    requestEndPreview: (profileId: string, needsPrompt: boolean) => void
  }
  dialogs: {
    showError: (title: string, message: string) => void
    confirmShutdownRetry: (title: string, message: string) => Promise<'retry' | 'cancel'>
    confirmUnsavedQuit: (profileName: string) => Promise<UnsavedQuitDecision>
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
  #nativeClient: ProductRuntimeNativeClient | undefined
  #physicalDisplayClient: PhysicalDisplayClient | undefined
  #profileRepository: ProfileRepository | undefined
  #automaticActivation: AutomaticActivationController | undefined
  #startupForegroundApplication: ForegroundApplication | null | undefined
  #trayController: TrayController | undefined
  #shutdownCoordinator: ShutdownCoordinator | undefined
  #productController: ProductController | undefined
  #previewController: PreviewSessionController | undefined
  #displayTransitionController: DisplayTransitionController | undefined
  #powerEventAdapter: PowerEventAdapter | undefined
  #nativeRecoveryController: NativeServiceRecoveryController | undefined
  #unsubscribeOutcomeRouter: (() => void) | undefined
  #shortcutController: ShortcutController | undefined
  #gammaLimits: LearnedGammaLimits | undefined
  #nativeGate: NativeServiceGate | undefined
  #disposed = false

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
    this.#disposed = true
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
    const nativeClient = this.ports.native.createClient()
    this.#nativeClient = nativeClient
    const gate = new NativeServiceGate(nativeClient, logger)
    this.#nativeGate = gate
    this.#profileRepository = new JsonProfileRepository(
      new AppDataProfileConfigurationStorage(configurationPath),
      {
        onMigrationNotice: (notice) =>
          logger.write({
            level: 'warning',
            eventName: 'ProfileConfigurationMigrationNotice',
            message: describeMigrationNotice(notice),
            ...notice
          })
      }
    )
    const limits = new LearnedGammaLimits(
      join(dirname(configurationPath), 'display-limits.json'),
      logger
    )
    const physicalClient = new PhysicalDisplayClient(gate, limits)
    this.#physicalDisplayClient = physicalClient
    const coordinator = new ActivationCoordinator(
      this.#profileRepository,
      physicalClient,
      logger,
      limits
    )
    this.#automaticActivation = new AutomaticActivationController(
      this.#profileRepository,
      coordinator,
      logger,
      (application) => application?.pid === process.pid
    )
    nativeClient.on('exit', () => {
      gate.disconnected()
      physicalClient.forgetBaselines()
      void this.#trayController?.refresh()
    })
    attachNativeEventRouter(nativeClient, {
      activation: () => this.#automaticActivation,
      displayTransitions: () => this.#displayTransitionController,
      recovery: () => this.#nativeRecoveryController,
      isExiting: () => this.#shutdownCoordinator?.exiting === true,
      broadcastProductState: () => this.ports.shell.broadcastProductState(),
      logger
    })
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
      // Validate before starting any automatic writer. An invalid slice is retained.
      try {
        await limits.load()
      } catch (error) {
        gate.blockConfiguration(
          'Display limits could not be loaded. Correct display-limits.json, then restart ChromaShift.'
        )
        logger.write({
          level: 'error',
          eventName: 'DisplayLimitsConfigurationInvalid',
          ...describeError(error)
        })
        this.ports.dialogs.showError(
          'Display limits could not be loaded',
          'Display control is unavailable. display-limits.json was left unchanged. ' +
            'Correct the invalid configuration before restarting ChromaShift.'
        )
        throw error
      }
      this.#gammaLimits = limits
      await gate.start()
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
      this.#startupForegroundApplication = await gate.getForegroundApplication()
    } catch (error) {
      if (this.#gammaLimits === undefined && gate.canRecover) {
        gate.blockConfiguration(
          'Configuration could not be loaded. Check Diagnostics, then restart ChromaShift.'
        )
      }
      logger.write({
        level: 'error',
        eventName: 'NativeServiceStartupFailed',
        ...describeError(error)
      })
      if (this.#gammaLimits !== undefined) {
        this.ports.dialogs.showError(
          'DisplayService compatibility check failed',
          gate.canRecover
            ? 'DisplayService could not start. ChromaShift remains available and will attempt recovery. Check Diagnostics for details.'
            : 'Display control is unavailable. Reinstall matching ChromaShift and DisplayService versions, then restart ChromaShift.'
        )
      }
    }
  }

  #registerEmergencyShortcut(handler: () => void): void {
    if (!this.ports.system.registerEmergencyRestoreShortcut(handler)) {
      this.ports.logger.write({
        level: 'warning',
        eventName: 'EmergencyRestoreShortcutUnavailable',
        shortcut: EMERGENCY_RESTORE_ACCELERATOR
      })
    }
  }

  async #configureProductLifecycle(): Promise<void> {
    const { logger, settings, shell, dialogs, icons, system, notifications, configuration } =
      this.ports
    const nativeClient = this.#nativeClient
    const gate = this.#nativeGate
    const physicalDisplayClient = this.#physicalDisplayClient
    const automaticActivation = this.#automaticActivation
    const profileRepository = this.#profileRepository
    if (
      nativeClient === undefined ||
      gate === undefined ||
      physicalDisplayClient === undefined ||
      automaticActivation === undefined ||
      profileRepository === undefined
    ) {
      return
    }

    this.#shutdownCoordinator = new ShutdownCoordinator(
      {
        waitForIdle: async () => {
          await this.#previewController?.waitForIdle()
          await automaticActivation.waitForIdle()
        }
      },
      nativeClient,
      system.application,
      {
        show: () => shell.openWindow(),
        showError: (title, message) => dialogs.confirmShutdownRetry(title, message)
      },
      logger,
      () =>
        prepareUnsavedQuit({
          flushRendererDrafts: shell.flushRendererDrafts,
          settle: () => this.#previewController?.waitForIdle() ?? Promise.resolve(),
          state: () => this.#previewController?.state ?? { state: 'inactive' },
          decide: (name) => dialogs.confirmUnsavedQuit(name),
          confirm: (profile) => {
            if (this.#productController === undefined)
              throw new Error('Profile saving is unavailable.')
            return this.#productController.confirmPreview(profile, 'preserve')
          }
        })
    )
    const previewController: PreviewSessionController = new PreviewSessionController(
      physicalDisplayClient,
      automaticActivation,
      () => {
        shell.broadcastProductState()
        void this.#trayController?.refresh()
      },
      {
        restoreFailed: () => chromaShiftController.previewRestoreFailed(),
        restored: () => chromaShiftController.previewRestored()
      },
      this.#gammaLimits,
      profileRepository
    )
    this.#previewController = previewController
    const chromaShiftController = new ChromaShiftController(
      automaticActivation,
      {
        refreshTopology: () => gate.refreshDisplayTopology(),
        getForegroundApplication: () => gate.getForegroundApplication()
      },
      {
        cancel: () => previewController.cancel(),
        get sessionRecoveryPending() {
          return previewController.sessionRecoveryPending
        },
        retryRestoration: () => previewController.retryRestoration()
      },
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
          // The preview-specific reason is in memory only. Existing resume
          // recovery restores tracked previews before validating activation.
          pendingControlOperation:
            state.pendingOperation === 'previewRestore' ? 'resume' : state.pendingOperation,
          intendedActivationMode: state.intendedMode,
          intendedTarget: state.intendedTarget
        }))
        shell.broadcastProductState()
      },
      logger
    )
    try {
      if (gate.ready && settings.chromaShiftIntent.current().chromaShiftStatus === 'active') {
        await automaticActivation.start(this.#startupForegroundApplication ?? null)
        await chromaShiftController.syncActiveIntent()
      } else if (gate.ready) {
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
      logger,
      () => hasUnsavedSession(previewController.state),
      () => gate.unavailableReason
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
      gate,
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
      () => this.#disposed || this.#shutdownCoordinator?.exiting === true,
      {
        recovered: () => {
          this.#productController?.invalidateHardwareCache()
          void chromaShiftController.syncActiveIntent()
          shell.broadcastProductState()
          void trayController.refresh()
        },
        terminal: () => {
          void trayController.refresh()
          shell.broadcastProductState()
          shell.openWindow()
          dialogs.showError(
            gate.canRecover
              ? nativeRecoveryTerminalTitle
              : 'DisplayService compatibility check failed',
            gate.canRecover ? nativeRecoveryTerminalMessage : gate.unavailableReason!
          )
        }
      },
      logger
    )
    const emergencyRestoreController = new EmergencyRestoreController(
      previewController,
      automaticActivation,
      {
        prepareRestore: () => {
          // Direct restoration replaces activation's live target with baseline;
          // capture the resume intent before its state/outcome subscriptions run.
          const intent = chromaShiftController.captureIntentSnapshot()
          const pendingPreviewRestore = previewController.state.state === 'restorePending'
          return () =>
            pendingPreviewRestore ||
            chromaShiftController.chromaShiftState.pendingOperation === 'previewRestore'
              ? chromaShiftController.emergencyRestoreConfirmed(intent)
              : chromaShiftController.restoreBaseline('shortcut', intent)
        }
      },
      logger
    )
    this.#registerEmergencyShortcut(() => {
      if (!gate.ready && gate.potentialBaselineDisplayIds.length === 0) {
        logger.write({
          level: 'warning',
          eventName: 'EmergencyRestoreSkipped',
          reason: 'NativeServiceNotNegotiated',
          message: 'DisplayService negotiation failed. No display writes were permitted.'
        })
        return
      }
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
      logger,
      () => requestEndPreview({
        preview: () => previewController.state,
        flushDrafts: () => shell.flushRendererDrafts?.() ?? Promise.resolve(),
        dispatch: (profileId, needsPrompt) => shell.requestEndPreview(profileId, needsPrompt)
      })
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
      gate,
      automaticActivation,
      previewController,
      logger,
      750,
      () => {
        this.#productController?.invalidateHardwareCache()
        shell.broadcastProductState()
        if (chromaShiftController.chromaShiftState.status === 'safetyBlocked') {
          void chromaShiftController.retrySafetyCheck('automatic').catch((error: unknown) => {
            logger.write({
              level: 'error',
              eventName: 'DisplayTransitionSafetyRetryFailed',
              ...describeError(error)
            })
          })
        }
      },
      () => {
        dialogs.showError(
          'Display preview failed',
          previewController.sessionRecoveryPending
            ? 'ChromaShift kept your preview and unsaved changes. Use Retry to restore display control. Check Diagnostics for details.'
            : 'ChromaShift ended the preview after a display change. Check Diagnostics for details.'
        )
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
      configuration.appVersion,
      this.#gammaLimits,
      () => gate.assertReady()
    )
    await trayController.start()
    if (!gate.ready && gate.canRecover) void this.#nativeRecoveryController.handleExit()
  }
}

export function createProductRuntime(ports: ProductRuntimePorts): ProductRuntime {
  return new ProductRuntime(ports)
}
