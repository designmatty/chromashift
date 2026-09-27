export const siteOrigin = 'https://chromashift.io'
export const productionBranch = 'main'

export type DeploymentChannel = 'production' | 'preview'

export interface Deployment {
  channel: DeploymentChannel
  analyticsToken: string | undefined
}

type Environment = Readonly<Record<string, string | undefined>>

const analyticsTokenPattern = /^[A-Za-z0-9]{16,64}$/

/**
 * Cloudflare Workers Builds sets WORKERS_CI and WORKERS_CI_BRANCH. Any other
 * branch is a preview. Local builds are production-shaped but carry analytics
 * only when a token is supplied explicitly.
 */
export function resolveDeployment(environment: Environment): Deployment {
  const channel: DeploymentChannel =
    environment.WORKERS_CI === '1' && environment.WORKERS_CI_BRANCH !== productionBranch
      ? 'preview'
      : 'production'
  const token = environment.CLOUDFLARE_WEB_ANALYTICS_TOKEN?.trim() || undefined
  if (token !== undefined && !analyticsTokenPattern.test(token)) {
    throw new Error('CLOUDFLARE_WEB_ANALYTICS_TOKEN is not a Cloudflare Web Analytics site token.')
  }
  return { channel, analyticsToken: channel === 'production' ? token : undefined }
}

/** Cloudflare Web Analytics beacon: aggregate and cookie-free, with no custom events. */
export function analyticsBeaconAttributes(token: string): Record<string, string | boolean> {
  return {
    defer: true,
    src: 'https://static.cloudflareinsights.com/beacon.min.js',
    'data-cf-beacon': JSON.stringify({ token })
  }
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "connect-src 'self' https://api.github.com https://cloudflareinsights.com",
  "img-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests'
].join('; ')

/** Workers Static Assets `_headers` rules for the built site. */
export function headersFile(channel: DeploymentChannel): string {
  const siteHeaders = [
    `Content-Security-Policy: ${contentSecurityPolicy}`,
    'Referrer-Policy: strict-origin-when-cross-origin',
    'X-Content-Type-Options: nosniff',
    'Cross-Origin-Opener-Policy: same-origin',
    'Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()'
  ]
  if (channel === 'preview') siteHeaders.push('X-Robots-Tag: noindex')

  return [
    '/*',
    ...siteHeaders.map((header) => `  ${header}`),
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    ''
  ].join('\n')
}
