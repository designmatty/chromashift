import {
  ActivationResolver,
  automaticActivationMode,
  findMatchingProfile,
  type ActivationResolution,
  type ColorProfile,
  type ForegroundApplication,
  type ProfileConfiguration,
  type ProfileRepository
} from '@chromashift/core'
import type {
  BaselineCaptureResult,
  DisplayApplyResult,
  DisplayRestoreResult,
  DisplaySettings,
  RestoreAllResult
} from '@chromashift/native-client'
import { describeError, type StructuredLogger } from './structured-logger.js'

export interface NativeActivationPort {
  captureBaseline(displayId: string): Promise<BaselineCaptureResult>
  applyDisplaySettings(displayId: string, settings: DisplaySettings): Promise<DisplayApplyResult>
  restoreDisplay(displayId: string): Promise<DisplayRestoreResult>
  restoreAllBaselines(): Promise<RestoreAllResult>
}

export type ActivationOperation = 'configuration' | 'capture' | 'apply' | 'restore' | 'restoreAll'

export interface ActivationFailure {
  operation: ActivationOperation
  displayId?: string
  code?: string
  message: string
}

export interface ActivationOutcome {
  status: 'activated' | 'skipped' | 'partialFailure' | 'failed'
  resolution: ActivationResolution | null
  failures: ActivationFailure[]
}

function hasColorOverrides(profile: ColorProfile): boolean {
  return Object.keys(profile.color).length > 0
}

function findSelectedProfile(
  configuration: ProfileConfiguration,
  resolution: ActivationResolution
): ColorProfile | null {
  if (resolution.target.kind === 'baseline') return null
  const profileId = resolution.target.profileId
  return configuration.profiles.find(
    (profile) => profile.id.toLowerCase() === profileId.toLowerCase()
  ) ?? null
}

export class ActivationCoordinator {
  readonly #resolver = new ActivationResolver()
  readonly #capturedDisplayIds = new Set<string>()
  #queue: Promise<void> = Promise.resolve()

  public constructor(
    private readonly repository: ProfileRepository,
    private readonly native: NativeActivationPort,
    private readonly logger: StructuredLogger
  ) {}

  public activate(foregroundApplication: ForegroundApplication | null): Promise<ActivationOutcome> {
    return this.#enqueue(() => this.#transition(foregroundApplication))
  }

  public resetAfterExternalRestore(): Promise<void> {
    return this.#enqueue(async () => {
      this.#reset('externalRestore')
    })
  }

  public resetAfterNativeServiceRestart(): Promise<void> {
    return this.#enqueue(async () => {
      this.#reset('nativeServiceRestart')
    })
  }

  public async waitForIdle(): Promise<void> {
    await this.#queue
  }

  async #transition(
    foregroundApplication: ForegroundApplication | null
  ): Promise<ActivationOutcome> {
    let configuration: ProfileConfiguration
    try {
      configuration = await this.repository.getConfiguration()
    } catch (error) {
      const failure = this.#failure('configuration', error)
      this.#resolver.reset()
      this.logger.write({
        level: 'error',
        eventName: 'ProfileActivationFailed',
        reason: 'configurationUnavailable',
        ...failure
      })
      return { status: 'failed', resolution: null, failures: [failure] }
    }

    const resolution = this.#resolver.resolve({
      configuration,
      foregroundApplication,
      mode: automaticActivationMode
    })
    this.#logResolution(configuration, resolution, foregroundApplication)

    if (!resolution.changed) {
      this.logger.write({
        level: 'information',
        eventName: 'ProfileActivationSkipped',
        reason: 'targetUnchanged',
        target: resolution.target
      })
      return { status: 'skipped', resolution, failures: [] }
    }

    if (resolution.target.kind === 'baseline') {
      return this.#restoreBaseline(resolution)
    }

    const profile = findSelectedProfile(configuration, resolution)
    if (profile === null) {
      const failure: ActivationFailure = {
        operation: 'configuration',
        message: `Resolved profile ${resolution.target.profileId} was not found.`
      }
      this.#resolver.reset()
      this.logger.write({
        level: 'error',
        eventName: 'ProfileActivationFailed',
        profileId: resolution.target.profileId,
        ...failure
      })
      return { status: 'failed', resolution, failures: [failure] }
    }

    return this.#applyProfile(profile, resolution)
  }

  async #applyProfile(
    profile: ColorProfile,
    resolution: ActivationResolution
  ): Promise<ActivationOutcome> {
    const failures: ActivationFailure[] = []
    const desiredDisplayIds = hasColorOverrides(profile)
      ? profile.displays.map((target) => target.displayId)
      : []
    const normalizedDesiredIds = new Set(
      desiredDisplayIds.map((displayId) => displayId.toLowerCase())
    )

    for (const displayId of [...this.#capturedDisplayIds]) {
      if (normalizedDesiredIds.has(displayId.toLowerCase())) continue
      try {
        const result = await this.native.restoreDisplay(displayId)
        if (!result.restored && result.error !== undefined) {
          failures.push(this.#failure('restore', new Error(result.error), displayId))
          continue
        }
        this.#capturedDisplayIds.delete(displayId)
        this.logger.write({
          level: 'information',
          eventName: result.restored ? 'BaselineRestored' : 'BaselineRestoreSkipped',
          displayId,
          reason: result.restored ? 'profileTargetChanged' : result.reason
        })
      } catch (error) {
        failures.push(this.#failure('restore', error, displayId))
      }
    }

    for (const displayId of desiredDisplayIds) {
      try {
        await this.native.captureBaseline(displayId)
        this.#capturedDisplayIds.add(displayId)
      } catch (error) {
        failures.push(this.#failure('capture', error, displayId))
        continue
      }

      try {
        await this.native.applyDisplaySettings(displayId, profile.color)
      } catch (error) {
        failures.push(this.#failure('apply', error, displayId))
      }
    }

    if (failures.length > 0) {
      this.#resolver.reset()
      this.#logFailures(profile.id, failures)
      return { status: 'partialFailure', resolution, failures }
    }

    this.logger.write({
      level: 'information',
      eventName: 'ProfileActivated',
      profileId: profile.id,
      reason: resolution.reason,
      displayIds: desiredDisplayIds
    })
    return { status: 'activated', resolution, failures: [] }
  }

  async #restoreBaseline(resolution: ActivationResolution): Promise<ActivationOutcome> {
    try {
      const result = await this.native.restoreAllBaselines()
      const failures: ActivationFailure[] = []
      for (const display of result.displays) {
        if (!display.restored && display.error !== undefined) {
          failures.push(
            this.#failure('restoreAll', new Error(display.error), display.displayId)
          )
        }
      }

      this.#capturedDisplayIds.clear()
      for (const failure of failures) {
        if (failure.displayId !== undefined) this.#capturedDisplayIds.add(failure.displayId)
      }

      if (failures.length > 0) {
        this.#resolver.reset()
        this.#logFailures(undefined, failures)
        return { status: 'partialFailure', resolution, failures }
      }

      this.logger.write({
        level: 'information',
        eventName: 'BaselineRestored',
        reason: resolution.reason,
        displayIds: result.displays.map((display) => display.displayId)
      })
      return { status: 'activated', resolution, failures: [] }
    } catch (error) {
      const failure = this.#failure('restoreAll', error)
      this.#resolver.reset()
      this.#logFailures(undefined, [failure])
      return { status: 'failed', resolution, failures: [failure] }
    }
  }

  #logResolution(
    configuration: ProfileConfiguration,
    resolution: ActivationResolution,
    foregroundApplication: ForegroundApplication | null
  ): void {
    if (resolution.target.kind === 'baseline') {
      this.logger.write({
        level: 'information',
        eventName: 'ProfileMatchMiss',
        reason: resolution.reason,
        executable: foregroundApplication?.executable,
        path: foregroundApplication?.path
      })
      return
    }

    const foregroundMatch = resolution.reason === 'foregroundApplication'
      ? findMatchingProfile(configuration.profiles, foregroundApplication)
      : null
    this.logger.write({
      level: 'information',
      eventName: 'ProfileMatched',
      profileId: resolution.target.profileId,
      reason: resolution.reason,
      matchType: foregroundMatch?.type,
      executable: foregroundApplication?.executable,
      path: foregroundApplication?.path
    })
  }

  #failure(
    operation: ActivationOperation,
    error: unknown,
    displayId?: string
  ): ActivationFailure {
    const details = describeError(error)
    return displayId === undefined
      ? { operation, ...details }
      : { operation, displayId, ...details }
  }

  #logFailures(profileId: string | undefined, failures: readonly ActivationFailure[]): void {
    for (const failure of failures) {
      this.logger.write({
        level: 'error',
        eventName: 'DisplaySettingFailed',
        profileId,
        ...failure
      })
    }
    this.logger.write({
      level: 'error',
      eventName: 'ProfileActivationFailed',
      profileId,
      failures
    })
  }

  #reset(reason: 'externalRestore' | 'nativeServiceRestart'): void {
    this.#resolver.reset()
    this.#capturedDisplayIds.clear()
    this.logger.write({
      level: 'information',
      eventName: 'ActivationStateReset',
      reason
    })
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.#queue.then(operation)
    this.#queue = scheduled.then(
      () => undefined,
      () => undefined
    )
    return scheduled
  }
}
