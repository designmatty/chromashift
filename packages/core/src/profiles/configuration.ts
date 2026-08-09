import { z } from 'zod'
import { colorProfileSchema, type ColorProfile } from './model.js'

export const CURRENT_SCHEMA_VERSION = 1 as const
export const DEFAULT_PROFILE_ID = 'default' as const

export const profileSettingsSchema = z
  .object({
    defaultProfileId: z.string().trim().min(1).nullable()
  })
  .strict()

export const profileConfigurationSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    profiles: z.array(colorProfileSchema),
    settings: profileSettingsSchema
  })
  .strict()
  .superRefine((configuration, context) => {
    const profileIds = new Set<string>()
    for (const [index, profile] of configuration.profiles.entries()) {
      const normalizedId = profile.id.toLowerCase()
      if (profileIds.has(normalizedId)) {
        context.addIssue({
          code: 'custom',
          message: `Profile ID ${profile.id} is not unique.`,
          path: ['profiles', index, 'id']
        })
      }
      profileIds.add(normalizedId)
    }

    const defaultProfileId = configuration.settings.defaultProfileId
    if (
      defaultProfileId !== null &&
      !configuration.profiles.some(
        (profile) => profile.id.toLowerCase() === defaultProfileId.toLowerCase()
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: `Default profile ${defaultProfileId} does not exist.`,
        path: ['settings', 'defaultProfileId']
      })
    }
  })

const versionZeroConfigurationSchema = z
  .object({
    schemaVersion: z.literal(0),
    profiles: z.array(colorProfileSchema),
    defaultProfileId: z.string().trim().min(1).nullable().optional()
  })
  .strict()

export type ProfileSettings = z.infer<typeof profileSettingsSchema>
export type ProfileConfiguration = z.infer<typeof profileConfigurationSchema>

export class ConfigurationValidationError extends Error {
  public readonly details: readonly string[]

  public constructor(message: string, details: readonly string[] = [], options?: ErrorOptions) {
    super(details.length === 0 ? message : `${message} ${details.join(' ')}`, options)
    this.name = 'ConfigurationValidationError'
    this.details = details
  }
}

export class UnsupportedConfigurationVersionError extends ConfigurationValidationError {
  public constructor(version: unknown) {
    super(`Unsupported profile configuration schema version: ${String(version)}`)
    this.name = 'UnsupportedConfigurationVersionError'
  }
}

export function createEmptyConfiguration(): ProfileConfiguration {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profiles: [createDefaultProfile()],
    settings: { defaultProfileId: DEFAULT_PROFILE_ID }
  }
}

export function createDefaultProfile(): ColorProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: 'Default profile',
    enabled: true,
    color: {},
    applications: [],
    displays: []
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? 'configuration' : issue.path.join('.')
    return `${path}: ${issue.message}`
  })
}

function parseVersion(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || !('schemaVersion' in input)) {
    return undefined
  }
  return input.schemaVersion
}

function validateCurrentConfiguration(
  input: unknown,
  message = 'Profile configuration is invalid.'
): ProfileConfiguration {
  const result = profileConfigurationSchema.safeParse(input)
  if (result.success) return result.data
  throw new ConfigurationValidationError(message, formatIssues(result.error))
}

export function parseProfileConfiguration(input: unknown): ProfileConfiguration {
  const version = parseVersion(input)

  if (version === CURRENT_SCHEMA_VERSION) {
    return validateCurrentConfiguration(input)
  }

  if (version === 0) {
    const result = versionZeroConfigurationSchema.safeParse(input)
    if (!result.success) {
      throw new ConfigurationValidationError(
        'Version 0 profile configuration is invalid.',
        formatIssues(result.error)
      )
    }

    return validateCurrentConfiguration(
      {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        profiles: result.data.profiles,
        settings: { defaultProfileId: result.data.defaultProfileId ?? null }
      },
      'Migrated profile configuration is invalid.'
    )
  }

  throw new UnsupportedConfigurationVersionError(version)
}

export function parseProfileConfigurationJson(json: string): ProfileConfiguration {
  let input: unknown
  try {
    input = JSON.parse(json)
  } catch (error) {
    throw new ConfigurationValidationError('Profile configuration is not valid JSON.', [], {
      cause: error
    })
  }
  return parseProfileConfiguration(input)
}

export function serializeProfileConfiguration(configuration: ProfileConfiguration): string {
  const validated = parseProfileConfiguration(configuration)
  return `${JSON.stringify(validated, null, 2)}\n`
}

export function cloneProfile(profile: ColorProfile): ColorProfile {
  return structuredClone(profile)
}
