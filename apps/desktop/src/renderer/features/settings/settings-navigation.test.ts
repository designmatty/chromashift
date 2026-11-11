import { expect, it } from 'vitest'
import { settingsEscapeGoesBack } from '@/features/settings/settings-navigation'

const escape = {
  key: 'Escape',
  defaultPrevented: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false
}
it('backs out only for an unhandled bare Escape outside an input or overlay', () => {
  expect(settingsEscapeGoesBack(escape, false, false)).toBe(true)
  expect(settingsEscapeGoesBack(escape, true, false)).toBe(false)
  expect(settingsEscapeGoesBack(escape, false, true)).toBe(false)
  expect(settingsEscapeGoesBack({ ...escape, defaultPrevented: true }, false, false)).toBe(false)
  expect(settingsEscapeGoesBack({ ...escape, ctrlKey: true }, false, false)).toBe(false)
  expect(settingsEscapeGoesBack({ ...escape, key: 'Enter' }, false, false)).toBe(false)
})
