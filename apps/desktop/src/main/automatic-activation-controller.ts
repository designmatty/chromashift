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
  type NativeEvent
} from '@chromashift/native-client'
import {
  ActivationCoordinator,
  type ActivationOutcome
} from './activation-coordinator.js'
import { describeError, type StructuredLogger } from './structured-logger.js'

export class AutomaticActivationController {
  readonly #pendingApplications: Array<ForegroundApplication | null> = []
  readonly #listeners = new Set<(state: ActivationControllerState) => void>()
  #enabled = false
  #starting = false
  #currentApplication: ForegroundApplication | null = null
  #mode: ActivationMode = automaticActivationMode
  #currentTarget: ActivationTarget | null = null
  #previewing = false

  public constructor(
    private readonly repository: ProfileRepository,
    private readonly coordinator: ActivationCoordinator,
    private readonly logger: StructuredLogger
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

  public async start(
    currentApplication: ForegroundApplication | null
  ): Promise<ActivationOutcome | null> {
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

      let outcome: ActivationOutcome | null = null
      let applications = [currentApplication, ...this.#pendingApplications.splice(0)]
      while (applications.length > 0) {
        for (const application of applications) {
          this.#currentApplication = application
          outcome = await this.#activateCurrentApplication()
        }
        applications = this.#pendingApplications.splice(0)
      }

      this.#enabled = true
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

  public handleNativeEvent(event: NativeEvent): Promise<ActivationOutcome | void> {
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

    if (!this.#enabled) {
      this.#pendingApplications.push(parsed.data.application)
      return Promise.resolve()
    }

    this.#currentApplication = parsed.data.application
    if (this.#previewing) return Promise.resolve()
    return this.#activateCurrentApplication()
  }

  public async beginPreview(): Promise<void> {
    if (!this.#enabled) throw new Error('Display preview is not available.')
    if (this.#previewing) throw new Error('A display preview is already active.')
    this.#previewing = true
    await this.coordinator.waitForIdle()
  }

  public async cancelPreview(): Promise<void> {
    if (!this.#previewing) return
    this.#previewing = false
    await this.coordinator.resetAfterExternalRestore()
    await this.#activateCurrentApplication()
  }

  public async confirmPreview(profileId: string): Promise<void> {
    if (!this.#previewing) throw new Error('No display preview is active.')
    this.#mode = manualActivationMode(profileId)
    this.#previewing = false
    await this.coordinator.resetAfterExternalRestore()
    const outcome = await this.#activateCurrentApplication()
    if (outcome.status === 'failed' || outcome.status === 'partialFailure') {
      throw new Error(outcome.failures.map((failure) => failure.message).join(' '))
    }
  }

  public async refreshAfterConfigurationChange(): Promise<void> {
    if (!this.#enabled || this.#previewing) return
    await this.coordinator.resetAfterExternalRestore()
    await this.#activateCurrentApplication()
  }

  public async selectManualProfile(profileId: string): Promise<ActivationOutcome> {
    if (!this.#enabled) throw new Error('Profile activation is not available.')
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
    return this.#activateCurrentApplication()
  }

  public async enableAutomatic(): Promise<ActivationOutcome> {
    if (!this.#enabled) throw new Error('Automatic activation is not available.')
    this.#mode = automaticActivationMode
    this.logger.write({
      level: 'information',
      eventName: 'AutomaticActivationSelected'
    })
    this.#emitState()
    return this.#activateCurrentApplication()
  }

  public async restoreBaseline(): Promise<ActivationOutcome> {
    if (!this.#enabled) throw new Error('Display restoration is not available.')
    const outcome = await this.coordinator.restoreBaseline()
    this.#updateTarget(outcome)
    this.logger.write({
      level: outcome.status === 'activated' ? 'information' : 'error',
      eventName: 'TrayBaselineResetCompleted',
      status: outcome.status,
      failures: outcome.failures
    })
    return outcome
  }

  public async handleNativeServiceExit(): Promise<void> {
    this.#enabled = false
    this.#previewing = false
    this.#pendingApplications.length = 0
    this.#currentTarget = null
    await this.coordinator.resetAfterNativeServiceRestart()
    this.#emitState()
  }

  public resetAfterExternalRestore(): Promise<void> {
    return this.coordinator.resetAfterExternalRestore()
  }

  public waitForIdle(): Promise<void> {
    return this.coordinator.waitForIdle()
  }

  async #activateCurrentApplication(): Promise<ActivationOutcome> {
    const outcome = await this.coordinator.activate(this.#currentApplication, this.#mode)
    this.#updateTarget(outcome)
    return outcome
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
