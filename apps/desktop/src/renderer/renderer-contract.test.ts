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

it('delete requests open only the delete confirmation without resolving unsaved changes', () => {
  const sources = import.meta.glob<string>('./app/main-app.tsx', {
    query: '?raw',
    import: 'default',
    eager: true
  })
  const source = sources['./app/main-app.tsx']!
  const request = source.slice(
    source.indexOf('  function requestProfileDeletion('),
    source.indexOf('  function confirmProfileDeletion(')
  )
  expect(request).toContain('setProfilePendingDeletion(profile)')
  expect(request).not.toContain('continueAfterChanges')
  expect(request).not.toContain('rollback')
  expect(request).not.toContain('resetTo')
  expect(source).toContain('onCancel={() => setProfilePendingDeletion(null)}')
})
