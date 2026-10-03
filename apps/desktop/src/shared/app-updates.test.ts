import { describe, expect, it } from 'vitest'
import { installerDownloadUrl, updateReleaseSchema, versionSchema } from '@shared/app-updates.js'

describe('update response validation', () => {
  it.each(['01.0.0', '1.0.0-preview.01', '../setup', '1.0.0/', '1.0.0-'])(
    'rejects invalid version %s without throwing from safeParse',
    (version) => {
      expect(versionSchema.safeParse(version).success).toBe(false)
      expect(
        updateReleaseSchema.safeParse({ version, downloadUrl: 'https://attacker.example' }).success
      ).toBe(false)
    }
  )

  it('accepts the exact installer URL and rejects redirects, credentials, fragments, and other repositories', () => {
    const version = '0.1.0-preview.9'
    const downloadUrl = installerDownloadUrl(version)
    expect(updateReleaseSchema.safeParse({ version, downloadUrl }).success).toBe(true)
    for (const url of [
      downloadUrl.replace('github.com/', 'github.com.attacker.example/'),
      downloadUrl.replace('designmatty/', 'attacker/'),
      downloadUrl.replace('github.com/', 'user@github.com/'),
      `${downloadUrl}?redirect=https://attacker.example`,
      `${downloadUrl}#fragment`,
      downloadUrl.replace('https:', 'http:')
    ]) {
      expect(updateReleaseSchema.safeParse({ version, downloadUrl: url }).success).toBe(false)
    }
  })
})
