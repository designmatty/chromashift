import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import { PreviewSyncSession, PREVIEW_SYNC_DEBOUNCE_MS } from '@/features/profiles/preview-sync.js'
import {
  previewCompareRequestSchema,
  type PreviewState,
  type ProductError,
  type ProductResult
} from '@shared/product-api.js'

const profile: ColorProfile = {
  id: 'tarkov-night',
  name: 'Tarkov - Night',
  enabled: true,
  applications: [],
  displays: [
    {
      displayId: 'display:abc',
      color: { ...createNeutralColorSettings(), brightness: 84 }
    }
  ]
}

const inactive: PreviewState = { state: 'inactive' }

function activeSession(
  kind: 'preview' | 'edit' | 'override',
  profileId = profile.id
): PreviewState {
  return {
    state: 'active',
    sessionId: 1,
    profileId,
    kind,
    targets: [],
    unsavedChanges: kind !== 'preview'
  }
}

const ok: ProductResult<null> = { ok: true, value: null }

class FakePort {
  public readonly calls: string[] = []
  public deferStart: (() => void) | undefined
  public startResult: ProductResult<null> = ok
  public cancelResult: ProductResult<null> = ok

  public startPreview(
    target: ColorProfile,
    kind: 'edit' | 'override'
  ): Promise<ProductResult<null>> {
    this.calls.push(`start:${kind}:${target.id}`)
    if (this.deferStart !== undefined) {
      return new Promise((resolve) => {
        this.deferStart = () => resolve(this.startResult)
      })
    }
    return Promise.resolve(this.startResult)
  }

  public updatePreview(profileId: string): Promise<ProductResult<null>> {
    this.calls.push(`update:${profileId}`)
    return Promise.resolve(ok)
  }

  public setPreviewCompare(
    profileId: string,
    showing: boolean,
    sessionId: number
  ): Promise<ProductResult<null>> {
    previewCompareRequestSchema.parse({ profileId, showing, sessionId })
    this.calls.push(`compare:${profileId}:${showing}`)
    return Promise.resolve(ok)
  }

  public cancelPreview(): Promise<ProductResult<null>> {
    this.calls.push('cancel')
    return Promise.resolve(this.cancelResult)
  }
}

describe('preview sync session', () => {
  let port: FakePort
  let errors: (ProductError | null)[]
  let session: PreviewSyncSession

  beforeEach(() => {
    vi.useFakeTimers()
    port = new FakePort()
    errors = []
    session = new PreviewSyncSession(port, 'edit', (error) => errors.push(error))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts a new session after the debounce window when none of this kind is active', () => {
    session.schedule(profile, inactive)
    expect(port.calls).toEqual([])
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(port.calls).toEqual([`start:edit:${profile.id}`])
  })

  it('updates the existing session of the same kind and profile', () => {
    session.schedule(profile, activeSession('edit'))
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(port.calls).toEqual([`update:${profile.id}`])
  })

  it('starts fresh over a different profile', () => {
    session.schedule(profile, activeSession('edit', 'other-profile'))
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(port.calls).toEqual([`start:edit:${profile.id}`])
  })

  it('promotes unchanged preview targets before sending the edited draft', async () => {
    const preview = {
      ...activeSession('preview'),
      targets: structuredClone(profile.displays)
    } as PreviewState
    const changed = structuredClone(profile)
    changed.displays[0]!.color.brightness = 61
    const start = vi.spyOn(port, 'startPreview')
    session.schedule(changed, preview)
    await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(start).toHaveBeenCalledWith(profile, 'edit')
    expect(port.calls).toEqual([`start:edit:${profile.id}`, `update:${profile.id}`])
  })

  it('does not send edited values after promotion fails', async () => {
    port.startResult = { ok: false, error: { code: 'OPERATION_FAILED', message: 'Blocked' } }
    session.schedule(profile, activeSession('preview'))
    await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(port.calls).toEqual([`start:edit:${profile.id}`])
    expect(errors.at(-1)?.message).toBe('Blocked')
  })

  it('promotes once when another edit arrives with the stale preview snapshot', async () => {
    port.deferStart = () => undefined
    const preview = { ...activeSession('preview'), targets: profile.displays } as PreviewState
    session.schedule(profile, preview)
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    session.schedule(profile, preview)
    await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(port.calls).toEqual([`start:edit:${profile.id}`])
    port.deferStart()
    await vi.runAllTimersAsync()
    expect(port.calls).toEqual([
      `start:edit:${profile.id}`,
      `update:${profile.id}`,
      `update:${profile.id}`
    ])
  })

  it('settles an in-flight send and invalidates a scheduled send before commit', async () => {
    port.deferStart = () => undefined
    session.schedule(profile, inactive)
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    session.schedule(profile, inactive)
    let settled = false
    const settling = session.settle().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(settled).toBe(false)
    port.deferStart()
    await settling
    expect(port.calls).toEqual([`start:edit:${profile.id}`])
  })

  it('coalesces rapid schedules into one send', () => {
    session.schedule(profile, inactive)
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS - 1)
    session.schedule(profile, inactive)
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS - 1)
    expect(port.calls).toEqual([])
    vi.advanceTimersByTime(1)
    expect(port.calls).toEqual([`start:edit:${profile.id}`])
  })

  it('drops a scheduled send after invalidation even if the timer already fired', () => {
    session.schedule(profile, inactive)
    session.invalidate()
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(port.calls).toEqual([])
  })

  it('rollback waits for an in-flight send before cancelling', async () => {
    port.deferStart = () => undefined
    session.schedule(profile, inactive)
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(port.calls).toEqual([`start:edit:${profile.id}`])

    let rolledBack = false
    const rollback = session.rollback().then(() => {
      rolledBack = true
    })
    await Promise.resolve()
    expect(rolledBack).toBe(false)
    expect(port.calls).not.toContain('cancel')

    port.deferStart()
    await rollback
    expect(rolledBack).toBe(true)
    expect(port.calls[port.calls.length - 1]).toBe('cancel')
  })

  it('rollback discards a still-debouncing send entirely', async () => {
    session.schedule(profile, inactive)
    const rollback = session.rollback()
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    await rollback
    expect(port.calls).toEqual(['cancel'])
  })

  it('surfaces failed restoration to the serialized app action even after the session ends', async () => {
    const failure = { code: 'OPERATION_FAILED' as const, message: 'Preview restoration failed.' }
    port.cancelResult = { ok: false, error: failure }
    session.schedule(profile, activeSession('edit'))
    await expect(session.rollback(true)).rejects.toEqual(failure)
    await vi.runAllTimersAsync()
    expect(port.calls).toEqual(['cancel'])
    expect(errors).toEqual([failure])
  })

  it('preserves the mini-panel boolean failure result for a rejected rollback request', async () => {
    port.cancelPreview = () => Promise.reject(new Error('IPC connection failed'))
    expect(await session.rollback()).toBe(false)
    expect(errors).toEqual([{ code: 'OPERATION_FAILED', message: 'IPC connection failed' }])
  })

  it('reports send failures through onError', async () => {
    port.startResult = {
      ok: false,
      error: { code: 'OPERATION_FAILED', message: 'display write failed' }
    }
    session.schedule(profile, inactive)
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    await vi.runAllTimersAsync()
    expect(errors).toEqual([{ code: 'OPERATION_FAILED', message: 'display write failed' }])
  })

  it('sends an override start when constructed for overrides', () => {
    const overrideSession = new PreviewSyncSession(port, 'override', () => undefined)
    overrideSession.schedule(profile, inactive)
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(port.calls).toEqual([`start:override:${profile.id}`])
  })

  it('drops a new draft invalidated while it is waiting for rollback', async () => {
    let releaseCancel!: () => void
    port.cancelPreview = () => {
      port.calls.push('cancel')
      return new Promise((resolve) => {
        releaseCancel = () => resolve(ok)
      })
    }
    const rollback = session.rollback()
    session.schedule(profile, activeSession('edit'))
    await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    session.invalidate()
    releaseCancel()
    await rollback
    await vi.runAllTimersAsync()
    expect(port.calls).toEqual(['cancel'])
  })

  it('does not start a new preview when the rollback it is waiting for fails', async () => {
    port.cancelResult = {
      ok: false,
      error: { code: 'OPERATION_FAILED', message: 'restoration failed' }
    }
    const rollback = session.rollback()
    session.schedule(profile, activeSession('edit'))
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    await rollback
    await vi.runAllTimersAsync()
    expect(port.calls).toEqual(['cancel'])
    expect(errors).toEqual([{ code: 'OPERATION_FAILED', message: 'restoration failed' }])
  })

  it('clears a previous synchronization error after a successful send', async () => {
    port.startResult = {
      ok: false,
      error: { code: 'OPERATION_FAILED', message: 'No preview is active.' }
    }
    session.schedule(profile, inactive)
    await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    port.startResult = ok
    session.schedule(profile, inactive)
    await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(errors.at(-1)).toBe(null)
  })

  describe('hold to compare (#80)', () => {
    it.each(['edit', 'override'] as const)(
      'compares a joined %s without sending saved targets as a draft',
      async (kind) => {
        const compare = vi.spyOn(port, 'setPreviewCompare')
        const update = vi.spyOn(port, 'updatePreview')
        const release = session.beginComparison(profile, activeSession(kind))!
        await release()
        expect(compare.mock.calls).toEqual([
          [profile.id, true, 1],
          [profile.id, false, 1]
        ])
        for (const [profileId, showing, sessionId] of compare.mock.calls) {
          expect(
            previewCompareRequestSchema.safeParse({ profileId, showing, sessionId }).success
          ).toBe(true)
        }
        expect(update).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
      }
    )

    it('sends a pending draft first, then compares and releases in order', async () => {
      session.schedule(profile, activeSession('edit'))
      const release = session.beginComparison(profile, activeSession('edit'))!
      await release()
      expect(port.calls).toEqual([
        `update:${profile.id}`,
        `compare:${profile.id}:true`,
        `compare:${profile.id}:false`
      ])
      expect(vi.getTimerCount()).toBe(0)
    })

    it('does not create a session on press', () => {
      expect(session.beginComparison(profile, inactive)).toBeNull()
      expect(port.calls).toEqual([])
    })

    it('drains an in-flight comparison but drops its release after invalidation', async () => {
      let finish!: () => void
      const compare = vi.spyOn(port, 'setPreviewCompare').mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () => resolve(ok)
          })
      )
      const release = session.beginComparison(profile, activeSession('edit'))!
      const restoring = release()
      await vi.advanceTimersByTimeAsync(0)
      expect(compare).toHaveBeenCalledTimes(1)
      session.invalidate()
      finish()
      await restoring
      expect(compare).toHaveBeenCalledTimes(1)
      expect(port.calls).toEqual([])
    })

    it('returns no release and writes nothing while a rollback owns the session', async () => {
      let finishCancel!: () => void
      vi.spyOn(port, 'cancelPreview').mockImplementationOnce(
        () => new Promise((resolve) => (finishCancel = () => resolve(ok)))
      )
      const rollback = session.rollback()
      await Promise.resolve()
      expect(session.beginComparison(profile, activeSession('edit'))).toBeNull()
      await vi.advanceTimersByTimeAsync(0)
      finishCancel()
      await rollback
      expect(port.calls).toEqual([])
    })

    it('returns no release and writes nothing once the panel opening is revoked', async () => {
      const revoked = new PreviewSyncSession(
        Object.assign(port, { getPanelLifetime: () => null }),
        'edit',
        () => undefined
      )
      revoked.schedule(profile, activeSession('edit'))
      expect(revoked.beginComparison(profile, activeSession('edit'))).toBeNull()
      await vi.advanceTimersByTimeAsync(PREVIEW_SYNC_DEBOUNCE_MS)
      expect(port.calls).toEqual([])
    })
  })
})
