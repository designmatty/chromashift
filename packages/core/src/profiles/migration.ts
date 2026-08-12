import { z } from 'zod'
import {
  applicationRuleSchema,
  colorSettingsSchema,
  type ColorProfile,
  type ProfileDisplayTarget
} from './model.js'
import { hasColorOverrides } from './targets.js'

const identifierSchema = z.string().trim().min(1)

/**
 * Schema version 1 stored one shared color object per profile and a bare list of
 * display IDs. Version 2 moves those settings into each display target so two
 * displays in one profile can hold different values.
 */
export const versionOneProfileSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    color: colorSettingsSchema,
    lastColorValues: colorSettingsSchema.optional(),
    applications: z.array(applicationRuleSchema),
    displays: z.array(z.object({ displayId: identifierSchema }).strict())
  })
  .strict()

export const versionOneConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    profiles: z.array(versionOneProfileSchema),
    settings: z.object({ defaultProfileId: identifierSchema.nullable() }).strict()
  })
  .strict()

export const versionZeroConfigurationSchema = z
  .object({
    schemaVersion: z.literal(0),
    profiles: z.array(versionOneProfileSchema),
    defaultProfileId: identifierSchema.nullable().optional()
  })
  .strict()

export type VersionOneProfile = z.infer<typeof versionOneProfileSchema>
export type VersionOneConfiguration = z.infer<typeof versionOneConfigurationSchema>

/**
 * A version 1 profile could hold color values while targeting no display. Those
 * values never reached the hardware, and version 2 has no profile-level home for
 * them, so migration discards them and reports it rather than inventing a target.
 */
export interface ConfigurationMigrationNotice {
  code: 'discardedUnassignedColorSettings'
  profileId: string
  settings: string[]
}

export type MigrationNoticeListener = (notice: ConfigurationMigrationNotice) => void

export function migrateVersionOneProfile(
  profile: VersionOneProfile,
  onNotice?: MigrationNoticeListener
): ColorProfile {
  if (profile.displays.length === 0) {
    const discarded = [
      ...Object.keys(profile.color),
      ...Object.keys(profile.lastColorValues ?? {})
    ]
    if (discarded.length > 0) {
      onNotice?.({
        code: 'discardedUnassignedColorSettings',
        profileId: profile.id,
        settings: [...new Set(discarded)].sort()
      })
    }
  }

  return {
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    applications: profile.applications.map((rule) => ({ ...rule })),
    displays: profile.displays.map((display) => {
      const target: ProfileDisplayTarget = {
        displayId: display.displayId,
        color: { ...profile.color }
      }
      if (profile.lastColorValues !== undefined) {
        target.lastColorValues = { ...profile.lastColorValues }
      }
      return target
    })
  }
}

export function migrateVersionOneProfiles(
  profiles: readonly VersionOneProfile[],
  onNotice?: MigrationNoticeListener
): ColorProfile[] {
  return profiles.map((profile) => migrateVersionOneProfile(profile, onNotice))
}

export function describeMigrationNotice(notice: ConfigurationMigrationNotice): string {
  return `Profile ${notice.profileId} targeted no display, so its unapplied ${notice.settings.join(', ')} ${notice.settings.length === 1 ? 'value was' : 'values were'} discarded during the version 2 migration.`
}

/** True when the persisted color settings would have produced no native write. */
export function isInertVersionOneProfile(profile: VersionOneProfile): boolean {
  return profile.displays.length === 0 && hasColorOverrides(profile.color)
}
