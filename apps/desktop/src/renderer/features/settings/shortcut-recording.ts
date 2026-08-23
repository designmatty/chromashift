export interface ShortcutKeyEvent {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export type ShortcutRecordingResult =
  | { kind: 'binding'; accelerator: string }
  | { kind: 'cancel' }
  | { kind: 'clear' }
  | { kind: 'pending' }
  | { kind: 'invalid'; message: string }

export function recordShortcut(event: ShortcutKeyEvent): ShortcutRecordingResult {
  if (event.key === 'Escape') return { kind: 'cancel' }
  if (
    (event.key === 'Backspace' || event.key === 'Delete') &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey
  )
    return { kind: 'clear' }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return { kind: 'pending' }

  const modifiers = [
    event.ctrlKey ? 'Control' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    event.metaKey ? 'Super' : null
  ].filter((modifier): modifier is string => modifier !== null)
  if (modifiers.length === 0) {
    return { kind: 'invalid', message: 'Include at least one modifier key.' }
  }

  const key = normalizeRecordedKey(event.key)
  if (key === null)
    return { kind: 'invalid', message: `${event.key} cannot be used in a shortcut.` }
  return { kind: 'binding', accelerator: [...modifiers, key].join('+') }
}

function normalizeRecordedKey(key: string): string | null {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase()
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase()
  const named: Record<string, string> = {
    ' ': 'Space',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    Backspace: 'Backspace',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Home: 'Home',
    Insert: 'Insert',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
    Tab: 'Tab'
  }
  return named[key] ?? null
}
