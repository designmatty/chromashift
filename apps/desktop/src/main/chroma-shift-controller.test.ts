import { manualActivationMode, type ActivationMode, type ActivationTarget } from '@chromashift/core'
import { describe, expect, it, vi } from 'vitest'
import type { CompletedActivationOutcome } from './automatic-activation-controller.js'
import {
  ChromaShiftController,
  type ChromaShiftActivationPort,
  type ChromaShiftPersistedState
} from './chroma-shift-controller.js'

function outcome(
  target: ActivationTarget = { kind: 'profile', profileId: 'gaming' },
  overrides: Partial<CompletedActivationOutcome> = {}
): CompletedActivationOutcome {
  return {
    status: 'activated',
    resolution: {
      target,
      reason: target.kind === 'baseline' ? 'baseline' : 'manualOverride',
      changed: true,
      previousTarget: null
    },
    failures: [],
    deferredDisplayIds: [],
    source: 'manual',
    origin: 'profileSelection',
    ...overrides
  }
}

class FakeActivation implements ChromaShiftActivationPort {
  public state: ChromaShiftActivationPort['state'] = {
    enabled: true,
    mode: manualActivationMode('gaming') as ActivationMode,
    currentTarget: { kind: 'profile' as const, profileId: 'gaming' }
  }
  public restoreOutcome = outcome({ kind: 'baseline' })
  public selectOutcome: CompletedActivationOutcome | null = null
  public resumeOutcome: CompletedActivationOutcome | null = null
  public clearTargetOnSelect = false
  public readonly calls: string[] = []

  public suspendWrites(): Promise<void> {
    this.calls.push('suspend')
    return Promise.resolve()
  }
  public waitForIdle(): Promise<void> {
    this.calls.push('idle')
    return Promise.resolve()
  }
  public restoreBaseline(): Promise<CompletedActivationOutcome> {
    this.calls.push('restore')
    return Promise.resolve(this.restoreOutcome)
  }
  public resumeCurrent(
    _currentApplication?: null,
    context?: { source: CompletedActivationOutcome['source']; origin: 'resume' }
  ): Promise<CompletedActivationOutcome> {
    this.calls.push('resume')
    return Promise.resolve(
      this.resumeOutcome ??
        outcome(this.state.currentTarget!, {
          source: context?.source ?? 'manual',
          origin: context?.origin ?? 'resume'
        })
    )
  }
  public setSuspendedIntent(mode: ActivationMode, target: ActivationTarget | null): Promise<void> {
    this.calls.push(`intent:${mode.kind === 'manual' ? mode.profileId : 'automatic'}`)
    this.state = { ...this.state, mode, currentTarget: target }
    return Promise.resolve()
  }
  public selectManualProfile(profileId: string): Promise<CompletedActivationOutcome> {
    this.calls.push(`select:${profileId}`)
    this.state = {
      ...this.state,
      mode: manualActivationMode(profileId),
      currentTarget: this.clearTargetOnSelect ? null : { kind: 'profile', profileId }
    }
    return Promise.resolve(this.selectOutcome ?? outcome({ kind: 'profile', profileId }))
  }
  public enableAutomatic(): Promise<CompletedActivationOutcome> {
    this.calls.push('automatic')
    return Promise.resolve(outcome())
  }
  public refreshAfterConfigurationChange(): Promise<void> {
    return Promise.resolve()
  }
}

function create(
  activation = new FakeActivation(),
  initial: ChromaShiftPersistedState = {
    status: 'active',
    pendingOperation: null,
    intendedMode: manualActivationMode('gaming'),
    intendedTarget: { kind: 'profile', profileId: 'gaming' }
  }
) {
  const persisted: ChromaShiftPersistedState[] = []
  const refreshTopology = vi.fn(() =>
    Promise.resolve({ baselines: [{ ownership: 'owned' as const }] })
  )
  const cancelPreview = vi.fn(() => Promise.resolve())
  const controller = new ChromaShiftController(
    activation,
    { refreshTopology },
    { cancel: cancelPreview },
    initial,
    (state) => {
      persisted.push(state)
      return Promise.resolve()
    },
    { write: () => undefined }
  )
  return { activation, controller, persisted, refreshTopology, cancelPreview }
}

describe('ChromaShiftController pause safety', () => {
  it('enters Paused only after preview teardown, queued work, and full restoration', async () => {
    const { activation, controller, persisted, cancelPreview } = create()

    await controller.pause('manual')

    expect(cancelPreview).toHaveBeenCalledOnce()
    expect(activation.calls).toEqual(['suspend', 'idle', 'restore'])
    expect(controller.chromaShiftState).toMatchObject({
      status: 'paused',
      transitionInProgress: false
    })
    expect(persisted.at(-1)?.status).toBe('paused')
  })

  it('fails closed into Safety blocked and a successful retry completes the pending pause', async () => {
    const { activation, controller } = create()
    activation.restoreOutcome = outcome(
      { kind: 'baseline' },
      { deferredDisplayIds: ['display:one'] }
    )

    await controller.pause('manual')
    expect(controller.chromaShiftState.status).toBe('safetyBlocked')

    activation.restoreOutcome = outcome({ kind: 'baseline' })
    await controller.retrySafetyCheck('manual')

    expect(controller.chromaShiftState.status).toBe('paused')
    expect(activation.calls.filter((call) => call === 'restore')).toHaveLength(2)
  })

  it('fails closed when preview teardown cannot confirm rollback', async () => {
    const { controller, cancelPreview } = create()
    const operationalOutcomes: CompletedActivationOutcome[] = []
    controller.subscribeOperationalOutcomes((value) => operationalOutcomes.push(value))
    cancelPreview.mockRejectedValueOnce(new Error('Preview restore failed.'))

    await expect(controller.pause('manual')).rejects.toThrow('Preview restore failed.')

    expect(controller.chromaShiftState.status).toBe('safetyBlocked')
    expect(operationalOutcomes).toMatchObject([
      {
        status: 'failed',
        origin: 'pause',
        failures: [{ operation: 'control', message: 'Preview restore failed.' }]
      }
    ])
  })

  it('persists a fail-safe marker before restoration and still reports a later persistence failure', async () => {
    const activation = new FakeActivation()
    let persistedState: ChromaShiftPersistedState | null = null
    let persistCalls = 0
    const controller = new ChromaShiftController(
      activation,
      { refreshTopology: () => Promise.resolve({ baselines: [{ ownership: 'owned' }] }) },
      { cancel: () => Promise.resolve() },
      {
        status: 'active',
        pendingOperation: null,
        intendedMode: manualActivationMode('gaming'),
        intendedTarget: { kind: 'profile', profileId: 'gaming' }
      },
      (state) => {
        persistCalls += 1
        if (persistCalls > 1) return Promise.reject(new Error('Settings write failed.'))
        persistedState = state
        return Promise.resolve()
      },
      { write: () => undefined }
    )
    const operationalOutcomes: CompletedActivationOutcome[] = []
    controller.subscribeOperationalOutcomes((value) => operationalOutcomes.push(value))

    await expect(controller.pause('shortcut')).rejects.toThrow('Settings write failed.')

    expect(persistedState).toMatchObject({ status: 'safetyBlocked', pendingOperation: 'pause' })
    expect(controller.chromaShiftState).toMatchObject({
      status: 'safetyBlocked',
      pendingOperation: 'pause'
    })
    expect(operationalOutcomes).toMatchObject([
      {
        status: 'failed',
        source: 'shortcut',
        origin: 'pause',
        failures: [{ operation: 'control', message: 'Settings write failed.' }]
      }
    ])
  })

  it('coalesces repeated pause requests while restoration is running', async () => {
    const activation = new FakeActivation()
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    activation.waitForIdle = async () => {
      activation.calls.push('idle')
      await pending
    }
    const { controller } = create(activation)

    const first = controller.pause('shortcut')
    const second = controller.pause('shortcut')
    release()
    await Promise.all([first, second])

    expect(activation.calls.filter((call) => call === 'restore')).toHaveLength(1)
  })
})

describe('ChromaShiftController resume and intent', () => {
  it('keeps the Intended target Active after one-shot Original settings restoration', async () => {
    const { controller } = create()

    await controller.restoreBaseline()

    expect(controller.chromaShiftState).toMatchObject({
      status: 'active',
      intendedMode: { kind: 'manual', profileId: 'gaming' },
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })
  })

  it('validates topology and resumes the preserved intent from Paused', async () => {
    const { activation, controller, refreshTopology } = create(new FakeActivation(), {
      status: 'paused',
      pendingOperation: null,
      intendedMode: manualActivationMode('gaming'),
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })

    await controller.resume('manual')

    expect(refreshTopology).toHaveBeenCalledOnce()
    expect(activation.calls).toContain('resume')
    expect(controller.chromaShiftState.status).toBe('active')
  })

  it('resumes Paused control for an explicit profile selection', async () => {
    const { activation, controller } = create(new FakeActivation(), {
      status: 'paused',
      pendingOperation: null,
      intendedMode: manualActivationMode('gaming'),
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })

    await controller.selectManualProfile('accurate', 'shortcut')

    expect(activation.calls).toContain('intent:accurate')
    expect(activation.calls).toContain('resume')
    expect(controller.chromaShiftState.status).toBe('active')
  })

  it('updates Intended target during Safety block without applying it', async () => {
    const { activation, controller } = create(new FakeActivation(), {
      status: 'safetyBlocked',
      pendingOperation: 'pause',
      intendedMode: manualActivationMode('gaming'),
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })

    await controller.selectManualProfile('accurate', 'manual')

    expect(activation.calls).toEqual(['intent:accurate'])
    expect(controller.chromaShiftState).toMatchObject({
      status: 'safetyBlocked',
      intendedTarget: { kind: 'profile', profileId: 'accurate' }
    })
  })

  it('preserves the selected Intended target after a failed activation', async () => {
    const activation = new FakeActivation()
    activation.selectOutcome = outcome(
      { kind: 'profile', profileId: 'accurate' },
      {
        status: 'partialFailure',
        failures: [{ operation: 'apply', displayId: 'display:one', message: 'Write failed.' }]
      }
    )
    activation.clearTargetOnSelect = true
    const { controller } = create(activation)

    await controller.selectManualProfile('accurate', 'manual')

    expect(controller.chromaShiftState.intendedTarget).toEqual({
      kind: 'profile',
      profileId: 'accurate'
    })
  })

  it('retries a Resume-origin Safety block as Resume', async () => {
    const activation = new FakeActivation()
    const refreshTopology = vi
      .fn()
      .mockResolvedValueOnce({ baselines: [{ ownership: 'providerChanged' }] })
      .mockResolvedValueOnce({ baselines: [{ ownership: 'owned' }] })
    const controller = new ChromaShiftController(
      activation,
      { refreshTopology },
      { cancel: () => Promise.resolve() },
      {
        status: 'paused',
        intendedMode: manualActivationMode('gaming'),
        intendedTarget: { kind: 'profile', profileId: 'gaming' },
        pendingOperation: null
      },
      () => Promise.resolve(),
      { write: () => undefined }
    )
    const operationalOutcomes: CompletedActivationOutcome[] = []
    controller.subscribeOperationalOutcomes((value) => operationalOutcomes.push(value))

    await expect(controller.resume('shortcut')).rejects.toThrow('baseline ownership changed')
    await controller.retrySafetyCheck('shortcut')

    expect(activation.calls.filter((call) => call === 'resume')).toHaveLength(1)
    expect(activation.calls.filter((call) => call === 'restore')).toHaveLength(0)
    expect(controller.chromaShiftState.status).toBe('active')
    expect(operationalOutcomes).toMatchObject([
      {
        status: 'failed',
        source: 'shortcut',
        origin: 'resume',
        failures: [{ operation: 'control' }]
      },
      {
        status: 'activated',
        source: 'shortcut',
        origin: 'resume',
        failures: []
      }
    ])
  })

  it('updates an unavailable paused target to Automatic without resuming', async () => {
    const { activation, controller } = create(new FakeActivation(), {
      status: 'paused',
      pendingOperation: null,
      intendedMode: manualActivationMode('gaming'),
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })

    await controller.reconcileAutomaticIntent()

    expect(activation.calls).toEqual(['intent:automatic'])
    expect(controller.chromaShiftState).toMatchObject({
      status: 'paused',
      intendedMode: { kind: 'automatic' },
      intendedTarget: null
    })
  })
})
