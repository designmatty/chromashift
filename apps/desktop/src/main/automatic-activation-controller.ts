import type { ForegroundApplication, ProfileRepository } from '@chromashift/core'
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
  #enabled = false
  #starting = false

  public constructor(
    private readonly repository: ProfileRepository,
    private readonly coordinator: ActivationCoordinator,
    private readonly logger: StructuredLogger
  ) {}

  public get enabled(): boolean {
    return this.#enabled
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
          outcome = await this.coordinator.activate(application)
        }
        applications = this.#pendingApplications.splice(0)
      }

      this.#enabled = true
      this.logger.write({
        level: 'information',
        eventName: 'AutomaticActivationEnabled'
      })
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

    return this.coordinator.activate(parsed.data.application)
  }

  public async handleNativeServiceExit(): Promise<void> {
    this.#enabled = false
    this.#pendingApplications.length = 0
    await this.coordinator.resetAfterNativeServiceRestart()
  }

  public resetAfterExternalRestore(): Promise<void> {
    return this.coordinator.resetAfterExternalRestore()
  }

  public waitForIdle(): Promise<void> {
    return this.coordinator.waitForIdle()
  }
}
