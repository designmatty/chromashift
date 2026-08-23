import {
  automaticActivationMode,
  manualActivationMode,
  type ActivationMode,
  type ActivationTarget,
  type ForegroundApplication
} from '@chromashift/core'
import type {
  CompletedActivationOutcome,
  ActivationOrigin,
  ActivationSource
} from './automatic-activation-controller.js'
import { describeError, type StructuredLogger } from './structured-logger.js'

export type ChromaShiftStatus = 'active' | 'paused' | 'safetyBlocked'

export interface ChromaShiftPersistedState {
  status: ChromaShiftStatus
  pendingOperation: 'pause' | 'resume' | null
  intendedMode: ActivationMode
  intendedTarget: ActivationTarget | null
}

type ChromaShiftInitialState = Omit<ChromaShiftPersistedState, 'pendingOperation'> & {
  pendingOperation?: ChromaShiftPersistedState['pendingOperation']
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
  refreshAfterConfigurationChange(): Promise<void>
}

export interface ChromaShiftTopologyPort {
  refreshTopology(): Promise<{ baselines: Array<{ ownership: string }> }>
  getForegroundApplication?(): Promise<ForegroundApplication | null>
}

export interface ChromaShiftPreviewPort {
  cancel(): Promise<void>
}

export class ChromaShiftController {
  readonly #listeners = new Set<(state: ChromaShiftState) => void>()
  readonly #operationalOutcomeListeners = new Set<(outcome: CompletedActivationOutcome) => void>()
  #state: ChromaShiftState
  #transition: Promise<CompletedActivationOutcome> | null = null

  public constructor(
    private readonly activation: ChromaShiftActivationPort,
    private readonly topology: ChromaShiftTopologyPort,
    private readonly preview: ChromaShiftPreviewPort,
    initial: ChromaShiftInitialState,
    private readonly persist: (state: ChromaShiftPersistedState) => Promise<void>,
    private readonly logger: StructuredLogger
  ) {
    this.#state = { ...clonePersisted(initial), transitionInProgress: false }
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
    this.#rememberActiveIntent()
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
            ...describeError(error)
          })
          throw error
        }
        await this.activation.waitForIdle()
        const outcome = await this.activation.restoreBaseline({ source, origin: 'pause' })
        const restored = restorationComplete(outcome)
        this.#state.status = restored ? 'paused' : 'safetyBlocked'
        this.#state.pendingOperation = restored ? null : 'pause'
        await this.#persistState()
        return outcome
      },
      { source, origin: 'pause' }
    )
  }

  public retrySafetyCheck(source: ActivationSource): Promise<CompletedActivationOutcome> {
    if (this.#transition !== null) return this.#transition
    if (this.#state.status !== 'safetyBlocked') return Promise.resolve(this.#statusOutcome(source))
    if (this.#state.pendingOperation === 'resume') {
      return this.#runTransition(() => this.#resumeOperation(source), {
        source,
        origin: 'resume'
      })
    }
    return this.#runTransition(
      async () => {
        await this.activation.suspendWrites()
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

  public async selectManualProfile(
    profileId: string,
    source: ActivationSource = 'manual'
  ): Promise<CompletedActivationOutcome> {
    if (this.#transition !== null) await this.#transition
    if (this.#state.status !== 'active') {
      const target = { kind: 'profile' as const, profileId }
      await this.activation.setSuspendedIntent(manualActivationMode(profileId), target)
      this.#state.intendedMode = manualActivationMode(profileId)
      this.#state.intendedTarget = target
      await this.#persistState()
      if (this.#state.status === 'safetyBlocked') return this.#statusOutcome(source)
      return this.resume(source)
    }
    let outcome: CompletedActivationOutcome
    try {
      outcome = await this.activation.selectManualProfile(profileId, {
        source,
        origin: source === 'shortcut' ? 'shortcut' : 'profileSelection'
      })
    } catch (error) {
      this.#state.intendedMode = manualActivationMode(profileId)
      this.#state.intendedTarget = { kind: 'profile', profileId }
      await this.#persistState()
      if (source === 'shortcut') this.#publishOperationalFailure(source, 'shortcut', error)
      throw error
    }
    this.#state.intendedMode = manualActivationMode(profileId)
    this.#state.intendedTarget = cloneTarget(outcome.resolution?.target ?? null)
    await this.#persistState()
    return outcome
  }

  public async enableAutomatic(
    source: ActivationSource = 'manual'
  ): Promise<CompletedActivationOutcome> {
    if (this.#transition !== null) await this.#transition
    if (this.#state.status !== 'active') {
      await this.activation.setSuspendedIntent(automaticActivationMode, null)
      this.#state.intendedMode = automaticActivationMode
      this.#state.intendedTarget = null
      await this.#persistState()
      if (this.#state.status === 'safetyBlocked') return this.#statusOutcome(source)
      return this.resume(source)
    }
    let outcome: CompletedActivationOutcome
    try {
      outcome = await this.activation.enableAutomatic({
        source,
        origin: source === 'shortcut' ? 'shortcut' : 'automaticSelection'
      })
    } catch (error) {
      this.#state.intendedMode = automaticActivationMode
      await this.#persistState()
      if (source === 'shortcut') this.#publishOperationalFailure(source, 'shortcut', error)
      throw error
    }
    this.#state.intendedMode = automaticActivationMode
    this.#state.intendedTarget = cloneTarget(outcome.resolution?.target ?? null)
    await this.#persistState()
    return outcome
  }

  public toggle(source: ActivationSource): Promise<CompletedActivationOutcome> {
    if (this.#transition !== null) return this.#transition
    if (this.#state.status === 'active') return this.pause(source)
    if (this.#state.status === 'paused') return this.resume(source)
    return this.retrySafetyCheck(source)
  }

  public restoreBaseline(): Promise<CompletedActivationOutcome> {
    if (this.#state.status !== 'active') return Promise.resolve(this.#statusOutcome('manual'))
    return this.#runTransition(
      () =>
        this.activation.restoreBaseline({
          source: 'manual',
          origin: 'originalSettingsRestore'
        }),
      { source: 'manual', origin: 'originalSettingsRestore' }
    )
  }

  public refreshAfterConfigurationChange(): Promise<void> {
    return this.activation.refreshAfterConfigurationChange()
  }

  public async reconcileAutomaticIntent(): Promise<void> {
    if (this.#state.status === 'active') {
      await this.enableAutomatic('manual')
      return
    }
    await this.activation.setSuspendedIntent(automaticActivationMode, null)
    this.#state.intendedMode = automaticActivationMode
    this.#state.intendedTarget = null
    await this.#persistState()
  }

  public async syncActiveIntent(): Promise<void> {
    if (this.#state.status !== 'active' || this.#state.transitionInProgress) return
    this.#rememberActiveIntent()
    await this.#persistState()
  }

  public async recordCompletedOutcome(outcome: CompletedActivationOutcome): Promise<void> {
    if (
      this.#state.status !== 'active' ||
      this.#state.transitionInProgress ||
      outcome.resolution === null
    )
      return
    this.#state.intendedMode = { ...this.activation.state.mode }
    this.#state.intendedTarget = { ...outcome.resolution.target }
    await this.#persistState()
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
            failureContext.origin === 'safetyRetry' ||
            failureContext.origin === 'resume'
          ) {
            this.#state.status = 'safetyBlocked'
            this.#state.pendingOperation = failureContext.origin === 'resume' ? 'resume' : 'pause'
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

  async #resumeOperation(source: ActivationSource): Promise<CompletedActivationOutcome> {
    const topology = await this.topology.refreshTopology()
    if (topology.baselines.some((baseline) => baseline.ownership === 'providerChanged')) {
      this.#state.status = 'safetyBlocked'
      this.#state.pendingOperation = 'resume'
      throw new Error('Display baseline ownership changed; ChromaShift remains Safety blocked.')
    }
    await this.activation.setSuspendedIntent(this.#state.intendedMode, this.#state.intendedTarget)
    const currentApplication = await this.topology.getForegroundApplication?.()
    const outcome = await this.activation.resumeCurrent(currentApplication, {
      source,
      origin: 'resume'
    })
    this.#state.status = 'active'
    this.#state.pendingOperation = null
    this.#state.intendedMode = { ...this.activation.state.mode }
    this.#state.intendedTarget = cloneTarget(
      outcome.resolution?.target ?? this.#state.intendedTarget
    )
    await this.#persistState()
    return outcome
  }

  #rememberActiveIntent(): void {
    this.#state.intendedMode = { ...this.activation.state.mode }
    if (this.activation.state.currentTarget !== null) {
      this.#state.intendedTarget = cloneTarget(this.activation.state.currentTarget)
    }
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

function clonePersisted(state: ChromaShiftInitialState): ChromaShiftPersistedState {
  return {
    status: state.status,
    pendingOperation: state.pendingOperation ?? null,
    intendedMode: { ...state.intendedMode },
    intendedTarget: cloneTarget(state.intendedTarget)
  }
}
