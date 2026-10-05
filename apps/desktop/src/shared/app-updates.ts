import { z } from 'zod'

export const updateFeedUrl = 'https://updates.chromashift.io/v1/releases.json'
export const updateRepositoryId = 1328081965
export const repositoryNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/u)
  .refine((name) => !['.', '..'].includes(name.split('/')[1]!))

// SemVer identifiers, including numeric preview suffixes, must not have leading zeroes.
export const versionSchema = z
  .string()
  .max(200)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
  )

export function installerDownloadUrl(
  version: string,
  repository = 'designmatty/chromashift'
): string {
  versionSchema.parse(version)
  repositoryNameSchema.parse(repository)
  return `https://github.com/${repository}/releases/download/v${version}/ChromaShift-${version}-x64-setup.exe`
}

export const updateReleaseSchema = z
  .object({
    version: versionSchema,
    downloadUrl: z.string().max(1000)
  })
  .strict()
  .superRefine((release, context) => {
    if (!versionSchema.safeParse(release.version).success) return
    const repository = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\//u.exec(
      release.downloadUrl
    )?.[1]
    if (
      !repositoryNameSchema.safeParse(repository).success ||
      release.downloadUrl !== installerDownloadUrl(release.version, repository)
    ) {
      context.addIssue({ code: 'custom', message: 'Unexpected installer download URL.' })
    }
  })

/** Repository identity and canonical location are supplied by our fixed HTTPS feed. */
export const updateFeedSchema = z
  .object({
    schemaVersion: z.literal(1),
    repository: z
      .object({ id: z.literal(updateRepositoryId), fullName: repositoryNameSchema })
      .strict(),
    releases: z.array(updateReleaseSchema.safeExtend({ prerelease: z.boolean() })).max(2)
  })
  .strict()
  .superRefine((feed, context) => {
    if (!repositoryNameSchema.safeParse(feed.repository.fullName).success) return
    for (const release of feed.releases) {
      if (!versionSchema.safeParse(release.version).success) continue
      if (release.downloadUrl !== installerDownloadUrl(release.version, feed.repository.fullName)) {
        context.addIssue({
          code: 'custom',
          message: 'Installer does not belong to the update repository.'
        })
      }
    }
  })

/** SemVer comparison; build metadata does not affect precedence. */
export function compareUpdateVersions(left: string, right: string): number {
  const parts = (version: string) => {
    const [core, ...prerelease] = version.split('+')[0]!.split('-')
    return { core: core!.split('.').map(BigInt), prerelease: prerelease.join('-').split('.') }
  }
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < 3; index++) {
    if (a.core[index]! > b.core[index]!) return 1
    if (a.core[index]! < b.core[index]!) return -1
  }
  if (a.prerelease[0] === '') return b.prerelease[0] === '' ? 0 : 1
  if (b.prerelease[0] === '') return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const numericX = /^\d+$/u.test(x)
    const numericY = /^\d+$/u.test(y)
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1
    if (numericX !== numericY) return numericX ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

export const updateCheckSchema = z
  .object({
    checkedAt: z.iso.datetime(),
    release: updateReleaseSchema.nullable()
  })
  .strict()

export type UpdateRelease = z.infer<typeof updateReleaseSchema>
export type UpdateCheck = z.infer<typeof updateCheckSchema>

export const appUpdateStatusSchema = z
  .object({
    phase: z.enum([
      'idle',
      'checking',
      'up-to-date',
      'available',
      'downloading',
      'ready',
      'installing',
      'error'
    ]),
    checkedAt: z.iso.datetime().nullable(),
    release: updateReleaseSchema.nullable(),
    percent: z.number().min(0).max(100).nullable(),
    error: z.string().max(1000).nullable(),
    installationSupported: z.boolean()
  })
  .strict()

export type AppUpdateStatus = z.infer<typeof appUpdateStatusSchema>
