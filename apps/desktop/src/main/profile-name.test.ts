import { expect, it } from 'vitest'
import { nextProfileName } from '@main/profile-name.js'

it('numbers new profiles and uses the first free number', () => {
  expect(nextProfileName('New profile', [])).toBe('New profile')
  expect(nextProfileName('New profile', ['New profile'])).toBe('New profile 2')
  expect(nextProfileName('New profile', ['New profile', 'New profile 2', 'New profile 4'])).toBe(
    'New profile 3'
  )
})

it('numbers clones, including clones of numbered names, without Copy suffixes', () => {
  expect(nextProfileName('Tarkov - Day', ['Tarkov - Day'])).toBe('Tarkov - Day 2')
  expect(nextProfileName('Tarkov - Day 2', ['Tarkov - Day', 'Tarkov - Day 2'])).toBe(
    'Tarkov - Day 3'
  )
  expect(nextProfileName('Game', ['GAME', 'game 2'])).toBe('Game 3')
})

it('leaves room for the suffix within the profile name limit', () => {
  const base = 'a'.repeat(100)
  expect(nextProfileName(base, [base])).toBe(`${'a'.repeat(98)} 2`)
})
