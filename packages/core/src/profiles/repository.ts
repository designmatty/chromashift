import {
  CURRENT_SCHEMA_VERSION,
  cloneProfile,
  createEmptyConfiguration,
  parseProfileConfiguration,
  parseProfileConfigurationJson,
  serializeProfileConfiguration,
  type ProfileConfiguration
} from './configuration.js'
import type { MigrationNoticeListener } from './migration.js'
import { colorProfileSchema, type ColorProfile } from './model.js'

export interface ProfileConfigurationStorage {
  read(): Promise<string | null>
  write(contents: string): Promise<void>
}

export interface ProfileRepositoryOptions {
  /** Called for each lossy decision taken while migrating an older configuration. */
  onMigrationNotice?: MigrationNoticeListener
}

export interface DuplicateProfileOptions {
  id: string
  name: string
}

export interface ProfileRepository {
  getConfiguration(): Promise<ProfileConfiguration>
  list(): Promise<ColorProfile[]>
  findById(profileId: string): Promise<ColorProfile | null>
  save(profile: ColorProfile): Promise<ColorProfile>
  duplicate(profileId: string, options: DuplicateProfileOptions): Promise<ColorProfile>
  delete(profileId: string): Promise<boolean>
  reorder?(profileIds: readonly string[]): Promise<void>
  setDefaultProfileId(profileId: string | null): Promise<void>
}

function cloneConfiguration(configuration: ProfileConfiguration): ProfileConfiguration {
  return structuredClone(configuration)
}

export class JsonProfileRepository implements ProfileRepository {
  private configuration: ProfileConfiguration | null = null

  public constructor(
    private readonly storage: ProfileConfigurationStorage,
    private readonly options: ProfileRepositoryOptions = {}
  ) {}

  public async getConfiguration(): Promise<ProfileConfiguration> {
    return cloneConfiguration(await this.load())
  }

  public async list(): Promise<ColorProfile[]> {
    return (await this.load()).profiles.map(cloneProfile)
  }

  public async findById(profileId: string): Promise<ColorProfile | null> {
    const profile = (await this.load()).profiles.find(
      (candidate) => candidate.id.toLowerCase() === profileId.toLowerCase()
    )
    return profile === undefined ? null : cloneProfile(profile)
  }

  public async save(profile: ColorProfile): Promise<ColorProfile> {
    const validatedProfile = colorProfileSchema.parse(profile)
    const current = await this.load()
    const profiles = current.profiles.map(cloneProfile)
    const existingIndex = profiles.findIndex(
      (candidate) => candidate.id.toLowerCase() === validatedProfile.id.toLowerCase()
    )
    if (existingIndex === -1) profiles.push(validatedProfile)
    else profiles[existingIndex] = validatedProfile

    await this.persist({ ...current, profiles })
    return cloneProfile(validatedProfile)
  }

  public async duplicate(
    profileId: string,
    options: DuplicateProfileOptions
  ): Promise<ColorProfile> {
    const source = await this.findById(profileId)
    if (source === null) throw new Error(`Profile ${profileId} does not exist.`)
    if ((await this.findById(options.id)) !== null) {
      throw new Error(`Profile ${options.id} already exists.`)
    }

    return this.save({ ...source, id: options.id, name: options.name })
  }

  public async delete(profileId: string): Promise<boolean> {
    const current = await this.load()
    const profiles = current.profiles.filter(
      (profile) => profile.id.toLowerCase() !== profileId.toLowerCase()
    )
    if (profiles.length === current.profiles.length) return false

    const defaultProfileId = current.settings.defaultProfileId
    await this.persist({
      ...current,
      profiles,
      settings: {
        defaultProfileId:
          defaultProfileId?.toLowerCase() === profileId.toLowerCase() ? null : defaultProfileId
      }
    })
    return true
  }

  public async reorder(profileIds: readonly string[]): Promise<void> {
    const current = await this.load()
    const normalized = profileIds.map((profileId) => profileId.toLowerCase())
    const existing = current.profiles.map((profile) => profile.id.toLowerCase())
    if (
      normalized.length !== existing.length ||
      new Set(normalized).size !== normalized.length ||
      existing.some((profileId) => !normalized.includes(profileId))
    ) {
      throw new Error('Profile order must contain every profile exactly once.')
    }
    const byId = new Map(current.profiles.map((profile) => [profile.id.toLowerCase(), profile]))
    await this.persist({
      ...current,
      profiles: normalized.map((profileId) => cloneProfile(byId.get(profileId)!))
    })
  }

  public async setDefaultProfileId(profileId: string | null): Promise<void> {
    const current = await this.load()
    const canonicalProfileId =
      profileId === null
        ? null
        : current.profiles.find((profile) => profile.id.toLowerCase() === profileId.toLowerCase())
            ?.id

    if (profileId !== null && canonicalProfileId === undefined) {
      throw new Error(`Profile ${profileId} does not exist.`)
    }

    await this.persist({
      ...current,
      settings: { defaultProfileId: canonicalProfileId ?? null }
    })
  }

  private async load(): Promise<ProfileConfiguration> {
    if (this.configuration !== null) return this.configuration

    const contents = await this.storage.read()
    if (contents === null) {
      this.configuration = createEmptyConfiguration()
      return this.configuration
    }

    const parsedConfiguration = parseProfileConfigurationJson(contents, {
      onMigrationNotice: this.options.onMigrationNotice
    })
    const parsedJson: unknown = JSON.parse(contents)
    const originalVersion =
      typeof parsedJson === 'object' && parsedJson !== null && 'schemaVersion' in parsedJson
        ? parsedJson.schemaVersion
        : undefined
    if (originalVersion !== CURRENT_SCHEMA_VERSION) {
      await this.storage.write(serializeProfileConfiguration(parsedConfiguration))
    }
    this.configuration = parsedConfiguration
    return this.configuration
  }

  private async persist(configuration: ProfileConfiguration): Promise<void> {
    const validated = parseProfileConfiguration(configuration)
    await this.storage.write(serializeProfileConfiguration(validated))
    this.configuration = validated
  }
}
