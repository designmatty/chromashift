import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { PowerEventAdapter, type PowerTransitionEvent } from './power-event-adapter.js'

describe('PowerEventAdapter', () => {
  it('maps Electron power events and removes every listener on dispose', () => {
    const source = new EventEmitter()
    const adapter = new PowerEventAdapter(source)
    const events: PowerTransitionEvent[] = []

    adapter.start((event) => events.push(event))
    source.emit('lock-screen')
    source.emit('unlock-screen')
    source.emit('suspend')
    source.emit('resume')
    adapter.dispose()
    source.emit('resume')

    expect(events).toEqual(['lock', 'unlock', 'suspend', 'resume'])
    expect(source.eventNames()).toEqual([])
  })
})
