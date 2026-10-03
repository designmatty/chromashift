import { z } from 'zod'

export const releasesApiUrl =
  'https://api.github.com/repos/designmatty/chromashift/releases?per_page=100'
const downloadPrefix = 'https://github.com/designmatty/chromashift/releases/download/'

// SemVer identifiers, including numeric preview suffixes, must not have leading zeroes.
export const versionSchema = z
  .string()
  .max(200)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
  )

export function installerDownloadUrl(version: string): string {
  versionSchema.parse(version)
  return `${downloadPrefix}v${version}/ChromaShift-${version}-x64-setup.exe`
}

export const updateReleaseSchema = z
  .object({
    version: versionSchema,
    downloadUrl: z.string().max(1000)
  })
  .strict()
  .superRefine((release, context) => {
    if (!versionSchema.safeParse(release.version).success) return
    if (release.downloadUrl !== installerDownloadUrl(release.version)) {
      context.addIssue({ code: 'custom', message: 'Unexpected installer download URL.' })
    }
  })

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
