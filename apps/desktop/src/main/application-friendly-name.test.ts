import { describe, expect, it } from 'vitest'
import { applicationFriendlyName } from './application-friendly-name.js'

describe('applicationFriendlyName', () => {
  it('uses the application suffix from a document-style window title', () => {
    expect(
      applicationFriendlyName(
        'ChromaShift - Figma - Brave',
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
      )
    ).toBe('Brave')
  })

  it.each([
    ['ChromaShift – Figma – Brave', 'Brave'],
    ['Document — Visual Studio Code', 'Visual Studio Code'],
    ['Settings', 'Settings']
  ])('normalizes %s to %s', (title, expected) => {
    expect(applicationFriendlyName(title, 'C:\\Apps\\example.exe')).toBe(expected)
  })

  it('falls back to the executable filename when the title is blank', () => {
    expect(applicationFriendlyName('  ', 'C:\\Windows\\notepad.exe')).toBe('notepad')
  })
})
