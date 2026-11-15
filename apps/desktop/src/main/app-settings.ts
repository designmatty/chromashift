import { join } from 'node:path'
import { z } from 'zod'
import {
  activationModeSchema,
  activationTargetSchema,
  miniPanelPositionSchema,
  userPreferencesSchema,
  windowBoundsSchema,
  type UserPreferences
} from '@shared/product-api.js'
import { SettingsSliceStore } from '@main/settings-slice-store.js'

// Settings persist as three slice files under the user-data directory, one per
// owner: user preferences (renderer-editable), window state (Electron shell),
// and ChromaShift intent (product runtime). Each slice has exactly one store
// and its writers never touch another slice's fields.

export const windowStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    miniPanelPosition: miniPanelPositionSchema.optional(),
    windowBounds: windowBoundsSchema.optional(),
    windowMaximized: z.boolean().optional()
  })
  .strict()

export const chromaShiftIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    chromaShiftStatus: z.enum(['active', 'paused', 'safetyBlocked']),
    pendingControlOperation: z.enum(['pause', 'resume']).nullable().default(null),
    intendedActivationMode: activationModeSchema,
    intendedTarget: activationTargetSchema.nullable()
  })
  .strict()

export type WindowState = z.infer<typeof windowStateSchema>
export type ChromaShiftIntent = z.infer<typeof chromaShiftIntentSchema>

const version2UserPreferencesSchema = userPreferencesSchema.extend({
  schemaVersion: z.literal(2),
  shortcutBindings: userPreferencesSchema.shape.shortcutBindings.refine(
    (bindings) => bindings.every((binding) => binding.action.kind !== 'endPreview')
  )
}).strict()

const legacyUserPreferencesSchema = version2UserPreferencesSchema
  .omit({ schemaVersion: true })
  .extend({
    schemaVersion: z.literal(1)
  })
  .strict()

// Ignore only valid retired booleans on disk. IPC and other slice fields remain strict.
const persistedUserPreferencesSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const fields = { ...value } as Record<string, unknown>
  if (fields.schemaVersion === 1 && typeof fields.profileChangeNotifications === 'boolean') {
    delete fields.profileChangeNotifications
  } else if (
    (fields.schemaVersion === 2 || fields.schemaVersion === 3) &&
    typeof fields.notificationsEnabled === 'boolean'
  ) {
    delete fields.notificationsEnabled
  }
  return fields
}, z.union([
  userPreferencesSchema,
  version2UserPreferencesSchema,
  legacyUserPreferencesSchema
]).transform((preferences): UserPreferences => ({ ...preferences, schemaVersion: 3 })))

export const defaultUserPreferences: UserPreferences = {
  schemaVersion: 3,
  launchAtStartup: false,
  launchBehavior: 'tray',
  closeBehavior: 'tray',
  theme: 'system',
  shortcutBindings: []
}

export const defaultWindowState: WindowState = {
  schemaVersion: 1
}

export const defaultChromaShiftIntent: ChromaShiftIntent = {
  schemaVersion: 1,
  chromaShiftStatus: 'active',
  pendingControlOperation: null,
  intendedActivationMode: { kind: 'automatic' },
  intendedTarget: null
}

export interface SettingsStores {
  preferences: SettingsSliceStore<UserPreferences>
  windowState: SettingsSliceStore<WindowState>
  chromaShiftIntent: SettingsSliceStore<ChromaShiftIntent>
}

export function createSettingsStores(userDataDirectory: string): SettingsStores {
  return {
    preferences: new SettingsSliceStore(
      join(userDataDirectory, 'preferences.json'),
      persistedUserPreferencesSchema,
      defaultUserPreferences
    ),
    windowState: new SettingsSliceStore(
      join(userDataDirectory, 'window-state.json'),
      windowStateSchema,
      defaultWindowState
    ),
    chromaShiftIntent: new SettingsSliceStore(
      join(userDataDirectory, 'chroma-shift.json'),
      chromaShiftIntentSchema,
      defaultChromaShiftIntent
    )
  }
}
