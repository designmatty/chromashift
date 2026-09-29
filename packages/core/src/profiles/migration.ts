import { z } from 'zod'
import {
  applicationRuleSchema,
  clampGammaForBrightness,
  colorSettingNames,
  createNeutralColorSettings,
  type ColorProfile,
  type ColorSettingName,
  type CompleteColorSettings
} from './model.js'

const identifierSchema = z.string().trim().min(1)
const normalizedValueSchema = z.number().finite().min(0).max(100)

export const legacyColorSettingsSchema = z
  .object({
    brightness: normalizedValueSchema.optional(),
    contrast: normalizedValueSchema.optional(),
    gamma: z.number().finite().min(0.5).max(2.8).optional(),
    saturation: normalizedValueSchema.optional(),
    hue: normalizedValueSchema.optional(),
    colorTemperature: normalizedValueSchema.optional()
  })
  .strict()

const versionTwoDisplayTargetSchema = z
  .object({
    displayId: identifierSchema,
    color: legacyColorSettingsSchema,
    lastColorValues: legacyColorSettingsSchema.optional()
  })
  .strict()

export const versionTwoProfileSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    applications: z.array(applicationRuleSchema),
    displays: z.array(versionTwoDisplayTargetSchema)
  })
  .strict()
  .superRefine((profile, context) => refineUniqueDisplayIds(profile.displays, context))

export const versionTwoConfigurationSchema = z
  .object({
    schemaVersion: z.literal(2),
    profiles: z.array(versionTwoProfileSchema),
    settings: z.object({ defaultProfileId: identifierSchema.nullable() }).strict()
  })
  .strict()

/** Version 1 stored one shared color object per profile and bare display IDs. */
export const versionOneProfileSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    color: legacyColorSettingsSchema,
    lastColorValues: legacyColorSettingsSchema.optional(),
    applications: z.array(applicationRuleSchema),
    displays: z.array(z.object({ displayId: identifierSchema }).strict())
  })
  .strict()
  .superRefine((profile, context) => refineUniqueDisplayIds(profile.displays, context))

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

export type LegacyColorSettings = z.infer<typeof legacyColorSettingsSchema>
export type VersionTwoProfile = z.infer<typeof versionTwoProfileSchema>
export type VersionTwoConfiguration = z.infer<typeof versionTwoConfigurationSchema>
export type VersionOneProfile = z.infer<typeof versionOneProfileSchema>
export type VersionOneConfiguration = z.infer<typeof versionOneConfigurationSchema>

export interface GammaMigrationAdjustment {
  from: number
  to: number
  brightness: number
}

export type ConfigurationMigrationNotice =
  | {
      code: 'discardedUnassignedColorSettings'
      profileId: string
      settings: string[]
    }
  | {
      code: 'completedDisplayColorSettings'
      profileId: string
      displayId: string
      addedSettings: ColorSettingName[]
      discardedRememberedSettings: ColorSettingName[]
      gammaAdjustment?: GammaMigrationAdjustment
    }

export type MigrationNoticeListener = (notice: ConfigurationMigrationNotice) => void

function refineUniqueDisplayIds(
  displays: readonly { displayId: string }[],
  context: z.RefinementCtx
): void {
  const displayIds = new Set<string>()
  for (const [index, display] of displays.entries()) {
    const normalizedId = display.displayId.toLowerCase()
    if (displayIds.has(normalizedId)) {
      context.addIssue({
        code: 'custom',
        message: `Display ${display.displayId} is assigned more than once.`,
        path: ['displays', index, 'displayId']
      })
    }
    displayIds.add(normalizedId)
  }
}

function settingKeys(settings: LegacyColorSettings | undefined): ColorSettingName[] {
  if (settings === undefined) return []
  return colorSettingNames.filter((name) => settings[name] !== undefined)
}

function completeColorSettings(settings: LegacyColorSettings): {
  color: CompleteColorSettings
  addedSettings: ColorSettingName[]
  gammaAdjustment?: GammaMigrationAdjustment
} {
  const neutral = createNeutralColorSettings()
  const color: CompleteColorSettings = {
    brightness: settings.brightness ?? neutral.brightness,
    contrast: settings.contrast ?? neutral.contrast,
    gamma: settings.gamma ?? neutral.gamma,
    saturation: settings.saturation ?? neutral.saturation,
    hue: settings.hue ?? neutral.hue,
    colorTemperature: settings.colorTemperature ?? neutral.colorTemperature
  }
  const unclampedGamma = color.gamma
  color.gamma = clampGammaForBrightness(color.gamma, color.brightness)
  return {
    color,
    addedSettings: colorSettingNames.filter((name) => settings[name] === undefined),
    ...(color.gamma === unclampedGamma
      ? {}
      : {
          gammaAdjustment: {
            from: unclampedGamma,
            to: color.gamma,
            brightness: color.brightness
          }
        })
  }
}

export function migrateVersionTwoProfile(
  profile: VersionTwoProfile,
  onNotice?: MigrationNoticeListener
): ColorProfile {
  return {
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    applications: profile.applications.map((rule) => ({ ...rule })),
    displays: profile.displays.map((target) => {
      const completed = completeColorSettings(target.color)
      const discardedRememberedSettings = settingKeys(target.lastColorValues)
      if (
        completed.addedSettings.length > 0 ||
        discardedRememberedSettings.length > 0 ||
        completed.gammaAdjustment !== undefined
      ) {
        onNotice?.({
          code: 'completedDisplayColorSettings',
          profileId: profile.id,
          displayId: target.displayId,
          addedSettings: completed.addedSettings,
          discardedRememberedSettings,
          ...(completed.gammaAdjustment === undefined
            ? {}
            : { gammaAdjustment: completed.gammaAdjustment })
        })
      }
      return { displayId: target.displayId, color: completed.color }
    })
  }
}

export function migrateVersionTwoProfiles(
  profiles: readonly VersionTwoProfile[],
  onNotice?: MigrationNoticeListener
): ColorProfile[] {
  return profiles.map((profile) => migrateVersionTwoProfile(profile, onNotice))
}

export function migrateVersionOneProfile(
  profile: VersionOneProfile,
  onNotice?: MigrationNoticeListener
): ColorProfile {
  if (profile.displays.length === 0) {
    const discarded = [...Object.keys(profile.color), ...Object.keys(profile.lastColorValues ?? {})]
    if (discarded.length > 0) {
      onNotice?.({
        code: 'discardedUnassignedColorSettings',
        profileId: profile.id,
        settings: [...new Set(discarded)].sort()
      })
    }
  }

  return migrateVersionTwoProfile(
    {
      id: profile.id,
      name: profile.name,
      enabled: profile.enabled,
      applications: profile.applications.map((rule) => ({ ...rule })),
      displays: profile.displays.map((display) => ({
        displayId: display.displayId,
        color: { ...profile.color },
        ...(profile.lastColorValues === undefined
          ? {}
          : { lastColorValues: { ...profile.lastColorValues } })
      }))
    },
    onNotice
  )
}

export function migrateVersionOneProfiles(
  profiles: readonly VersionOneProfile[],
  onNotice?: MigrationNoticeListener
): ColorProfile[] {
  return profiles.map((profile) => migrateVersionOneProfile(profile, onNotice))
}

export function describeMigrationNotice(notice: ConfigurationMigrationNotice): string {
  if (notice.code === 'discardedUnassignedColorSettings') {
    return `Profile ${notice.profileId} targeted no display, so its unapplied ${notice.settings.join(', ')} ${notice.settings.length === 1 ? 'value was' : 'values were'} discarded during migration.`
  }

  const changes = [] as string[]
  if (notice.addedSettings.length > 0) {
    changes.push(`filled neutral ${notice.addedSettings.join(', ')}`)
  }
  if (notice.discardedRememberedSettings.length > 0) {
    changes.push(`discarded inactive ${notice.discardedRememberedSettings.join(', ')}`)
  }
  if (notice.gammaAdjustment !== undefined) {
    changes.push(
      `clamped gamma from ${notice.gammaAdjustment.from} to ${notice.gammaAdjustment.to} at ${notice.gammaAdjustment.brightness}% brightness`
    )
  }
  return `Profile ${notice.profileId}, display ${notice.displayId}: ${changes.join('; ')}.`
}

export function isInertVersionOneProfile(profile: VersionOneProfile): boolean {
  return profile.displays.length === 0 && Object.keys(profile.color).length > 0
}
