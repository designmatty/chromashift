import { pathToFileURL } from 'node:url'

export function isTrustedRendererUrl(
  senderUrl: string,
  productionIndexPath: string,
  developmentUrl?: string
): boolean {
  try {
    const actual = new URL(senderUrl)
    if (developmentUrl !== undefined) return actual.origin === new URL(developmentUrl).origin
    const expected = new URL(pathToFileURL(productionIndexPath).toString())
    return actual.protocol === expected.protocol && actual.pathname === expected.pathname
  } catch {
    return false
  }
}

export function isSameDocumentNavigation(currentUrl: string, targetUrl: string): boolean {
  return currentUrl === targetUrl
}
