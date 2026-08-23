import { describe, expect, it } from 'vitest'
import { recordShortcut } from './shortcut-recording.js'

describe('recordShortcut', () => {
  it('records a modifier and non-modifier key as an Electron accelerator', () => {
    expect(
      recordShortcut({ key: 'd', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false })
    ).toEqual({ kind: 'binding', accelerator: 'Control+Shift+D' })
  })

  it('records Windows and Shift as supported modifiers', () => {
    expect(
      recordShortcut({ key: 'g', ctrlKey: false, altKey: false, shiftKey: false, metaKey: true })
    ).toEqual({ kind: 'binding', accelerator: 'Super+G' })
    expect(
      recordShortcut({ key: 'F9', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false })
    ).toEqual({ kind: 'binding', accelerator: 'Shift+F9' })
  })

  it('waits through modifier-only keydown events and lets Escape cancel recording', () => {
    expect(
      recordShortcut({
        key: 'Control',
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false
      })
    ).toEqual({ kind: 'pending' })
    expect(
      recordShortcut({
        key: 'Escape',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false
      })
    ).toEqual({ kind: 'cancel' })
  })

  it('clears a binding with bare Backspace or Delete', () => {
    expect(
      recordShortcut({
        key: 'Backspace',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false
      })
    ).toEqual({ kind: 'clear' })
    expect(
      recordShortcut({
        key: 'Delete',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false
      })
    ).toEqual({ kind: 'clear' })
  })

  it('rejects a non-modifier key entered without a modifier', () => {
    expect(
      recordShortcut({ key: 'd', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })
    ).toEqual({ kind: 'invalid', message: 'Include at least one modifier key.' })
  })
})
