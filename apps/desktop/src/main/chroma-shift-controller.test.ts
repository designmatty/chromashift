import { manualActivationMode, type ActivationMode, type ActivationTarget } from '@chromashift/core'
import { describe, expect, it, vi } from 'vitest'
import type { CompletedActivationOutcome } from '@main/automatic-activation-controller.js'
import {
  ChromaShiftController,
  type ChromaShiftActivationPort,
  type ChromaShiftPersistedState
} from '@main/chroma-shift-controller.js'

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
  public readonly restoreContexts: Array<
    Parameters<ChromaShiftActivationPort['restoreBaseline']>[0]
  > = []

  public restoreBaseline(
    context?: Parameters<ChromaShiftActivationPort['restoreBaseline']>[0]
  ): Promise<CompletedActivationOutcome> {
    this.calls.push('restore')
    this.restoreContexts.push(context)
    return Promise.resolve({ ...this.restoreOutcome, ...context })
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

  it.each(['pause', 'restoreBaseline'] as const)(
    'fails closed when %s preview teardown cannot confirm rollback',
    async (operation) => {
      const { controller, cancelPreview } = create()
      const operationalOutcomes: CompletedActivationOutcome[] = []
      controller.subscribeOperationalOutcomes((value) => operationalOutcomes.push(value))
      cancelPreview.mockRejectedValueOnce(new Error('Preview restore failed.'))

      await expect(controller[operation]('manual')).rejects.toThrow('Preview restore failed.')

      expect(controller.chromaShiftState.status).toBe('safetyBlocked')
      expect(operationalOutcomes).toMatchObject([
        {
          status: 'failed',
          origin: operation === 'pause' ? 'pause' : 'originalSettingsRestore',
          failures: [{ operation: 'control', message: 'Preview restore failed.' }]
        }
      ])
    }
  )

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
  it.each(['manual', 'automatic'] as const)(
    'keeps a newer Active %s selection instead of the stale emergency snapshot',
    async (selection) => {
      const { controller, activation, persisted } = create()
      const snapshot = controller.chromaShiftState
      if (selection === 'manual') {
        await controller.selectManualProfile('accurate')
      } else {
        activation.enableAutomatic = async () => {
          activation.state = {
            ...activation.state,
            mode: { kind: 'automatic' },
            currentTarget: { kind: 'profile', profileId: 'gaming' }
          }
          return outcome()
        }
        await controller.enableAutomatic()
      }
      const newer = controller.chromaShiftState
      await controller.restoreBaseline('shortcut', snapshot)
      expect(persisted.at(-1)).toMatchObject({
        status: 'paused',
        intendedMode: newer.intendedMode,
        intendedTarget: newer.intendedTarget
      })
    }
  )

  it('keeps a newer Automatic target when the mode matches the emergency snapshot', async () => {
    const { controller, activation, persisted } = create(new FakeActivation(), {
      status: 'active',
      pendingOperation: null,
      intendedMode: { kind: 'automatic' },
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })
    const snapshot = controller.chromaShiftState
    activation.state = { ...activation.state, mode: { kind: 'automatic' } }
    await controller.recordCompletedOutcome(outcome({ kind: 'profile', profileId: 'accurate' }))
    await controller.restoreBaseline('shortcut', snapshot)
    expect(persisted.at(-1)).toMatchObject({
      status: 'paused',
      intendedMode: { kind: 'automatic' },
      intendedTarget: { kind: 'profile', profileId: 'accurate' }
    })
  })

  it('pauses after Original settings restoration and preserves the Intended target', async () => {
    const { activation, controller, persisted, cancelPreview } = create()
    const operationalOutcomes: CompletedActivationOutcome[] = []
    controller.subscribeOperationalOutcomes((value) => operationalOutcomes.push(value))

    await controller.restoreBaseline()

    expect(persisted[0]).toMatchObject({ status: 'safetyBlocked', pendingOperation: 'pause' })
    expect(cancelPreview).toHaveBeenCalledOnce()
    expect(activation.calls).toEqual(['suspend', 'idle', 'restore'])
    expect(activation.restoreContexts).toEqual([
      { source: 'manual', origin: 'originalSettingsRestore' }
    ])
    expect(controller.chromaShiftState).toMatchObject({
      status: 'paused',
      pendingOperation: null,
      transitionInProgress: false,
      intendedMode: { kind: 'manual', profileId: 'gaming' },
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })
    expect(persisted.at(-1)).toMatchObject({ status: 'paused', pendingOperation: null })
    expect(operationalOutcomes).toHaveLength(1)
    expect(operationalOutcomes[0]).toMatchObject({
      status: 'activated',
      origin: 'originalSettingsRestore',
      source: 'manual'
    })
  })

  it('pauses with the intent captured before an external emergency restore', async () => {
    const activation = new FakeActivation()
    activation.state = {
      ...activation.state,
      mode: manualActivationMode('gaming'),
      currentTarget: { kind: 'baseline' }
    }
    const { controller, persisted } = create(activation)

    await controller.restoreBaseline('shortcut', {
      intendedMode: manualActivationMode('gaming'),
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })

    expect(activation.calls).toEqual(['suspend', 'idle', 'restore'])
    expect(persisted.at(-1)).toEqual({
      status: 'paused',
      pendingOperation: null,
      intendedMode: manualActivationMode('gaming'),
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })
  })

  it.each([
    { status: 'failed' as const },
    { status: 'partialFailure' as const },
    { deferredDisplayIds: ['display:one'] }
  ])('fails closed when Original settings restoration is incomplete: %j', async (incomplete) => {
    const { activation, controller, persisted } = create()
    activation.restoreOutcome = outcome({ kind: 'baseline' }, incomplete)

    await controller.restoreBaseline('shortcut')

    expect(controller.chromaShiftState).toMatchObject({
      status: 'safetyBlocked',
      pendingOperation: 'pause'
    })
    expect(persisted.at(-1)).toMatchObject({ status: 'safetyBlocked', pendingOperation: 'pause' })

    activation.restoreOutcome = outcome({ kind: 'baseline' })
    await controller.retrySafetyCheck('manual')
    expect(controller.chromaShiftState.status).toBe('paused')
  })

  it('reports a thrown Original settings restoration with its own origin and fails closed', async () => {
    const { activation, controller } = create()
    activation.restoreBaseline = () => Promise.reject(new Error('Restore failed.'))
    const operationalOutcomes: CompletedActivationOutcome[] = []
    controller.subscribeOperationalOutcomes((value) => operationalOutcomes.push(value))

    await expect(controller.restoreBaseline()).rejects.toThrow('Restore failed.')

    expect(controller.chromaShiftState).toMatchObject({
      status: 'safetyBlocked',
      pendingOperation: 'pause'
    })
    expect(operationalOutcomes).toMatchObject([
      {
        status: 'failed',
        origin: 'originalSettingsRestore',
        failures: [{ operation: 'control', message: 'Restore failed.' }]
      }
    ])
  })

  it.each([
    ['paused', null],
    ['safetyBlocked', 'pause'],
    ['safetyBlocked', 'resume']
  ] as const)(
    'leaves %s (%s) display control unchanged on Original settings restoration',
    async (status, pendingOperation) => {
      const initial: ChromaShiftPersistedState = {
        status,
        pendingOperation,
        intendedMode: manualActivationMode('gaming'),
        intendedTarget: { kind: 'profile', profileId: 'gaming' }
      }
      const { activation, controller, persisted, cancelPreview } = create(
        new FakeActivation(),
        initial
      )

      const result = await controller.restoreBaseline()

      expect(result).toMatchObject({ status: 'skipped', origin: 'statusControl' })
      expect(activation.calls).toEqual([])
      expect(cancelPreview).not.toHaveBeenCalled()
      expect(persisted).toEqual([])
      expect(controller.chromaShiftState).toMatchObject(initial)
    }
  )

  it('waits for an in-flight resume before restoring and pausing', async () => {
    const activation = new FakeActivation()
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const resume = activation.resumeCurrent.bind(activation)
    activation.resumeCurrent = async (application, context) => {
      await pending
      return resume(application, context)
    }
    const { controller } = create(activation, {
      status: 'paused',
      pendingOperation: null,
      intendedMode: manualActivationMode('gaming'),
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })

    const resuming = controller.resume('manual')
    const restoring = controller.restoreBaseline()
    release()
    await Promise.all([resuming, restoring])

    expect(activation.calls.slice(-4)).toEqual(['resume', 'suspend', 'idle', 'restore'])
    expect(controller.chromaShiftState.status).toBe('paused')
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

  it.each(['manual', 'shortcut'] as const)(
    'keeps display control Paused for an explicit %s profile selection',
    async (source) => {
      const { activation, controller, persisted, refreshTopology } = create(new FakeActivation(), {
        status: 'paused',
        pendingOperation: null,
        intendedMode: manualActivationMode('gaming'),
        intendedTarget: { kind: 'profile', profileId: 'gaming' }
      })

      const result = await controller.selectManualProfile('accurate', source)

      expect(activation.calls).toEqual(['intent:accurate'])
      expect(refreshTopology).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        status: 'skipped',
        source,
        origin: 'statusControl',
        resolution: { target: { kind: 'profile', profileId: 'accurate' } }
      })
      expect(controller.chromaShiftState).toMatchObject({
        status: 'paused',
        pendingOperation: null,
        transitionInProgress: false
      })
      expect(persisted.at(-1)).toEqual({
        status: 'paused',
        pendingOperation: null,
        intendedMode: manualActivationMode('accurate'),
        intendedTarget: { kind: 'profile', profileId: 'accurate' }
      })
    }
  )

  it.each(['manual', 'shortcut'] as const)(
    'keeps display control Paused for %s Automatic selection',
    async (source) => {
      const { activation, controller, persisted } = create(new FakeActivation(), {
        status: 'paused',
        pendingOperation: null,
        intendedMode: manualActivationMode('gaming'),
        intendedTarget: { kind: 'profile', profileId: 'gaming' }
      })

      const result = await controller.enableAutomatic(source)

      expect(activation.calls).toEqual(['intent:automatic'])
      expect(controller.chromaShiftState.status).toBe('paused')
      expect(result).toMatchObject({ status: 'skipped', source, origin: 'statusControl' })
      expect(persisted.at(-1)).toEqual({
        status: 'paused',
        pendingOperation: null,
        intendedMode: { kind: 'automatic' },
        intendedTarget: null
      })
    }
  )

  it('resumes the selection made while Paused', async () => {
    const { activation, controller } = create(new FakeActivation(), {
      status: 'paused',
      pendingOperation: null,
      intendedMode: manualActivationMode('gaming'),
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })

    await controller.selectManualProfile('accurate', 'manual')
    await controller.resume('manual')

    expect(activation.calls).toEqual(['intent:accurate', 'intent:accurate', 'resume'])
    expect(controller.chromaShiftState).toMatchObject({
      status: 'active',
      intendedTarget: { kind: 'profile', profileId: 'accurate' }
    })
  })

  it('updates Intended target during Safety block without applying it', async () => {
    const { activation, controller, persisted } = create(new FakeActivation(), {
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
    expect(persisted.at(-1)).toMatchObject({
      status: 'safetyBlocked',
      pendingOperation: 'pause',
      intendedMode: manualActivationMode('accurate'),
      intendedTarget: { kind: 'profile', profileId: 'accurate' }
    })
  })

  it('updates Automatic intent during Safety block without bypassing it', async () => {
    const { activation, controller, refreshTopology, persisted } = create(new FakeActivation(), {
      status: 'safetyBlocked',
      pendingOperation: 'resume',
      intendedMode: manualActivationMode('gaming'),
      intendedTarget: { kind: 'profile', profileId: 'gaming' }
    })

    await controller.enableAutomatic('shortcut')

    expect(activation.calls).toEqual(['intent:automatic'])
    expect(refreshTopology).not.toHaveBeenCalled()
    expect(controller.chromaShiftState).toMatchObject({
      status: 'safetyBlocked',
      pendingOperation: 'resume',
      intendedMode: { kind: 'automatic' },
      intendedTarget: null
    })
    expect(persisted.at(-1)).toMatchObject({
      status: 'safetyBlocked',
      pendingOperation: 'resume',
      intendedMode: { kind: 'automatic' },
      intendedTarget: null
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
