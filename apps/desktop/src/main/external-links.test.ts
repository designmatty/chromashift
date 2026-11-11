import { expect, it, vi } from 'vitest'
import { openExternalLink } from '@main/external-links.js'

it.each([
  ['releases', 'https://github.com/designmatty/chromashift/releases'],
  ['repository', 'https://github.com/designmatty/chromashift'],
  ['license', 'https://github.com/designmatty/chromashift/blob/main/LICENSE']
])('opens only the fixed %s URL', async (link, url) => {
  const open = vi.fn(async () => undefined)
  await openExternalLink(link!, open)
  expect(open).toHaveBeenCalledExactlyOnceWith(url)
})

it.each([
  'https://example.com',
  'https://github.com/designmatty/chromashift?redirect=evil',
  'http://github.com/designmatty/chromashift',
  'file:///C:/Windows',
  'javascript:alert(1)',
  '__proto__',
  'constructor',
  'toString',
  'RELEASES',
  'releases/../evil'
])('rejects %s without opening the browser', async (link) => {
  const open = vi.fn(async () => undefined)
  await expect(openExternalLink(link, open)).rejects.toThrow('not allowed')
  expect(open).not.toHaveBeenCalled()
})
