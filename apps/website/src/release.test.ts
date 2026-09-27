import { describe, expect, it, vi } from 'vitest'
import { fetchLatestInstaller, releasesApiUrl, selectLatestInstaller } from './release'

const download = 'https://github.com/designmatty/chromashift/releases/download'

function release(tag: string, publishedAt: string, assetNames: string[], draft = false) {
  return {
    draft,
    published_at: publishedAt,
    assets: assetNames.map((name) => ({
      name,
      browser_download_url: `${download}/${tag}/${name}`
    }))
  }
}

describe('selectLatestInstaller', () => {
  it('chooses the newest published release, including prereleases', () => {
    const releases = [
      release('v0.1.0-preview.3', '2026-09-01T00:00:00Z', [
        'ChromaShift-0.1.0-preview.3-x64-setup.exe'
      ]),
      release('v0.1.0-preview.4', '2026-09-20T00:00:00Z', [
        'latest.yml',
        'ChromaShift-0.1.0-preview.4-x64-setup.exe.blockmap',
        'ChromaShift-0.1.0-preview.4-x64-setup.exe'
      ])
    ]

    expect(selectLatestInstaller(releases)).toEqual({
      filename: 'ChromaShift-0.1.0-preview.4-x64-setup.exe',
      url: `${download}/v0.1.0-preview.4/ChromaShift-0.1.0-preview.4-x64-setup.exe`
    })
  })

  it('skips drafts and releases without an x64 installer', () => {
    const releases = [
      release('v0.2.0', '2026-10-01T00:00:00Z', ['ChromaShift-0.2.0-x64-setup.exe'], true),
      release('v0.1.1', '2026-09-25T00:00:00Z', ['notes.txt', 'ChromaShift-0.1.1-arm64-setup.exe']),
      release('v0.1.0', '2026-09-20T00:00:00Z', ['ChromaShift-0.1.0-x64-setup.exe'])
    ]

    expect(selectLatestInstaller(releases)?.filename).toBe('ChromaShift-0.1.0-x64-setup.exe')
  })

  it('ignores download URLs outside the ChromaShift repository', () => {
    const releases = [
      {
        published_at: '2026-09-20T00:00:00Z',
        assets: [
          {
            name: 'ChromaShift-0.1.0-x64-setup.exe',
            browser_download_url: 'https://example.com/ChromaShift-0.1.0-x64-setup.exe'
          }
        ]
      }
    ]

    expect(selectLatestInstaller(releases)).toBeUndefined()
  })

  it('tolerates malformed API payloads', () => {
    expect(selectLatestInstaller({ message: 'Not Found' })).toBeUndefined()
    expect(selectLatestInstaller([null, 'release', { assets: 'none' }])).toBeUndefined()
  })
})

describe('fetchLatestInstaller', () => {
  it('requests the releases API without credentials or a referrer', async () => {
    const fetchImplementation = vi.fn(async () => Response.json([]))

    await fetchLatestInstaller(fetchImplementation)

    expect(fetchImplementation).toHaveBeenCalledWith(releasesApiUrl, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    })
  })

  it('returns nothing when GitHub rejects the request', async () => {
    const fetchImplementation = vi.fn(async () => new Response('', { status: 404 }))

    await expect(fetchLatestInstaller(fetchImplementation)).resolves.toBeUndefined()
  })
})
