import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColorProfile } from '@chromashift/core'
import { PreviewSyncSession, PREVIEW_SYNC_DEBOUNCE_MS } from './preview-sync.js'
import type { PreviewState, ProductError, ProductResult } from '../../../shared/product-api.js'

const profile: ColorProfile = {
  id: 'tarkov-night',
  name: 'Tarkov - Night',
  enabled: true,
  applications: [],
  displays: [{ displayId: 'display:abc', color: { brightness: 84 } }]
}

const inactive: PreviewState = { state: 'inactive' }

function activeSession(
  kind: 'preview' | 'edit' | 'override',
  profileId = profile.id
): PreviewState {
  return { state: 'active', profileId, kind, targets: [] }
}

const ok: ProductResult<null> = { ok: true, value: null }

class FakePort {
  public readonly calls: string[] = []
  public deferStart: (() => void) | undefined
  public startResult: ProductResult<null> = ok

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

  public cancelPreview(): Promise<ProductResult<null>> {
    this.calls.push('cancel')
    return Promise.resolve(ok)
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

  it('starts fresh over a session of a different kind or profile', () => {
    session.schedule(profile, activeSession('preview'))
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    session.schedule(profile, activeSession('edit', 'other-profile'))
    vi.advanceTimersByTime(PREVIEW_SYNC_DEBOUNCE_MS)
    expect(port.calls).toEqual([`start:edit:${profile.id}`, `start:edit:${profile.id}`])
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
})
