import { describe, expect, it } from 'vitest'
import { analyticsBeaconAttributes, headersFile, resolveDeployment } from './deployment'

const token = '0123456789abcdef0123456789abcdef'

describe('resolveDeployment', () => {
  it('treats local builds as production without analytics', () => {
    expect(resolveDeployment({})).toEqual({ channel: 'production', analyticsToken: undefined })
  })

  it('enables analytics for the main branch build', () => {
    expect(
      resolveDeployment({
        WORKERS_CI: '1',
        WORKERS_CI_BRANCH: 'main',
        CLOUDFLARE_WEB_ANALYTICS_TOKEN: ` ${token} `
      })
    ).toEqual({ channel: 'production', analyticsToken: token })
  })

  it('keeps branch previews out of analytics', () => {
    expect(
      resolveDeployment({
        WORKERS_CI: '1',
        WORKERS_CI_BRANCH: 'feature/website',
        CLOUDFLARE_WEB_ANALYTICS_TOKEN: token
      })
    ).toEqual({ channel: 'preview', analyticsToken: undefined })
  })

  it('rejects a malformed token instead of injecting it into HTML', () => {
    expect(() =>
      resolveDeployment({ CLOUDFLARE_WEB_ANALYTICS_TOKEN: '"><script>alert(1)</script>' })
    ).toThrow(/not a Cloudflare Web Analytics site token/)
  })
})

describe('analyticsBeaconAttributes', () => {
  it('loads only the Cloudflare beacon with the site token', () => {
    expect(analyticsBeaconAttributes(token)).toEqual({
      defer: true,
      src: 'https://static.cloudflareinsights.com/beacon.min.js',
      'data-cf-beacon': `{"token":"${token}"}`
    })
  })
})

describe('headersFile', () => {
  it('allows the beacon and release lookup through the content security policy', () => {
    const headers = headersFile('production')
    expect(headers).toContain("script-src 'self' https://static.cloudflareinsights.com")
    expect(headers).toContain(
      "connect-src 'self' https://api.github.com https://cloudflareinsights.com"
    )
    expect(headers).not.toContain('X-Robots-Tag')
  })

  it('marks previews as not indexable', () => {
    expect(headersFile('preview')).toContain('X-Robots-Tag: noindex')
  })

  it('caches fingerprinted build assets immutably', () => {
    expect(headersFile('production')).toMatch(
      /\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/
    )
  })
})
