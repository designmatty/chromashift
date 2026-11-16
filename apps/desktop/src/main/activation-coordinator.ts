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
  DisplayCapabilityReport,
  DisplayRestoreResult,
  DisplaySettings,
  RestoreAllResult
} from '@chromashift/native-client'
import {
  hasDisplaySettings,
  projectDisplaySettings,
  withheldSettingNames
} from '@main/display-settings-projection.js'
import { describeError, type StructuredLogger } from '@main/structured-logger.js'
import type { LearnedGammaLimits } from '@main/learned-gamma-limits.js'

export interface NativeActivationPort {
  getDisplays(): Promise<Display[]>
  getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport>
  captureBaseline(displayId: string): Promise<BaselineCaptureResult>
  applyDisplaySettings(displayId: string, settings: DisplaySettings): Promise<DisplayApplyResult>
  restoreDisplay(displayId: string): Promise<DisplayRestoreResult>
  restoreAllBaselines(): Promise<RestoreAllResult>
}

export type ActivationOperation =
  'configuration' | 'enumerateDisplays' | 'capture' | 'apply' | 'restore' | 'restoreAll' | 'control'

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

export function hasRestoreFailure(outcome: Pick<ActivationOutcome, 'failures'>): boolean {
  return outcome.failures.some(
    (failure) =>
      failure.operation === 'restore' ||
      failure.operation === 'restoreAll' ||
      failure.code === 'BASELINE_RESTORE_FAILED'
  )
}

function findSelectedProfile(
  configuration: ProfileConfiguration,
  resolution: ActivationResolution
): ColorProfile | null {
  if (resolution.target.kind === 'baseline') return null
  const profileId = resolution.target.profileId
  return (
    configuration.profiles.find(
      (profile) => profile.id.toLowerCase() === profileId.toLowerCase()
    ) ?? null
  )
}

export class ActivationCoordinator {
  readonly #resolver = new ActivationResolver()
  readonly #capturedDisplayIds = new Set<string>()
  /**
   * Displays whose last activation write was an HDR-projected apply: saturation
   * and hue only, with the GDI ramp at its captured baseline. Removed before any
   * other write attempt and on every restore or reset, so an unknown display
   * always counts as possibly carrying SDR ramp values.
   */
  readonly #hdrProjectedDisplayIds = new Map<string, string>()
  #queue: Promise<void> = Promise.resolve()
  #restorationBlocked = false

  public constructor(
    private readonly repository: ProfileRepository,
    private readonly native: NativeActivationPort,
    private readonly logger: StructuredLogger,
    private readonly limits?: LearnedGammaLimits
  ) {}

  public activate(
    foregroundApplication: ForegroundApplication | null,
    mode: ActivationMode | (() => ActivationMode) = automaticActivationMode,
    options: { canWrite?: () => boolean; recovery?: boolean } = {}
  ): Promise<ActivationOutcome> {
    return this.#enqueue(async () => {
      // Check inside the existing queue, before configuration reads or native work.
      if (this.#restorationBlocked && !options.recovery) {
        return {
          status: 'failed',
          resolution: null,
          deferredDisplayIds: [],
          failures: [
            {
              operation: 'control',
              code: 'RESTORE_PENDING',
              message: 'Display restoration is pending.'
            }
          ]
        }
      }
      if (options.canWrite?.() === false) {
        return { status: 'skipped', resolution: null, failures: [], deferredDisplayIds: [] }
      }
      if (this.#restorationBlocked && options.recovery) {
        // Confirm all tracked restoration before allowing any recovery profile writes.
        const restoration = await this.#restoreBaseline({
          target: { kind: 'baseline' },
          reason: 'baseline',
          changed: true,
          previousTarget: this.#resolver.currentTarget
        })
        if (hasRestoreFailure(restoration)) return { ...restoration, resolution: null }
        this.#resolver.reset()
      }
      const outcome = await this.#transition(
        foregroundApplication,
        typeof mode === 'function' ? mode() : mode
      )
      if (hasRestoreFailure(outcome)) this.#restorationBlocked = true
      else if (options.recovery && outcome.failures.length === 0) this.#restorationBlocked = false
      return outcome
    })
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
      this.#restorationBlocked = hasRestoreFailure(outcome)
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

  /** Snapshot only; the native service remains the immutable baseline owner. */
  public get capturedDisplayIds(): readonly string[] {
    return [...this.#capturedDisplayIds]
  }

  public get restorationBlocked(): boolean {
    return this.#restorationBlocked
  }

  /** Snapshot for preview sessions, read after the activation queue drains. */
  public get hdrProjectedDisplayIds(): readonly string[] {
    return [...this.#hdrProjectedDisplayIds.values()]
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
    // Under HDR only capability-supported controls outside the SDR-only ramp set
    // reach native (#89). An empty request holds that display at Original settings.
    const hdrRequests = new Map<string, DisplaySettings>()
    for (const target of desiredTargets) {
      const key = target.displayId.toLowerCase()
      if (!hdrDisplayIds.has(key) || !connectedDisplayIds.has(key)) continue
      hdrRequests.set(key, await this.#hdrRequest(target.displayId, target.color, failures))
    }
    let hdrRejected = false

    for (const displayId of [...this.#capturedDisplayIds]) {
      const key = displayId.toLowerCase()
      // Native Apply restores the captured baseline before every write, so a
      // display that will be written is not restored here.
      if (
        normalizedDesiredIds.has(key) &&
        (!hdrDisplayIds.has(key) || hasDisplaySettings(hdrRequests.get(key)))
      )
        continue
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
      await this.#restoreTracked(
        profile.id,
        displayId,
        'profileTargetChanged',
        failures,
        deferredDisplayIds
      )
    }

    for (const target of desiredTargets) {
      // A restore failure blocks every subsequent profile write, including SDR.
      if (hasRestoreFailure({ failures })) break
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
      const key = target.displayId.toLowerCase()
      const hdrRequest = hdrDisplayIds.has(key) ? (hdrRequests.get(key) ?? {}) : undefined
      if (hdrRequest !== undefined && !hasDisplaySettings(hdrRequest)) {
        this.#deferDisplay(profile.id, target.displayId, 'apply', 'hdrActive', deferredDisplayIds)
        continue
      }
      try {
        await this.native.captureBaseline(target.displayId)
        this.#capturedDisplayIds.add(target.displayId)
      } catch (error) {
        if (this.#isHdrUnsafe(error)) {
          hdrRejected = true
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

      if (hdrRequest !== undefined) {
        this.logger.write({
          level: 'information',
          eventName: 'HdrSettingsWithheld',
          profileId: profile.id,
          displayId: target.displayId,
          settings: withheldSettingNames(target.color, hdrRequest)
        })
      }
      // Until this write is confirmed, the display may show any earlier output.
      this.#hdrProjectedDisplayIds.delete(key)
      let applied = false
      try {
        await this.native.applyDisplaySettings(target.displayId, hdrRequest ?? target.color)
        applied = true
        if (hdrRequest !== undefined) this.#hdrProjectedDisplayIds.set(key, target.displayId)
        await this.limits?.clampSavedProfile(this.repository, profile.id)
      } catch (error) {
        if (this.#isHdrUnsafe(error)) {
          // Native refused before any write. Never count this as applied.
          hdrRejected = true
          this.#deferDisplay(profile.id, target.displayId, 'apply', 'hdrActive', deferredDisplayIds)
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
          // A refused HDR projection writes nothing, so the display may still show
          // earlier SDR output, including a transformed ramp. Hold it at Original
          // settings; an unconfirmed restore blocks the remaining and queued writes.
          if (
            hdrRequest !== undefined &&
            !applied &&
            describeError(error).code !== 'BASELINE_RESTORE_FAILED'
          ) {
            await this.#restoreTracked(
              profile.id,
              target.displayId,
              'hdrProjectionRefused',
              failures,
              deferredDisplayIds
            )
          }
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

    // An HDR race refused a write. The next activation or the topology transition
    // must retry instead of deduplicating this target.
    if (hdrRejected) this.#resolver.reset()
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
          this.#hdrProjectedDisplayIds.delete(display.displayId.toLowerCase())
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
            this.#failureFromDetails('restoreAll', display.error, display.displayId, display.code)
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
        path: foregroundApplication?.path,
        windowClass: foregroundApplication?.windowClass
      })
      return
    }

    const foregroundMatch =
      resolution.reason === 'foregroundApplication'
        ? findMatchingProfile(configuration.profiles, foregroundApplication)
        : null
    this.logger.write({
      level: 'information',
      eventName: 'ProfileMatched',
      profileId: resolution.target.profileId,
      reason: resolution.reason,
      matchType: foregroundMatch?.type,
      executable: foregroundApplication?.executable,
      path: foregroundApplication?.path,
      windowClass: foregroundApplication?.windowClass
    })
  }

  #failure(operation: ActivationOperation, error: unknown, displayId?: string): ActivationFailure {
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

  /**
   * Restores one tracked display through native restore. A disconnect defers it
   * with its baseline retained; any other unconfirmed restore is a restore
   * failure, which stops every later write in this transition and queued work.
   */
  async #restoreTracked(
    profileId: string,
    displayId: string,
    reason: 'profileTargetChanged' | 'hdrProjectionRefused',
    failures: ActivationFailure[],
    deferredDisplayIds: Set<string>
  ): Promise<void> {
    try {
      const result = await this.native.restoreDisplay(displayId)
      if (!result.restored) {
        if (result.code === 'DISPLAY_NOT_FOUND') {
          this.#deferDisplay(
            profileId,
            displayId,
            'restore',
            'displayDisconnected',
            deferredDisplayIds
          )
          return
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
          return
        }
      }
      this.#capturedDisplayIds.delete(displayId)
      this.#hdrProjectedDisplayIds.delete(displayId.toLowerCase())
      this.logger.write({
        level: 'information',
        eventName: result.restored ? 'BaselineRestored' : 'BaselineRestoreSkipped',
        displayId,
        reason: result.restored ? reason : result.reason
      })
    } catch (error) {
      if (this.#isDisplayDisconnected(error)) {
        this.#deferDisplay(profileId, displayId, 'restore', 'displayDisconnected', deferredDisplayIds)
      } else {
        failures.push(this.#failure('restore', error, displayId))
      }
    }
  }

  /** Unknown HDR capabilities fail closed: hold Original settings and surface the error. */
  async #hdrRequest(
    displayId: string,
    color: DisplaySettings,
    failures: ActivationFailure[]
  ): Promise<DisplaySettings> {
    try {
      const report = await this.native.getDisplayCapabilityReport(displayId)
      return projectDisplaySettings(color, report.capabilities, true)
    } catch (error) {
      if (!this.#isDisplayDisconnected(error)) failures.push(this.#failure('apply', error, displayId))
      return {}
    }
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
    if (reason === 'nativeServiceRestart') this.#restorationBlocked = false
    this.#resolver.reset()
    this.#capturedDisplayIds.clear()
    this.#hdrProjectedDisplayIds.clear()
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
