export {
  colorProfileSchema,
  colorSettingNames,
  colorSettingsSchema,
  applicationRuleSchema,
  profileDisplayTargetSchema,
  type ColorProfile,
  type ColorSettingName,
  type ColorSettings,
  type ApplicationRule,
  type ProfileDisplayTarget
} from './profiles/model.js'
export {
  activeColorTargets,
  findDisplayTarget,
  hasColorOverrides,
  removeDisplayTarget,
  resolveDisplayColor,
  sameDisplayId,
  setDisplayTarget,
  type DisplayColorTarget
} from './profiles/targets.js'
export {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_PROFILE_ID,
  ConfigurationValidationError,
  UnsupportedConfigurationVersionError,
  cloneProfile,
  createEmptyConfiguration,
  createDefaultProfile,
  parseProfileConfiguration,
  parseProfileConfigurationJson,
  profileConfigurationSchema,
  profileSettingsSchema,
  serializeProfileConfiguration,
  type ParseProfileConfigurationOptions,
  type ProfileConfiguration,
  type ProfileSettings
} from './profiles/configuration.js'
export {
  describeMigrationNotice,
  migrateVersionOneProfile,
  migrateVersionOneProfiles,
  versionOneConfigurationSchema,
  versionOneProfileSchema,
  type ConfigurationMigrationNotice,
  type MigrationNoticeListener,
  type VersionOneConfiguration,
  type VersionOneProfile
} from './profiles/migration.js'
export {
  JsonProfileRepository,
  type DuplicateProfileOptions,
  type ProfileConfigurationStorage,
  type ProfileRepository,
  type ProfileRepositoryOptions
} from './profiles/repository.js'
export {
  findMatchingProfile,
  matchApplicationRule,
  normalizeExecutableName,
  normalizeExecutablePath,
  type ApplicationMatchType,
  type ApplicationRuleMatch,
  type ForegroundApplication,
  type ProfileMatch
} from './matching/application-matcher.js'
export {
  ActivationResolver,
  automaticActivationMode,
  manualActivationMode,
  selectActivation,
  type ActivationContext,
  type ActivationMode,
  type ActivationReason,
  type ActivationResolution,
  type ActivationSelection,
  type ActivationTarget
} from './activation/activation-resolver.js'
