import { readFile } from 'node:fs/promises'
import { updateFeedSchema, updateFeedUrl } from '../apps/desktop/src/shared/app-updates.ts'

const currentVersion = JSON.parse(
  await readFile(new globalThis.URL('../package.json', import.meta.url), 'utf8')
).version
const response = await globalThis.fetch(updateFeedUrl, {
  headers: { Accept: 'application/json', 'User-Agent': `ChromaShift/${currentVersion}` },
  credentials: 'omit',
  redirect: 'error',
  signal: globalThis.AbortSignal.timeout(15_000),
  cache: 'no-store'
})
if (!response.ok)
  throw new Error(
    `Public update feed returned HTTP ${response.status}; mitigation=${response.headers.get('cf-mitigated') ?? 'none'}; ray=${response.headers.get('cf-ray') ?? 'unknown'}.`
  )
if (!response.headers.get('content-type')?.startsWith('application/json'))
  throw new Error('The update feed did not return JSON.')
const feed = updateFeedSchema.parse(await response.json())
const expected = updateFeedSchema.parse(
  JSON.parse(
    await readFile(
      new globalThis.URL('../apps/updates/dist/v1/releases.json', import.meta.url),
      'utf8'
    )
  )
)
if (JSON.stringify(feed) !== JSON.stringify(expected))
  throw new Error('The public update feed does not match the generated published releases.')
globalThis.console.log(
  `Public update feed verified: ${feed.releases.map((release) => release.version).join(', ')}`
)
