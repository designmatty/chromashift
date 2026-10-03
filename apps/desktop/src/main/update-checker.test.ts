import { describe, expect, it, vi } from 'vitest'
import { UpdateChecker } from '@main/update-checker.js'
import { installerDownloadUrl, releasesApiUrl } from '@shared/app-updates.js'

function release(version: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes('-'),
    assets: [
      {
        name: `ChromaShift-${version}-x64-setup.exe`,
        state: 'uploaded',
        size: 100,
        browser_download_url: installerDownloadUrl(version)
      }
    ],
    ...extra
  }
}

function harness(
  currentVersion = '0.1.0-preview.8',
  releases: unknown = [release('0.1.0-preview.9')]
) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(releases))
  const checker = new UpdateChecker({ currentVersion, fetch })
  return { checker, fetch }
}

describe('manual update checks', () => {
  it('does not contact GitHub until asked and retains the exact published installer', async () => {
    const h = harness()
    expect(h.checker.getStatus()).toBeNull()
    expect(h.fetch).not.toHaveBeenCalled()
    const result = await h.checker.check()
    expect(result).toEqual({
      checkedAt: expect.any(String),
      release: { version: '0.1.0-preview.9', downloadUrl: installerDownloadUrl('0.1.0-preview.9') }
    })
    expect(Date.parse(result.checkedAt)).not.toBeNaN()
    expect(h.checker.getStatus()).toEqual(result)
    expect(h.fetch).toHaveBeenCalledWith(
      releasesApiUrl,
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ 'User-Agent': 'ChromaShift/0.1.0-preview.8' })
      })
    )
  })

  it.each([
    ['0.1.0-preview.8', ['0.1.0-preview.9', '0.1.0-preview.10'], '0.1.0-preview.10'],
    ['0.1.0-preview.10', ['0.1.0-preview.9', '0.1.0-preview.10'], null],
    ['0.1.0-preview.8', ['0.1.0-preview.9', '0.1.0'], '0.1.0'],
    ['0.1.0', ['0.1.0', '0.2.0-preview.1'], null],
    ['0.1.0', ['0.2.0', '0.3.0-preview.1'], '0.2.0'],
    ['0.1.0-preview.8', ['0.1.0-preview.7'], null],
    ['1.0.0-alpha.1', ['1.0.0-alpha.2', '1.0.0-beta'], '1.0.0-beta'],
    ['1.0.0-alpha', ['1.0.0-alpha.1'], '1.0.0-alpha.1'],
    ['1.0.0-2', ['1.0.0-10', '1.0.0-alpha'], '1.0.0-alpha'],
    ['1.0.0+local', ['1.0.0+remote'], null],
    ['0.9.0', ['0.10.0', '0.9.9'], '0.10.0']
  ])('compares %s against %j on its release channel', async (current, versions, expected) => {
    const h = harness(
      current,
      versions.map((version) => release(version))
    )
    expect((await h.checker.check()).release?.version ?? null).toBe(expected)
  })

  it('ignores drafts, invalid tags, missing installers, and untrusted or mismatched asset URLs', async () => {
    const h = harness('0.1.0-preview.8', [
      release('0.1.0-preview.9'),
      release('0.1.0-preview.10', { draft: true }),
      release('0.1.0-preview.11', { assets: [] }),
      release('0.1.0-preview.12', {
        assets: [
          {
            name: 'ChromaShift-0.1.0-preview.12-x64-setup.exe',
            state: 'uploaded',
            size: 100,
            browser_download_url:
              'https://github.com/attacker/chromashift/releases/download/setup.exe'
          }
        ]
      }),
      release('0.1.0-preview.13', { assets: release('0.1.0-preview.14').assets }),
      release('0.1.0-preview.15', { tag_name: 'v0.1.0-preview.015' }),
      { tag_name: 'v9.0.0' }
    ])
    expect((await h.checker.check()).release?.version).toBe('0.1.0-preview.9')
  })

  it('never reports up to date when release metadata has no valid installer', async () => {
    for (const releases of [[], {}, [release('0.1.0', { assets: [] })]]) {
      const h = harness('0.1.0-preview.8', releases)
      await expect(h.checker.check()).rejects.toThrow(
        /invalid release list|No published installer/u
      )
      expect(h.checker.getStatus()).toBeNull()
    }
  })

  it('coalesces concurrent checks and permits retry after a failure without changing the last success', async () => {
    const h = harness()
    const first = h.checker.check()
    expect(h.checker.check()).toBe(first)
    const successful = await first
    h.fetch.mockResolvedValueOnce(new Response(null, { status: 429 }))
    await expect(h.checker.check()).rejects.toThrow('limiting update checks')
    expect(h.checker.getStatus()).toBe(successful)
    await h.checker.check()
    expect(h.fetch).toHaveBeenCalledTimes(3)
  })

  it.each([403, 429, 404, 500])('reports HTTP %s as a failed check', async (status) => {
    const h = harness()
    h.fetch.mockResolvedValueOnce(new Response(null, { status }))
    await expect(h.checker.check()).rejects.toThrow(/Try again later/u)
    expect(h.checker.getStatus()).toBeNull()
  })

  it('reports offline, invalid JSON, and excessive responses without setting a checked date', async () => {
    const h = harness()
    h.fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(h.checker.check()).rejects.toThrow('Could not reach GitHub')
    h.fetch.mockResolvedValueOnce(new Response('{'))
    await expect(h.checker.check()).rejects.toThrow('invalid release data')
    h.fetch.mockResolvedValueOnce(new Response(' '.repeat(5 * 1024 * 1024 + 1)))
    await expect(h.checker.check()).rejects.toThrow('too much release data')
    expect(h.checker.getStatus()).toBeNull()
  })

  it('bounds the request and response read with a timeout', async () => {
    const checker = new UpdateChecker({
      currentVersion: '0.1.0-preview.8',
      timeoutMilliseconds: 10,
      fetch: async (_input, options) =>
        new Promise<Response>((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason))
        })
    })
    await expect(checker.check()).rejects.toThrow('timed out')
    expect(checker.getStatus()).toBeNull()
  })
})
