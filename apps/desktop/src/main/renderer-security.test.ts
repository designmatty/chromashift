import { describe, expect, it } from 'vitest'
import { isSameDocumentNavigation, isTrustedRendererUrl } from './renderer-security.js'

describe('renderer security policy', () => {
  it('accepts only the exact packaged renderer file', () => {
    const indexPath =
      'C:\\Program Files\\ChromaShift\\resources\\app.asar\\out\\renderer\\index.html'

    expect(
      isTrustedRendererUrl(
        'file:///C:/Program%20Files/ChromaShift/resources/app.asar/out/renderer/index.html',
        indexPath
      )
    ).toBe(true)
    expect(
      isTrustedRendererUrl(
        'file:///C:/Program%20Files/ChromaShift/resources/app.asar/out/renderer/other.html',
        indexPath
      )
    ).toBe(false)
    expect(isTrustedRendererUrl('https://example.com/index.html', indexPath)).toBe(false)
  })

  it('accepts the configured development origin without trusting another port', () => {
    expect(
      isTrustedRendererUrl(
        'http://127.0.0.1:5173/?panel=mini',
        'C:\\unused\\index.html',
        'http://127.0.0.1:5173/'
      )
    ).toBe(true)
    expect(
      isTrustedRendererUrl(
        'http://127.0.0.1:5174/',
        'C:\\unused\\index.html',
        'http://127.0.0.1:5173/'
      )
    ).toBe(false)
  })

  it('allows no cross-document renderer navigation', () => {
    expect(isSameDocumentNavigation('file:///app/index.html', 'file:///app/index.html')).toBe(true)
    expect(isSameDocumentNavigation('file:///app/index.html', 'https://example.com/')).toBe(false)
  })
})
