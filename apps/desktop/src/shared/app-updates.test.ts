import { describe, expect, it } from 'vitest'
import {
  installerDownloadUrl,
  updateFeedSchema,
  updateReleaseSchema,
  updateRepositoryId,
  versionSchema
} from '@shared/app-updates.js'

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

  it('accepts exact GitHub installer paths after a transfer and rejects URL manipulation', () => {
    const version = '0.1.0-preview.9'
    const downloadUrl = installerDownloadUrl(version)
    expect(updateReleaseSchema.safeParse({ version, downloadUrl }).success).toBe(true)
    expect(
      updateReleaseSchema.safeParse({
        version,
        downloadUrl: installerDownloadUrl(version, 'new-org/new-name')
      }).success
    ).toBe(true)
    for (const url of [
      downloadUrl.replace('github.com/', 'github.com.attacker.example/'),
      downloadUrl.replace('github.com/', 'user@github.com/'),
      `${downloadUrl}?redirect=https://attacker.example`,
      `${downloadUrl}#fragment`,
      downloadUrl.replace('https:', 'http:'),
      downloadUrl.replace('/chromashift/', '/../')
    ]) {
      expect(updateReleaseSchema.safeParse({ version, downloadUrl: url }).success).toBe(false)
    }
  })

  it('binds installers to the repository identity and location in the trusted feed', () => {
    const version = '0.1.0-preview.9'
    const repository = { id: updateRepositoryId, fullName: 'future-org/chromashift' }
    const feed = {
      schemaVersion: 1,
      repository,
      releases: [
        {
          version,
          downloadUrl: installerDownloadUrl(version, repository.fullName),
          prerelease: true
        }
      ]
    }
    expect(updateFeedSchema.safeParse(feed).success).toBe(true)
    expect(
      updateFeedSchema.safeParse({ ...feed, repository: { ...repository, id: 1 } }).success
    ).toBe(false)
    for (const fullName of ['future-org/..', 'https://attacker.example', 'future-org']) {
      expect(
        updateFeedSchema.safeParse({ ...feed, repository: { ...repository, fullName } }).success
      ).toBe(false)
    }
    expect(
      updateFeedSchema.safeParse({
        ...feed,
        releases: [{ ...feed.releases[0], downloadUrl: installerDownloadUrl(version) }]
      }).success
    ).toBe(false)
  })
})
