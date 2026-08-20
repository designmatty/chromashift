import {
  ActivationResolver,
  activeColorTargets,
  automaticActivationMode,
  findMatchingProfile,
  type ActivationResolution,
  type ActivationMode,
  type ColorProfile,
  type ForegroundApplication,
  type ProfileConfiguration,
  type ProfileRepository
} from '@chromashift/core'
import type {
  BaselineCaptureResult,
  Display,
  DisplayApplyResult,
  DisplayRestoreResult,
  DisplaySettings,
  RestoreAllResult
} from '@chromashift/native-client'
import { describeError, type StructuredLogger } from './structured-logger.js'

export interface NativeActivationPort {
  getDisplays(): Promise<Display[]>
  captureBaseline(displayId: string): Promise<BaselineCaptureResult>
  applyDisplaySettings(displayId: string, settings: DisplaySettings): Promise<DisplayApplyResult>
  restoreDisplay(displayId: string): Promise<DisplayRestoreResult>
  restoreAllBaselines(): Promise<RestoreAllResult>
}

export type ActivationOperation =
  | 'configuration'
  | 'enumerateDisplays'
  | 'capture'
  | 'apply'
  | 'restore'
  | 'restoreAll'

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
  deferredDisplayIds: string[]
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

  public activate(
    foregroundApplication: ForegroundApplication | null,
    mode: ActivationMode = automaticActivationMode
  ): Promise<ActivationOutcome> {
    return this.#enqueue(() => this.#transition(foregroundApplication, mode))
  }

  public restoreBaseline(): Promise<ActivationOutcome> {
    return this.#enqueue(async () => {
      const previousTarget = this.#resolver.currentTarget
      const outcome = await this.#restoreBaseline({
        target: { kind: 'baseline' },
        reason: 'baseline',
        changed: previousTarget?.kind !== 'baseline',
        previousTarget
      })
      if (outcome.status === 'activated' && outcome.deferredDisplayIds.length === 0) {
        this.#reset('externalRestore')
      }
      return outcome
    })
  }

  public resetAfterExternalRestore(retainedDisplayIds: readonly string[] = []): Promise<void> {
    return this.#enqueue(async () => {
      this.#reset('externalRestore', retainedDisplayIds)
    })
  }

  public resetAfterNativeServiceRestart(): Promise<void> {
    return this.#enqueue(async () => {
      this.#reset('nativeServiceRestart')
    })
  }

  public resetForDisplayTransition(): Promise<void> {
    return this.#enqueue(async () => {
      this.#resolver.reset()
      this.logger.write({
        level: 'information',
        eventName: 'ActivationStateReset',
        reason: 'displayTransition',
        retainedBaselineDisplayIds: [...this.#capturedDisplayIds]
      })
    })
  }

  public async waitForIdle(): Promise<void> {
    await this.#queue
  }

  async #transition(
    foregroundApplication: ForegroundApplication | null,
    mode: ActivationMode
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
      return {
        status: 'failed',
        resolution: null,
        failures: [failure],
        deferredDisplayIds: []
      }
    }

    const resolution = this.#resolver.resolve({
      configuration,
      foregroundApplication,
      mode
    })
    this.#logResolution(configuration, resolution, foregroundApplication)

    if (!resolution.changed) {
      this.logger.write({
        level: 'information',
        eventName: 'ProfileActivationSkipped',
        reason: 'targetUnchanged',
        target: resolution.target
      })
      return { status: 'skipped', resolution, failures: [], deferredDisplayIds: [] }
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
      return { status: 'failed', resolution, failures: [failure], deferredDisplayIds: [] }
    }

    return this.#applyProfile(profile, resolution)
  }

  async #applyProfile(
    profile: ColorProfile,
    resolution: ActivationResolution
  ): Promise<ActivationOutcome> {
    const failures: ActivationFailure[] = []
    const deferredDisplayIds = new Set<string>()
    let connectedDisplayIds: Set<string>
    let hdrDisplayIds: Set<string>
    try {
      const displays = await this.native.getDisplays()
      connectedDisplayIds = new Set(displays.map((display) => display.id.toLowerCase()))
      hdrDisplayIds = new Set(
        displays.filter((display) => display.hdr).map((display) => display.id.toLowerCase())
      )
    } catch (error) {
      const failure = this.#failure('enumerateDisplays', error)
      this.#resolver.reset()
      this.#logFailures(profile.id, [failure])
      return {
        status: 'failed',
        resolution,
        failures: [failure],
        deferredDisplayIds: []
      }
    }
    // Targets whose settings object is empty leave that display at its captured
    // baseline, so they are excluded from the desired set and restored below.
    const desiredTargets = activeColorTargets(profile)
    const normalizedDesiredIds = new Set(
      desiredTargets.map((target) => target.displayId.toLowerCase())
    )

    for (const displayId of [...this.#capturedDisplayIds]) {
      if (normalizedDesiredIds.has(displayId.toLowerCase())) continue
      if (!connectedDisplayIds.has(displayId.toLowerCase())) {
        this.#deferDisplay(
          profile.id,
          displayId,
          'restore',
          'displayDisconnected',
          deferredDisplayIds
        )
        continue
      }
      if (hdrDisplayIds.has(displayId.toLowerCase())) {
        this.#deferDisplay(profile.id, displayId, 'restore', 'hdrActive', deferredDisplayIds)
        continue
      }
      try {
        const result = await this.native.restoreDisplay(displayId)
        if (!result.restored) {
          if (result.reason === 'hdrActive' || result.code === 'HDR_UNSAFE') {
            this.#deferDisplay(profile.id, displayId, 'restore', 'hdrActive', deferredDisplayIds)
            continue
          }
          if (result.code === 'DISPLAY_NOT_FOUND') {
            this.#deferDisplay(
              profile.id,
              displayId,
              'restore',
              'displayDisconnected',
              deferredDisplayIds
            )
            continue
          }
          if (result.reason !== 'baselineNotCaptured') {
            failures.push(
              this.#failureFromDetails(
                'restore',
                result.error ?? `Display was not restored: ${result.reason ?? 'unknown reason'}.`,
                displayId,
                result.code
              )
            )
            continue
          }
        }
        this.#capturedDisplayIds.delete(displayId)
        this.logger.write({
          level: 'information',
          eventName: result.restored ? 'BaselineRestored' : 'BaselineRestoreSkipped',
          displayId,
          reason: result.restored ? 'profileTargetChanged' : result.reason
        })
      } catch (error) {
        if (this.#isHdrUnsafe(error)) {
          this.#deferDisplay(profile.id, displayId, 'restore', 'hdrActive', deferredDisplayIds)
        } else if (this.#isDisplayDisconnected(error)) {
          this.#deferDisplay(
            profile.id,
            displayId,
            'restore',
            'displayDisconnected',
            deferredDisplayIds
          )
        } else {
          failures.push(this.#failure('restore', error, displayId))
        }
      }
    }

    for (const target of desiredTargets) {
      if (!connectedDisplayIds.has(target.displayId.toLowerCase())) {
        this.#deferDisplay(
          profile.id,
          target.displayId,
          'apply',
          'displayDisconnected',
          deferredDisplayIds
        )
        continue
      }
      if (hdrDisplayIds.has(target.displayId.toLowerCase())) {
        this.#deferDisplay(
          profile.id,
          target.displayId,
          'apply',
          'hdrActive',
          deferredDisplayIds
        )
        continue
      }
      try {
        await this.native.captureBaseline(target.displayId)
        this.#capturedDisplayIds.add(target.displayId)
      } catch (error) {
        if (this.#isHdrUnsafe(error)) {
          this.#deferDisplay(
            profile.id,
            target.displayId,
            'capture',
            'hdrActive',
            deferredDisplayIds
          )
        } else if (this.#isDisplayDisconnected(error)) {
          this.#deferDisplay(
            profile.id,
            target.displayId,
            'capture',
            'displayDisconnected',
            deferredDisplayIds
          )
        } else {
          failures.push(this.#failure('capture', error, target.displayId))
        }
        continue
      }

      try {
        await this.native.applyDisplaySettings(target.displayId, target.color)
      } catch (error) {
        if (this.#isHdrUnsafe(error)) {
          this.#deferDisplay(
            profile.id,
            target.displayId,
            'apply',
            'hdrActive',
            deferredDisplayIds
          )
        } else if (this.#isDisplayDisconnected(error)) {
          this.#deferDisplay(
            profile.id,
            target.displayId,
            'apply',
            'displayDisconnected',
            deferredDisplayIds
          )
        } else {
          failures.push(this.#failure('apply', error, target.displayId))
        }
      }
    }

    if (failures.length > 0) {
      this.#resolver.reset()
      this.#logFailures(profile.id, failures)
      return {
        status: 'partialFailure',
        resolution,
        failures,
        deferredDisplayIds: [...deferredDisplayIds]
      }
    }

    this.logger.write({
      level: 'information',
      eventName: 'ProfileActivated',
      profileId: profile.id,
      reason: resolution.reason,
      displayIds: desiredTargets.map((target) => target.displayId),
      deferredDisplayIds: [...deferredDisplayIds]
    })
    return {
      status: 'activated',
      resolution,
      failures: [],
      deferredDisplayIds: [...deferredDisplayIds]
    }
  }

  async #restoreBaseline(resolution: ActivationResolution): Promise<ActivationOutcome> {
    try {
      const result = await this.native.restoreAllBaselines()
      const failures: ActivationFailure[] = []
      const deferredDisplayIds = new Set<string>()
      for (const display of result.displays) {
        if (display.restored || display.reason === 'baselineNotCaptured') {
          this.#capturedDisplayIds.delete(display.displayId)
        } else if (display.reason === 'hdrActive' || display.code === 'HDR_UNSAFE') {
          this.#capturedDisplayIds.add(display.displayId)
          this.#deferDisplay(
            undefined,
            display.displayId,
            'restoreAll',
            'hdrActive',
            deferredDisplayIds
          )
        } else if (display.code === 'DISPLAY_NOT_FOUND') {
          this.#capturedDisplayIds.add(display.displayId)
          this.#deferDisplay(
            undefined,
            display.displayId,
            'restoreAll',
            'displayDisconnected',
            deferredDisplayIds
          )
        } else if (display.error !== undefined) {
          failures.push(
            this.#failureFromDetails(
              'restoreAll',
              display.error,
              display.displayId,
              display.code
            )
          )
        } else {
          failures.push(
            this.#failureFromDetails(
              'restoreAll',
              `Display was not restored: ${display.reason ?? 'unknown reason'}.`,
              display.displayId,
              display.code
            )
          )
        }
      }

      for (const failure of failures) {
        if (failure.displayId !== undefined) this.#capturedDisplayIds.add(failure.displayId)
      }

      if (failures.length > 0) {
        this.#resolver.reset()
        this.#logFailures(undefined, failures)
        return {
          status: 'partialFailure',
          resolution,
          failures,
          deferredDisplayIds: [...deferredDisplayIds]
        }
      }

      const deferredIds = [...deferredDisplayIds]
      this.logger.write({
        level: 'information',
        eventName: deferredIds.length === 0 ? 'BaselineRestored' : 'BaselineRestoreDeferred',
        reason: resolution.reason,
        displayIds: result.displays
          .filter((display) => display.restored)
          .map((display) => display.displayId),
        deferredDisplayIds: deferredIds
      })
      return {
        status: deferredIds.length === 0 ? 'activated' : 'skipped',
        resolution,
        failures: [],
        deferredDisplayIds: deferredIds
      }
    } catch (error) {
      const failure = this.#failure('restoreAll', error)
      this.#resolver.reset()
      this.#logFailures(undefined, [failure])
      return {
        status: 'failed',
        resolution,
        failures: [failure],
        deferredDisplayIds: []
      }
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

  #failureFromDetails(
    operation: ActivationOperation,
    message: string,
    displayId: string,
    code?: string
  ): ActivationFailure {
    return code === undefined
      ? { operation, displayId, message }
      : { operation, displayId, code, message }
  }

  #isHdrUnsafe(error: unknown): boolean {
    return describeError(error).code === 'HDR_UNSAFE'
  }

  #isDisplayDisconnected(error: unknown): boolean {
    return describeError(error).code === 'DISPLAY_NOT_FOUND'
  }

  #deferDisplay(
    profileId: string | undefined,
    displayId: string,
    operation: 'capture' | 'apply' | 'restore' | 'restoreAll',
    reason: 'hdrActive' | 'displayDisconnected',
    deferredDisplayIds: Set<string>
  ): void {
    if (deferredDisplayIds.has(displayId)) return
    deferredDisplayIds.add(displayId)
    this.logger.write({
      level: 'information',
      eventName: 'DisplaySettingDeferred',
      profileId,
      displayId,
      operation,
      reason
    })
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

  #reset(
    reason: 'externalRestore' | 'nativeServiceRestart',
    retainedDisplayIds: readonly string[] = []
  ): void {
    this.#resolver.reset()
    this.#capturedDisplayIds.clear()
    for (const displayId of retainedDisplayIds) this.#capturedDisplayIds.add(displayId)
    this.logger.write({
      level: 'information',
      eventName: 'ActivationStateReset',
      reason,
      retainedBaselineDisplayIds: [...this.#capturedDisplayIds]
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
