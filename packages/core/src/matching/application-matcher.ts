import type { ApplicationRule, ColorProfile } from '../profiles/model.js'

export interface ForegroundApplication {
  executable: string | null
  path: string | null
}

export type ApplicationMatchType = 'path' | 'filename'

export interface ApplicationRuleMatch {
  rule: ApplicationRule
  type: ApplicationMatchType
}

export interface ProfileMatch extends ApplicationRuleMatch {
  profile: ColorProfile
}

function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed
}

export function normalizeExecutablePath(value: string): string {
  return stripSurroundingQuotes(value)
    .replace(/^\\\\\?\\/, '')
    .replaceAll('/', '\\')
    .replace(/\\+$/, '')
    .toLowerCase()
}

export function normalizeExecutableName(value: string): string {
  return stripSurroundingQuotes(value).toLowerCase()
}

function filenameFromPath(value: string): string | null {
  const normalized = value.replaceAll('/', '\\').replace(/\\+$/, '')
  const filename = normalized.slice(normalized.lastIndexOf('\\') + 1)
  return filename.length === 0 ? null : filename
}

export function matchApplicationRule(
  rule: ApplicationRule,
  application: ForegroundApplication
): ApplicationRuleMatch | null {
  if (rule.executablePath !== undefined && application.path !== null) {
    return normalizeExecutablePath(rule.executablePath) === normalizeExecutablePath(application.path)
      ? { rule, type: 'path' }
      : null
  }

  const executable = application.executable ??
    (application.path === null ? null : filenameFromPath(application.path))

  if (
    executable !== null &&
    normalizeExecutableName(rule.executableName) === normalizeExecutableName(executable)
  ) {
    return { rule, type: 'filename' }
  }

  return null
}

export function findMatchingProfile(
  profiles: readonly ColorProfile[],
  application: ForegroundApplication | null
): ProfileMatch | null {
  if (application === null) return null

  let filenameMatch: ProfileMatch | null = null
  for (const profile of profiles) {
    if (!profile.enabled) continue

    for (const rule of profile.applications) {
      const match = matchApplicationRule(rule, application)
      if (match?.type === 'path') return { profile, ...match }
      if (match !== null && filenameMatch === null) {
        filenameMatch = { profile, ...match }
      }
    }
  }

  return filenameMatch
}
