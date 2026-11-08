import {
  automaticActivationMode,
  manualActivationMode,
  type ActivationMode,
  type ActivationTarget,
  type ForegroundApplication
} from '@chromashift/core'
import type {
  CompletedActivationOutcome,
  ConfigurationChange,
  ActivationOrigin,
  ActivationSource
} from '@main/automatic-activation-controller.js'
import { describeError, type StructuredLogger } from '@main/structured-logger.js'
import { hasRestoreFailure } from '@main/activation-coordinator.js'

export type ChromaShiftStatus = 'active' | 'paused' | 'safetyBlocked'

export interface ChromaShiftPersistedState {
  status: ChromaShiftStatus
  pendingOperation: 'pause' | 'resume' | 'previewRestore' | null
  intendedMode: ActivationMode
  intendedTarget: ActivationTarget | null
}

type ChromaShiftInitialState = Omit<ChromaShiftPersistedState, 'pendingOperation'> & {
  pendingOperation?: ChromaShiftPersistedState['pendingOperation']
}

type ChromaShiftIntent = Pick<ChromaShiftPersistedState, 'intendedMode' | 'intendedTarget'>

/**
 * The resume intent captured before a restore that runs outside this
 * controller. `intentGeneration` identifies the latest real intent change at
 * capture time, so a newer change can be detected after the outside restore
 * has replaced the live target with original settings.
 */
export interface ChromaShiftIntentSnapshot extends ChromaShiftIntent {
  readonly intentGeneration: number
}

export interface ChromaShiftState extends ChromaShiftPersistedState {
  transitionInProgress: boolean
}

export interface ChromaShiftActivationPort {
  readonly state: {
    enabled: boolean
    mode: ActivationMode
    currentTarget: ActivationTarget | null
  }
  suspendWrites(): Promise<void>
  waitForIdle(): Promise<void>
  restoreBaseline(context?: {
    source: ActivationSource
    origin: 'pause' | 'safetyRetry' | 'originalSettingsRestore'
  }): Promise<CompletedActivationOutcome>
  resumeCurrent(
    currentApplication?: ForegroundApplication | null,
    context?: { source: ActivationSource; origin: 'resume' }
  ): Promise<CompletedActivationOutcome>
  setSuspendedIntent(mode: ActivationMode, target: ActivationTarget | null): Promise<void>
  selectManualProfile(
    profileId: string,
    context?: { source: ActivationSource; origin: 'profileSelection' | 'shortcut' }
  ): Promise<CompletedActivationOutcome>
  enableAutomatic(context?: {
    source: ActivationSource
    origin: 'automaticSelection' | 'shortcut'
  }): Promise<CompletedActivationOutcome>
  refreshAfterConfigurationChange(change?: ConfigurationChange): Promise<void>
}

export interface ChromaShiftTopologyPort {
  refreshTopology(): Promise<{ baselines: Array<{ ownership: string }> }>
  getForegroundApplication?(): Promise<ForegroundApplication | null>
}

export interface ChromaShiftPreviewPort {
  cancel(): Promise<void>
  readonly sessionRecoveryPending?: boolean
  retryRestoration?(): Promise<boolean>
}

export class ChromaShiftController {
  readonly #listeners = new Set<(state: ChromaShiftState) => void>()
  readonly #operationalOutcomeListeners = new Set<(outcome: CompletedActivationOutcome) => void>()
  #state: ChromaShiftState
  #transition: Promise<CompletedActivationOutcome> | null = null
  // The latest real intent and a counter that increments on every real change.
  // State synchronization may report the direct restore's temporary baseline.
  // Keep the resume intent independently until a real selection or completed
  // resolution replaces it, including a genuine resolution to baseline.
  #realIntent: ChromaShiftIntent
  #intentGeneration = 0

  public constructor(
    private readonly activation: ChromaShiftActivationPort,
    private readonly topology: ChromaShiftTopologyPort,
    private readonly preview: ChromaShiftPreviewPort,
    initial: ChromaShiftInitialState,
    private readonly persist: (state: ChromaShiftPersistedState) => Promise<void>,
    private readonly logger: StructuredLogger
  ) {
    this.#state = { ...clonePersisted(initial), transitionInProgress: false }
    this.#realIntent = cloneIntent(this.#state)
  }

  public get state(): ChromaShiftActivationPort['state'] {
    return this.activation.state
  }

  public get chromaShiftState(): ChromaShiftState {
    return {
      ...clonePersisted(this.#state),
      transitionInProgress: this.#state.transitionInProgress
    }
  }

  /**
   * Captures the intent to resume before a restore that runs outside this
   * controller. Pass the result to `restoreBaseline` once that restore succeeds.
   */
  public captureIntentSnapshot(): ChromaShiftIntentSnapshot {
    return { ...cloneIntent(this.#realIntent), intentGeneration: this.#intentGeneration }
  }

  public subscribe(listener: (state: ChromaShiftState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  public subscribeOperationalOutcomes(
    listener: (outcome: CompletedActivationOutcome) => void
  ): () => void {
    this.#operationalOutcomeListeners.add(listener)
    return () => this.#operationalOutcomeListeners.delete(listener)
  }

  public pause(source: ActivationSource): Promise<CompletedActivationOutcome> {
    if (this.#transition !== null) return this.#transition
    if (this.#state.status === 'paused') return Promise.resolve(this.#statusOutcome(source))
    return this.#restoreAndPause(source, 'pause')
  }

  /** Preview retains ownership until its connected-display rollback is confirmed. */
  public async previewRestoreFailed(): Promise<void> {
    if (this.#state.status === 'active') this.#rememberActiveIntent()
    this.#state.status = 'safetyBlocked'
    this.#state.pendingOperation ??= 'previewRestore'
    await this.activation.suspendWrites()
    await this.#persistState()
  }

  /** Called by the preview queue only after restoring and releasing its hold. */
  public async previewRestored(): Promise<void> {
    if (this.#state.pendingOperation !== 'previewRestore' || this.#transition !== null) return
    this.#state.pendingOperation = 'resume'
    await this.#runTransition(() => this.#resumeOperation('manual'), {
      source: 'manual',
      origin: 'resume'
    })
  }

  /** Reconfirm Original settings after draining any Retry or Resume writes. */
  public async emergencyRestoreConfirmed(
    intent: ChromaShiftIntentSnapshot
  ): Promise<CompletedActivationOutcome> {
    while (this.#transition !== null) await this.#transition.catch(() => undefined)
    return this.#restoreAndPause('shortcut', 'originalSettingsRestore', intent)
  }

  /**
   * Restore original settings: restores every owned baseline through the Pause
   * path and leaves display control Paused, preserving the Intended target for
   * a later resume. Paused and Safety-blocked control are left unchanged.
   *
   * `preservedIntent` is for a restore that already ran outside this
   * controller (the emergency shortcut), which has replaced the live target
   * with original settings. It comes from `captureIntentSnapshot` and supplies
   * the intent to resume afterwards unless a real intent change happened after
   * it was captured; the newer intent then survives.
   */
  public async restoreBaseline(
    source: ActivationSource = 'manual',
    preservedIntent?: ChromaShiftIntentSnapshot
  ): Promise<CompletedActivationOutcome> {
    while (this.#transition !== null) await this.#transition.catch(() => undefined)
    if (this.#state.status !== 'active') return this.#statusOutcome(source)
    return this.#restoreAndPause(source, 'originalSettingsRestore', preservedIntent)
  }

  public retrySafetyCheck(source: ActivationSource): Promise<CompletedActivationOutcome> {
    if (this.#transition !== null) return this.#transition
    if (this.#state.status !== 'safetyBlocked') return Promise.resolve(this.#statusOutcome(source))
    if (
      this.#state.pendingOperation === 'previewRestore' ||
      this.#state.pendingOperation === 'resume'
    ) {
      return this.#runTransition(
        async () => {
          if (!this.preview.sessionRecoveryPending) await this.preview.cancel()
          this.#state.pendingOperation = 'resume'
          return this.#resumeOperation(source, this.preview.sessionRecoveryPending)
        },
        { source, origin: 'resume' }
      )
    }
    return this.#runTransition(
      async () => {
        await this.activation.suspendWrites()
        await this.preview.cancel()
        await this.activation.waitForIdle()
        const outcome = await this.activation.restoreBaseline({ source, origin: 'safetyRetry' })
        const restored = restorationComplete(outcome)
        this.#state.status = restored ? 'paused' : 'safetyBlocked'
        this.#state.pendingOperation = restored ? null : 'pause'
        await this.#persistState()
        return outcome
      },
      { source, origin: 'safetyRetry' }
    )
  }

  public resume(source: ActivationSource): Promise<CompletedActivationOutcome> {
    if (this.#transition !== null) return this.#transition
    if (this.#state.status === 'active') return Promise.resolve(this.#statusOutcome(source))
    if (this.#state.status === 'safetyBlocked') return this.retrySafetyCheck(source)
    return this.#runTransition(
      async () => {
        this.#state.status = 'safetyBlocked'
        this.#state.pendingOperation = 'resume'
        await this.#persistState()
        return this.#resumeOperation(source)
      },
      { source, origin: 'resume' }
    )
  }

  /**
   * Selects a manual profile. While Paused or Safety blocked, only the Intended
   * target and mode change; display control stays where it is until the user
   * resumes it or a safety retry succeeds.
   */
  public async selectManualProfile(
    profileId: string,
    source: ActivationSource = 'manual'
  ): Promise<CompletedActivationOutcome> {
    if (this.#transition !== null) await this.#transition
    if (this.#state.status !== 'active') {
      const target = { kind: 'profile' as const, profileId }
      await this.activation.setSuspendedIntent(manualActivationMode(profileId), target)
      this.#setIntent(manualActivationMode(profileId), target)
      await this.#persistState()
      return this.#selectionStatusOutcome(source)
    }
    let outcome: CompletedActivationOutcome
    try {
      outcome = await this.activation.selectManualProfile(profileId, {
        source,
        origin: source === 'shortcut' ? 'shortcut' : 'profileSelection'
      })
    } catch (error) {
      this.#setIntent(manualActivationMode(profileId), { kind: 'profile', profileId })
      await this.#persistState()
      if (source === 'shortcut') this.#publishOperationalFailure(source, 'shortcut', error)
      throw error
    }
    this.#setIntent(manualActivationMode(profileId), outcome.resolution?.target ?? null)
    await this.#persistState()
    return outcome
  }

  /** Selects Automatic mode. While Paused or Safety blocked, only the intent changes. */
  public async enableAutomatic(
    source: ActivationSource = 'manual'
  ): Promise<CompletedActivationOutcome> {
    if (this.#transition !== null) await this.#transition
    if (this.#state.status !== 'active') {
      await this.activation.setSuspendedIntent(automaticActivationMode, null)
      this.#setIntent(automaticActivationMode, null)
      await this.#persistState()
      return this.#selectionStatusOutcome(source)
    }
    let outcome: CompletedActivationOutcome
    try {
      outcome = await this.activation.enableAutomatic({
        source,
        origin: source === 'shortcut' ? 'shortcut' : 'automaticSelection'
      })
    } catch (error) {
      this.#setIntent(automaticActivationMode, this.#state.intendedTarget)
      await this.#persistState()
      if (source === 'shortcut') this.#publishOperationalFailure(source, 'shortcut', error)
      throw error
    }
    this.#setIntent(automaticActivationMode, outcome.resolution?.target ?? null)
    await this.#persistState()
    return outcome
  }

  public toggle(source: ActivationSource): Promise<CompletedActivationOutcome> {
    if (this.#transition !== null) return this.#transition
    if (this.#state.status === 'active') return this.pause(source)
    if (this.#state.status === 'paused') return this.resume(source)
    return this.retrySafetyCheck(source)
  }

  public refreshAfterConfigurationChange(change?: ConfigurationChange): Promise<void> {
    return this.activation.refreshAfterConfigurationChange(change)
  }

  public async reconcileAutomaticIntent(): Promise<void> {
    if (this.#state.status === 'active') {
      await this.enableAutomatic('manual')
      return
    }
    await this.activation.setSuspendedIntent(automaticActivationMode, null)
    this.#setIntent(automaticActivationMode, null)
    await this.#persistState()
  }

  public async syncActiveIntent(): Promise<void> {
    if (this.#state.status !== 'active' || this.#state.transitionInProgress) return
    // State alone cannot distinguish direct restoration from a resolved baseline.
    // Completed resolutions record baseline intent through recordCompletedOutcome.
    this.#rememberActiveIntent(true)
    await this.#persistState()
  }

  public async recordCompletedOutcome(outcome: CompletedActivationOutcome): Promise<void> {
    if (
      this.#state.status !== 'active' ||
      this.#state.transitionInProgress ||
      outcome.resolution === null
    )
      return
    this.#setIntent(this.activation.state.mode, outcome.resolution.target)
    if (hasRestoreFailure(outcome)) {
      this.#state.status = 'safetyBlocked'
      this.#state.pendingOperation = 'resume'
      await this.activation.suspendWrites()
    }
    await this.#persistState()
  }

  #restoreAndPause(
    source: ActivationSource,
    origin: 'pause' | 'originalSettingsRestore',
    preservedIntent?: ChromaShiftIntentSnapshot
  ): Promise<CompletedActivationOutcome> {
    if (preservedIntent === undefined && this.#state.status === 'active') {
      this.#rememberActiveIntent()
    } else if (preservedIntent !== undefined) {
      // The outside restore replaced the live target with baseline, which is
      // not a real intent change. Resume the snapshot unless a real change
      // (a selection, preview teardown, or automatic resolution) followed it.
      const intent =
        preservedIntent.intentGeneration === this.#intentGeneration
          ? preservedIntent
          : this.#realIntent
      this.#setIntent(intent.intendedMode, intent.intendedTarget)
    }
    return this.#runTransition(
      async () => {
        this.#state.status = 'safetyBlocked'
        this.#state.pendingOperation = 'pause'
        await this.#persistState()
        await this.activation.suspendWrites()
        try {
          await this.preview.cancel()
        } catch (error) {
          this.logger.write({
            level: 'error',
            eventName: 'PausePreviewRestoreFailed',
            origin,
            ...describeError(error)
          })
          throw error
        }
        await this.activation.waitForIdle()
        const outcome = await this.activation.restoreBaseline({ source, origin })
        const restored = restorationComplete(outcome)
        this.#state.status = restored ? 'paused' : 'safetyBlocked'
        this.#state.pendingOperation = restored ? null : 'pause'
        await this.#persistState()
        return outcome
      },
      { source, origin }
    )
  }

  #runTransition(
    operation: () => Promise<CompletedActivationOutcome>,
    failureContext?: { source: ActivationSource; origin: ActivationOrigin }
  ): Promise<CompletedActivationOutcome> {
    this.#state.transitionInProgress = true
    this.#emit()
    const transition = operation()
      .then((outcome) => {
        if (failureContext !== undefined) this.#publishOperationalOutcome(outcome)
        return outcome
      })
      .catch(async (error: unknown) => {
        if (failureContext !== undefined) {
          if (
            failureContext.origin === 'pause' ||
            failureContext.origin === 'originalSettingsRestore' ||
            failureContext.origin === 'safetyRetry' ||
            failureContext.origin === 'resume'
          ) {
            this.#state.status = 'safetyBlocked'
            if (this.#state.pendingOperation !== 'previewRestore') {
              this.#state.pendingOperation = failureContext.origin === 'resume' ? 'resume' : 'pause'
            }
            try {
              await this.#persistState()
            } catch (persistError) {
              this.logger.write({
                level: 'error',
                eventName: 'ChromaShiftRecoveryStatePersistFailed',
                ...describeError(persistError)
              })
            }
          }
          this.#publishOperationalFailure(failureContext.source, failureContext.origin, error)
        }
        throw error
      })
      .finally(() => {
        this.#state.transitionInProgress = false
        this.#transition = null
        this.#emit()
      })
    this.#transition = transition
    return transition
  }

  async #resumeOperation(
    source: ActivationSource,
    recoverPreview = false
  ): Promise<CompletedActivationOutcome> {
    const topology = await this.topology.refreshTopology()
    if (topology.baselines.some((baseline) => baseline.ownership === 'providerChanged')) {
      this.#state.status = 'safetyBlocked'
      this.#state.pendingOperation = 'resume'
      throw new Error('Display baseline ownership changed; ChromaShift remains Safety blocked.')
    }
    if (recoverPreview && !(await this.preview.retryRestoration?.())) await this.preview.cancel()
    await this.activation.setSuspendedIntent(this.#state.intendedMode, this.#state.intendedTarget)
    const currentApplication = await this.topology.getForegroundApplication?.()
    const outcome = await this.activation.resumeCurrent(currentApplication, {
      source,
      origin: 'resume'
    })
    const restoreFailed = outcome.status === 'failed' || outcome.status === 'partialFailure'
    this.#state.status = restoreFailed ? 'safetyBlocked' : 'active'
    this.#state.pendingOperation = restoreFailed ? 'resume' : null
    if (restoreFailed) await this.activation.suspendWrites()
    this.#setIntent(
      this.activation.state.mode,
      outcome.resolution?.target ?? this.#state.intendedTarget
    )
    await this.#persistState()
    return outcome
  }

  #rememberActiveIntent(temporaryBaseline = false): void {
    this.#setIntent(
      this.activation.state.mode,
      this.activation.state.currentTarget ?? this.#state.intendedTarget,
      temporaryBaseline
    )
  }

  #setIntent(
    mode: ActivationMode,
    target: ActivationTarget | null,
    temporaryBaseline = false
  ): void {
    this.#state.intendedMode = { ...mode }
    this.#state.intendedTarget = cloneTarget(target)
    const real = this.#realIntent
    if (
      sameMode(mode, real.intendedMode) &&
      ((temporaryBaseline && target?.kind === 'baseline') ||
        sameTarget(target, real.intendedTarget))
    )
      return
    this.#realIntent = cloneIntent(this.#state)
    this.#intentGeneration += 1
  }

  async #persistState(): Promise<void> {
    await this.persist(clonePersisted(this.#state))
    this.#emit()
  }

  #statusOutcome(source: ActivationSource): CompletedActivationOutcome {
    return {
      status: 'skipped',
      resolution: {
        target: this.#state.intendedTarget ?? { kind: 'baseline' },
        reason: this.#state.intendedMode.kind === 'manual' ? 'manualOverride' : 'baseline',
        changed: false,
        previousTarget: this.#state.intendedTarget
      },
      failures: [],
      deferredDisplayIds: [],
      source,
      origin: 'statusControl'
    }
  }

  #selectionStatusOutcome(source: ActivationSource): CompletedActivationOutcome {
    const outcome = this.#statusOutcome(source)
    if (source === 'shortcut' && this.#state.status === 'paused') {
      outcome.pausedSelection = { ...this.#state.intendedMode }
      this.#publishOperationalOutcome(outcome)
    }
    return outcome
  }

  #emit(): void {
    const state = this.chromaShiftState
    for (const listener of this.#listeners) listener(state)
  }

  #publishOperationalFailure(
    source: ActivationSource,
    origin: ActivationOrigin,
    error: unknown
  ): void {
    const outcome: CompletedActivationOutcome = {
      status: 'failed',
      resolution: {
        target: this.#state.intendedTarget ?? { kind: 'baseline' },
        reason: this.#state.intendedMode.kind === 'manual' ? 'manualOverride' : 'baseline',
        changed: false,
        previousTarget: this.#state.intendedTarget
      },
      failures: [{ operation: 'control', message: describeError(error).message }],
      deferredDisplayIds: [],
      source,
      origin
    }
    this.#publishOperationalOutcome(outcome)
  }

  #publishOperationalOutcome(outcome: CompletedActivationOutcome): void {
    for (const listener of this.#operationalOutcomeListeners) listener(outcome)
  }
}

function restorationComplete(outcome: CompletedActivationOutcome): boolean {
  return (
    outcome.status !== 'failed' &&
    outcome.status !== 'partialFailure' &&
    outcome.deferredDisplayIds.length === 0
  )
}

function cloneTarget(target: ActivationTarget | null): ActivationTarget | null {
  return target === null ? null : { ...target }
}

function cloneIntent(intent: ChromaShiftIntent): ChromaShiftIntent {
  return {
    intendedMode: { ...intent.intendedMode },
    intendedTarget: cloneTarget(intent.intendedTarget)
  }
}

function sameMode(left: ActivationMode, right: ActivationMode): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== 'manual' || (right.kind === 'manual' && left.profileId === right.profileId))
  )
}

function sameTarget(left: ActivationTarget | null, right: ActivationTarget | null): boolean {
  if (left === null || right === null) return left === right
  return (
    left.kind === right.kind &&
    (left.kind !== 'profile' || (right.kind === 'profile' && left.profileId === right.profileId))
  )
}

function clonePersisted(state: ChromaShiftInitialState): ChromaShiftPersistedState {
  return {
    status: state.status,
    pendingOperation: state.pendingOperation ?? null,
    intendedMode: { ...state.intendedMode },
    intendedTarget: cloneTarget(state.intendedTarget)
  }
}
