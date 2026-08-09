export {
  colorProfileSchema,
  colorSettingsSchema,
  applicationRuleSchema,
  profileDisplayTargetSchema,
  type ColorProfile,
  type ColorSettings,
  type ApplicationRule,
  type ProfileDisplayTarget
} from './profiles/model.js'
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
  type ProfileConfiguration,
  type ProfileSettings
} from './profiles/configuration.js'
export {
  JsonProfileRepository,
  type DuplicateProfileOptions,
  type ProfileConfigurationStorage,
  type ProfileRepository
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
