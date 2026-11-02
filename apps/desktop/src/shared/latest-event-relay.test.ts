import { describe, expect, it, vi } from 'vitest'
import { LatestEventRelay } from '@shared/latest-event-relay.js'

describe('LatestEventRelay', () => {
  it('delivers a request published before the renderer subscribes', () => {
    const relay = new LatestEventRelay<string>()
    relay.publish('settings')
    const listener = vi.fn()

    relay.subscribe(listener)

    expect(listener).toHaveBeenCalledExactlyOnceWith('settings')
  })

  it('keeps only the latest unsubscribed request', () => {
    const relay = new LatestEventRelay<string>()
    relay.publish('about')
    relay.publish('settings')
    const listener = vi.fn()

    relay.subscribe(listener)

    expect(listener).toHaveBeenCalledExactlyOnceWith('settings')
  })

  it('does not replay a delivered request to a replacement listener', () => {
    const relay = new LatestEventRelay<string>()
    relay.publish('settings')
    relay.subscribe(vi.fn())
    const replacement = vi.fn()

    relay.subscribe(replacement)

    expect(replacement).not.toHaveBeenCalled()
  })

  it('forwards later requests directly to the current listener only', () => {
    const relay = new LatestEventRelay<string>()
    const first = vi.fn()
    const second = vi.fn()
    relay.subscribe(first)
    relay.subscribe(second)

    relay.publish('profiles')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledExactlyOnceWith('profiles')
  })
})
