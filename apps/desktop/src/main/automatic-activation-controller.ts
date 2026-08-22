import {
  automaticActivationMode,
  manualActivationMode,
  type ActivationMode,
  type ActivationTarget,
  type ForegroundApplication,
  type ProfileRepository
} from '@chromashift/core'
import {
  foregroundApplicationChangedDataSchema,
  type ForegroundApplication as NativeForegroundApplication,
  type NativeEvent
} from '@chromashift/native-client'
import { ActivationCoordinator, type ActivationOutcome } from './activation-coordinator.js'
import { describeError, type StructuredLogger } from './structured-logger.js'

export class AutomaticActivationController {
  readonly #pendingApplications: Array<ForegroundApplication | null> = []
  readonly #listeners = new Set<(state: ActivationControllerState) => void>()
  readonly #outcomeListeners = new Set<(outcome: CompletedActivationOutcome) => void>()
  #enabled = false
  #starting = false
  #currentApplication: ForegroundApplication | null = null
  #mode: ActivationMode = automaticActivationMode
  #currentTarget: ActivationTarget | null = null
  #previewing = false
  #systemTransitioning = false
  #writesSuspended = false

  public constructor(
    private readonly repository: ProfileRepository,
    private readonly coordinator: ActivationCoordinator,
    private readonly logger: StructuredLogger,
    private readonly ignoreApplication: (
      application: NativeForegroundApplication
    ) => boolean = () => false
  ) {}

  public get enabled(): boolean {
    return this.#enabled
  }

  public get state(): ActivationControllerState {
    return {
      enabled: this.#enabled,
      mode: { ...this.#mode },
      currentTarget: this.#currentTarget === null ? null : { ...this.#currentTarget }
    }
  }

  public subscribe(listener: (state: ActivationControllerState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  public subscribeOutcomes(listener: (outcome: CompletedActivationOutcome) => void): () => void {
    this.#outcomeListeners.add(listener)
    return () => this.#outcomeListeners.delete(listener)
  }

  public async start(
    currentApplication: ForegroundApplication | null
  ): Promise<CompletedActivationOutcome | null> {
    if (this.#enabled || this.#starting) {
      throw new Error('Automatic activation has already been started.')
    }
    this.#starting = true

    try {
      const configuration = await this.repository.getConfiguration()
      this.logger.write({
        level: 'information',
        eventName: 'ProfileConfigurationLoaded',
        schemaVersion: configuration.schemaVersion,
        profileCount: configuration.profiles.length,
        defaultProfileId: configuration.settings.defaultProfileId
      })

      let outcome: CompletedActivationOutcome | null = null
      let applications: Array<{
        application: ForegroundApplication | null
        context: ActivationContext
      }> = [
        {
          application: currentApplication,
          context: { source: 'automatic', origin: 'startup' }
        },
        ...this.#pendingApplications.splice(0).map((application) => ({
          application,
          context: { source: 'automatic' as const, origin: 'foreground' as const }
        }))
      ]
      while (applications.length > 0) {
        for (const { application, context } of applications) {
          this.#currentApplication = application
          outcome = await this.#activateCurrentApplication(context)
        }
        applications = this.#pendingApplications.splice(0).map((application) => ({
          application,
          context: { source: 'automatic' as const, origin: 'foreground' as const }
        }))
      }

      this.#enabled = true
      this.#writesSuspended = false
      this.logger.write({
        level: 'information',
        eventName: 'AutomaticActivationEnabled'
      })
      this.#emitState()
      return outcome
    } catch (error) {
      this.#pendingApplications.length = 0
      this.logger.write({
        level: 'error',
        eventName: 'AutomaticActivationDisabled',
        ...describeError(error)
      })
      throw error
    } finally {
      this.#starting = false
    }
  }

  public async startSuspended(
    currentApplication: ForegroundApplication | null,
    mode: ActivationMode,
    intendedTarget: ActivationTarget | null
  ): Promise<void> {
    if (this.#enabled || this.#starting) {
      throw new Error('Automatic activation has already been started.')
    }
    const configuration = await this.repository.getConfiguration()
    this.logger.write({
      level: 'information',
      eventName: 'ProfileConfigurationLoaded',
      schemaVersion: configuration.schemaVersion,
      profileCount: configuration.profiles.length,
      defaultProfileId: configuration.settings.defaultProfileId
    })
    this.#currentApplication = this.#pendingApplications.at(-1) ?? currentApplication
    this.#pendingApplications.length = 0
    this.#mode = { ...mode }
    this.#currentTarget = intendedTarget === null ? null : { ...intendedTarget }
    this.#writesSuspended = true
    this.#enabled = true
    this.#emitState()
    this.logger.write({
      level: 'information',
      eventName: 'AutomaticActivationStartedSuspended',
      mode: this.#mode,
      intendedTarget: this.#currentTarget
    })
  }

  public handleNativeEvent(event: NativeEvent): Promise<CompletedActivationOutcome | void> {
    if (event.event !== 'foregroundApplicationChanged') return Promise.resolve()

    const parsed = foregroundApplicationChangedDataSchema.safeParse(event.data)
    if (!parsed.success) {
      this.logger.write({
        level: 'warning',
        eventName: 'ForegroundApplicationEventRejected',
        issues: parsed.error.issues.map((issue) => issue.message)
      })
      return Promise.resolve()
    }

    if (this.ignoreApplication(parsed.data.application)) {
      this.logger.write({
        level: 'information',
        eventName: 'ForegroundApplicationIgnored',
        pid: parsed.data.application.pid,
        executable: parsed.data.application.executable
      })
      return Promise.resolve()
    }

    if (!this.#enabled) {
      this.#pendingApplications.push(parsed.data.application)
      return Promise.resolve()
    }

    this.#currentApplication = parsed.data.application
    if (this.#previewing || this.#systemTransitioning || this.#writesSuspended) {
      return Promise.resolve()
    }
    return this.#activateCurrentApplication({ source: 'automatic', origin: 'foreground' })
  }

  public async beginPreview(): Promise<void> {
    if (!this.#enabled) throw new Error('Display preview is not available.')
    if (this.#systemTransitioning) throw new Error('A display transition is in progress.')
    if (this.#previewing) throw new Error('A display preview is already active.')
    this.#previewing = true
    await this.coordinator.waitForIdle()
  }

  public async cancelPreview(retainedDisplayIds: readonly string[] = []): Promise<void> {
    if (!this.#previewing) return
    this.#previewing = false
    await this.coordinator.resetAfterExternalRestore(retainedDisplayIds)
    if (this.#writesSuspended) return
    await this.#activateCurrentApplication({ source: 'manual', origin: 'previewRollback' })
  }

  public async confirmPreview(
    profileId: string,
    retainedDisplayIds: readonly string[] = []
  ): Promise<void> {
    if (!this.#previewing) throw new Error('No display preview is active.')
    this.#mode = manualActivationMode(profileId)
    this.#previewing = false
    await this.coordinator.resetAfterExternalRestore(retainedDisplayIds)
    const outcome = await this.#activateCurrentApplication({
      source: 'manual',
      origin: 'previewConfirmation'
    })
    if (outcome.status === 'failed' || outcome.status === 'partialFailure') {
      throw new Error(outcome.failures.map((failure) => failure.message).join(' '))
    }
  }

  public async refreshAfterConfigurationChange(): Promise<void> {
    if (!this.#enabled || this.#previewing || this.#systemTransitioning || this.#writesSuspended)
      return
    await this.coordinator.resetAfterExternalRestore()
    await this.#activateCurrentApplication({
      source: 'automatic',
      origin: 'configurationChange'
    })
  }

  public async selectManualProfile(
    profileId: string,
    context: ActivationContext = { source: 'manual', origin: 'profileSelection' }
  ): Promise<CompletedActivationOutcome> {
    if (!this.#enabled) throw new Error('Profile activation is not available.')
    if (this.#systemTransitioning) throw new Error('A display transition is in progress.')
    const profile = await this.repository.findById(profileId)
    if (profile === null) throw new Error(`Profile ${profileId} does not exist.`)
    if (!profile.enabled) throw new Error(`Profile ${profile.name} is disabled.`)

    this.#mode = manualActivationMode(profile.id)
    this.logger.write({
      level: 'information',
      eventName: 'ManualProfileOverrideEnabled',
      profileId: profile.id
    })
    this.#emitState()
    return this.#activateCurrentApplication(context)
  }

  public async enableAutomatic(
    context: ActivationContext = { source: 'manual', origin: 'automaticSelection' }
  ): Promise<CompletedActivationOutcome> {
    if (!this.#enabled) throw new Error('Automatic activation is not available.')
    if (this.#systemTransitioning) throw new Error('A display transition is in progress.')
    this.#mode = automaticActivationMode
    this.logger.write({
      level: 'information',
      eventName: 'AutomaticActivationSelected'
    })
    this.#emitState()
    return this.#activateCurrentApplication(context)
  }

  public async restoreBaseline(
    context: ActivationContext = { source: 'manual', origin: 'originalSettingsRestore' }
  ): Promise<CompletedActivationOutcome> {
    if (!this.#enabled) throw new Error('Display restoration is not available.')
    const outcome = await this.coordinator.restoreBaseline()
    this.#updateTarget(outcome)
    this.logger.write({
      level: outcome.status === 'activated' ? 'information' : 'error',
      eventName: 'TrayBaselineResetCompleted',
      status: outcome.status,
      failures: outcome.failures,
      deferredDisplayIds: outcome.deferredDisplayIds
    })
    return this.#publishOutcome(outcome, context)
  }

  public async suspendWrites(): Promise<void> {
    this.#writesSuspended = true
    await this.coordinator.waitForIdle()
  }

  public async setSuspendedIntent(
    mode: ActivationMode,
    target: ActivationTarget | null
  ): Promise<void> {
    if (mode.kind === 'manual') {
      const profile = await this.repository.findById(mode.profileId)
      if (profile === null) throw new Error(`Profile ${mode.profileId} does not exist.`)
      if (!profile.enabled) throw new Error(`Profile ${profile.name} is disabled.`)
    }
    this.#mode = { ...mode }
    this.#currentTarget = target === null ? null : { ...target }
    this.#emitState()
  }

  public async resumeCurrent(
    currentApplication: ForegroundApplication | null | undefined,
    context: ActivationContext = { source: 'manual', origin: 'resume' }
  ): Promise<CompletedActivationOutcome> {
    if (currentApplication !== undefined) this.#currentApplication = currentApplication
    this.#writesSuspended = false
    return this.#activateCurrentApplication(context)
  }

  public async handleNativeServiceExit(): Promise<void> {
    this.#enabled = false
    this.#previewing = false
    this.#pendingApplications.length = 0
    this.#currentTarget = null
    this.#writesSuspended = false
    await this.coordinator.resetAfterNativeServiceRestart()
    this.#emitState()
  }

  public resetAfterExternalRestore(): Promise<void> {
    return this.coordinator.resetAfterExternalRestore()
  }

  public waitForIdle(): Promise<void> {
    return this.coordinator.waitForIdle()
  }

  public async beginSystemTransition(): Promise<void> {
    this.#systemTransitioning = true
    await this.coordinator.waitForIdle()
  }

  public async completeSystemTransition(reapply: boolean, resumeWrites = true): Promise<void> {
    await this.coordinator.resetForDisplayTransition()
    if (!resumeWrites) return
    this.#systemTransitioning = false
    if (!reapply || !this.#enabled || this.#previewing || this.#writesSuspended) return
    await this.#activateCurrentApplication({ source: 'automatic', origin: 'topologyChange' })
  }

  async #activateCurrentApplication(
    context: ActivationContext
  ): Promise<CompletedActivationOutcome> {
    const outcome = await this.coordinator.activate(this.#currentApplication, this.#mode)
    this.#updateTarget(outcome)
    return this.#publishOutcome(outcome, context)
  }

  #publishOutcome(
    outcome: ActivationOutcome,
    context: ActivationContext
  ): CompletedActivationOutcome {
    const completed: CompletedActivationOutcome = {
      ...outcome,
      failures: outcome.failures.map((failure) => ({ ...failure })),
      deferredDisplayIds: [...outcome.deferredDisplayIds],
      source: context.source,
      origin: context.origin
    }
    for (const listener of this.#outcomeListeners) listener(completed)
    return completed
  }

  #updateTarget(outcome: ActivationOutcome): void {
    this.#currentTarget =
      (outcome.status === 'activated' || outcome.status === 'skipped') &&
      outcome.resolution !== null
        ? { ...outcome.resolution.target }
        : null
    this.#emitState()
  }

  #emitState(): void {
    const state = this.state
    for (const listener of this.#listeners) listener(state)
  }
}

export interface ActivationControllerState {
  enabled: boolean
  mode: ActivationMode
  currentTarget: ActivationTarget | null
}

export type ActivationSource = 'automatic' | 'manual' | 'shortcut'

export type ActivationOrigin =
  | 'startup'
  | 'foreground'
  | 'profileSelection'
  | 'automaticSelection'
  | 'previewRollback'
  | 'previewConfirmation'
  | 'configurationChange'
  | 'topologyChange'
  | 'originalSettingsRestore'
  | 'pause'
  | 'safetyRetry'
  | 'resume'
  | 'statusControl'
  | 'shortcut'

export interface ActivationContext {
  source: ActivationSource
  origin: ActivationOrigin
}

export interface CompletedActivationOutcome extends ActivationOutcome {
  source: ActivationSource
  origin: ActivationOrigin
}
