import { expect, it } from 'vitest'

it('uses renderer dialogs instead of native confirmation prompts', () => {
  const sources = import.meta.glob<string>('./**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true
  })
  const violations = Object.entries(sources)
    .filter(([, source]) => /\bconfirm\s*\(/.test(source))
    .map(([path]) => path)
  expect(violations).toEqual([])
})
