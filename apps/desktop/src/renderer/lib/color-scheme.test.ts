import { describe, expect, it } from 'vitest'
import { applyColorScheme, initialColorScheme } from '@/lib/color-scheme'

describe('initialColorScheme', () => {
  it('reads the resolved scheme for the app and mini panel URLs', () => {
    expect(initialColorScheme('?theme=dark')).toBe('dark')
    expect(initialColorScheme('?panel=mini&theme=light')).toBe('light')
  })

  it('ignores a missing or unresolved theme', () => {
    expect(initialColorScheme('')).toBeNull()
    expect(initialColorScheme('?panel=mini')).toBeNull()
    expect(initialColorScheme('?theme=system')).toBeNull()
  })
})

describe('applyColorScheme', () => {
  function fakeRoot(initial: string[]): HTMLElement {
    const classes = new Set(initial)
    return {
      classList: {
        toggle: (name: string, force: boolean) => {
          if (force) classes.add(name)
          else classes.delete(name)
          return force
        },
        contains: (name: string) => classes.has(name)
      },
      style: { colorScheme: '' }
    } as unknown as HTMLElement
  }

  it('replaces the opposite class and sets the native color scheme', () => {
    const root = fakeRoot(['light'])

    applyColorScheme(root, 'dark')

    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light')).toBe(false)
    expect(root.style.colorScheme).toBe('dark')
  })
})
