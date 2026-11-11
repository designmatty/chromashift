import type { ExternalLink } from '@shared/product-api.js'

/** Only these fixed destinations may leave the sandboxed renderer. */
const externalLinks: Record<ExternalLink, string> = {
  website: 'https://chromashift.io',
  releases: 'https://github.com/designmatty/chromashift/releases',
  repository: 'https://github.com/designmatty/chromashift',
  license: 'https://github.com/designmatty/chromashift/blob/main/LICENSE'
}

export async function openExternalLink(
  link: string,
  open: (url: string) => Promise<unknown>
): Promise<void> {
  if (!Object.hasOwn(externalLinks, link)) throw new Error('This external link is not allowed.')
  await open(externalLinks[link as ExternalLink])
}
