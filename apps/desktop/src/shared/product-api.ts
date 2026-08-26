import {
  colorProfileSchema,
  profileConfigurationSchema,
  type ColorProfile
} from '@chromashift/core'
import {
  displayCapabilitiesResultSchema,
  displaySchema,
  displaySettingsSchema,
  foregroundApplicationSchema
} from '@chromashift/native-client/protocol'
import { z } from 'zod'

export const productIpcChannels = {
  getState: 'product:get-state',
  createProfile: 'product:create-profile',
  saveProfile: 'product:save-profile',
  duplicateProfile: 'product:duplicate-profile',
  deleteProfile: 'product:delete-profile',
  reorderProfiles: 'product:reorder-profiles',
  setDefaultProfile: 'product:set-default-profile',
  activateProfile: 'product:activate-profile',
  enableAutomatic: 'product:enable-automatic',
  restoreBaseline: 'product:restore-baseline',
  controlChromaShift: 'product:control-chromashift',
  pickApplication: 'product:pick-application',
  listApplications: 'product:list-applications',
  getDiagnostics: 'product:get-diagnostics',
  updateSettings: 'product:update-settings',
  startPreview: 'product:start-preview',
  updatePreview: 'product:update-preview',
  confirmPreview: 'product:confirm-preview',
  cancelPreview: 'product:cancel-preview',
  requestExit: 'application:request-exit',
  openAppPanel: 'application:open-app-panel',
  hideMiniPanel: 'application:hide-mini-panel',
  showMiniPanel: 'application:show-mini-panel',
  openMiniPanelDevTools: 'application:open-mini-panel-dev-tools',
  setMiniPanelView: 'application:set-mini-panel-view',
  appPanelClosed: 'application:app-panel-closed',
  navigateAppPanel: 'application:navigate-app-panel',
  selectAppPanelProfile: 'application:select-app-panel-profile',
  stateChanged: 'product:state-changed'
} as const

export const activationModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('automatic') }),
  z.object({ kind: z.literal('manual'), profileId: z.string().min(1) })
])
export const activationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('baseline') }),
  z.object({ kind: z.literal('profile'), profileId: z.string().min(1) })
])

export const activationStateSchema = z.object({
  enabled: z.boolean(),
  mode: activationModeSchema,
  currentTarget: activationTargetSchema.nullable()
})

export const previewTargetSchema = z
  .object({
    displayId: z.string().startsWith('display:'),
    color: displaySettingsSchema
  })
  .strict()

export const previewStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('inactive') }),
  z.object({
    state: z.literal('active'),
    profileId: z.string().min(1),
    kind: z.enum(['preview', 'edit', 'override']),
    targets: z.array(previewTargetSchema)
  })
])

export const miniPanelPositionSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int()
  })
  .strict()

export const windowBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive()
  })
  .strict()

export const shortcutActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('defaultProfile') }).strict(),
  z.object({ kind: z.literal('previousProfile') }).strict(),
  z.object({ kind: z.literal('nextProfile') }).strict(),
  z.object({ kind: z.literal('automatic') }).strict(),
  z.object({ kind: z.literal('toggleChromaShift') }).strict(),
  z.object({ kind: z.literal('profile'), profileId: z.string().trim().min(1) }).strict()
])

export const shortcutBindingSchema = z
  .object({
    action: shortcutActionSchema,
    accelerator: z.string().trim().min(1).max(100)
  })
  .strict()

// The renderer sees and edits only user preferences. Window geometry and
// ChromaShift intent are main-owned slices persisted separately and never
// cross the renderer seam; intent is exposed read-only via ProductState's
// chromaShift section.
export const userPreferencesSchema = z
  .object({
    schemaVersion: z.literal(2),
    launchAtStartup: z.boolean(),
    launchBehavior: z.enum(['tray', 'app']),
    closeBehavior: z.enum(['tray', 'shutdown']),
    theme: z.enum(['system', 'light', 'dark']),
    notificationsEnabled: z.boolean(),
    shortcutBindings: z.array(shortcutBindingSchema)
  })
  .strict()

export const productStateSchema = z.object({
  version: z.string().min(1),
  configuration: profileConfigurationSchema,
  displays: z.array(displaySchema),
  capabilityReports: z.record(z.string(), displayCapabilitiesResultSchema),
  activation: activationStateSchema,
  chromaShift: z
    .object({
      status: z.enum(['active', 'paused', 'safetyBlocked']),
      pendingOperation: z.enum(['pause', 'resume']).nullable(),
      intendedMode: activationModeSchema,
      intendedTarget: activationTargetSchema.nullable(),
      transitionInProgress: z.boolean()
    })
    .strict(),
  foregroundApplication: foregroundApplicationSchema.nullable(),
  preview: previewStateSchema,
  settings: userPreferencesSchema
})

export const applicationSelectionSchema = z.object({
  executableName: z.string().trim().min(1),
  executablePath: z.string().trim().min(1),
  friendlyName: z.string().trim().min(1),
  iconDataUrl: z.string().startsWith('data:image/').nullable()
})

export const productErrorSchema = z.object({
  code: z.enum([
    'INVALID_REQUEST',
    'NOT_FOUND',
    'CONFLICT',
    'NATIVE_UNAVAILABLE',
    'UNSUPPORTED',
    'OPERATION_FAILED'
  ]),
  message: z.string().min(1),
  details: z.array(z.string()).optional()
})

export function productResultSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: valueSchema }),
    z.object({ ok: z.literal(false), error: productErrorSchema })
  ])
}

export const emptyRequestSchema = z.object({}).strict()
export const appPanelViewSchema = z.enum([
  'profiles',
  'displays',
  'settings',
  'shortcuts',
  'diagnostics',
  'about'
])
export const openAppPanelRequestSchema = z.object({ view: appPanelViewSchema.optional() }).strict()
export const miniPanelViewSchema = z.enum(['controls', 'override', 'picker'])
export const setMiniPanelViewRequestSchema = z.object({ view: miniPanelViewSchema }).strict()
export const profileIdRequestSchema = z.object({ profileId: z.string().trim().min(1) }).strict()
export const controlChromaShiftRequestSchema = z
  .object({ action: z.enum(['pause', 'resume', 'retry']) })
  .strict()
export const reorderProfilesRequestSchema = z
  .object({
    profileIds: z.array(z.string().trim().min(1)).min(1)
  })
  .strict()
export const createProfileRequestSchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict()
export const saveProfileRequestSchema = z
  .object({ profile: colorProfileSchema, removeShortcut: z.boolean().optional() })
  .strict()
export const setDefaultProfileRequestSchema = z
  .object({
    profileId: z.string().trim().min(1).nullable()
  })
  .strict()
export const previewProfileRequestSchema = z.object({ profile: colorProfileSchema }).strict()
export const startSessionRequestSchema = z
  .object({
    profile: colorProfileSchema,
    kind: z.enum(['preview', 'edit', 'override'])
  })
  .strict()
export const commitSessionRequestSchema = z
  .object({
    profile: colorProfileSchema,
    activation: z.enum(['manual', 'preserve'])
  })
  .strict()
export const previewUpdateRequestSchema = z
  .object({
    profileId: z.string().trim().min(1),
    targets: z.array(previewTargetSchema)
  })
  .strict()
  .superRefine((request, context) => {
    const displayIds = new Set<string>()
    for (const [index, target] of request.targets.entries()) {
      const normalizedId = target.displayId.toLowerCase()
      if (displayIds.has(normalizedId)) {
        context.addIssue({
          code: 'custom',
          message: `Display ${target.displayId} appears more than once.`,
          path: ['targets', index, 'displayId']
        })
      }
      displayIds.add(normalizedId)
    }
  })

export const productStateResultSchema = productResultSchema(productStateSchema)
export const profileResultSchema = productResultSchema(colorProfileSchema)
export const booleanResultSchema = productResultSchema(z.boolean())
export const voidResultSchema = productResultSchema(z.null())
export const applicationSelectionResultSchema = productResultSchema(
  applicationSelectionSchema.nullable()
)
export const applicationSelectionsResultSchema = productResultSchema(
  z.array(applicationSelectionSchema)
)
export const diagnosticLogEntrySchema = z
  .object({
    timestamp: z.string().min(1),
    level: z.enum(['information', 'warning', 'error', 'critical']),
    eventName: z.string().min(1).max(200),
    details: z.string().max(20_000)
  })
  .strict()
export const diagnosticLogEntriesResultSchema = productResultSchema(
  z.array(diagnosticLogEntrySchema).max(250)
)
export const userPreferencesRequestSchema = z.object({ settings: userPreferencesSchema }).strict()
export const userPreferencesResultSchema = productResultSchema(userPreferencesSchema)

export type ProductState = z.infer<typeof productStateSchema>
export type PreviewState = z.infer<typeof previewStateSchema>
export type PreviewTarget = z.infer<typeof previewTargetSchema>
export type ProductError = z.infer<typeof productErrorSchema>
export type ApplicationSelection = z.infer<typeof applicationSelectionSchema>
export type DiagnosticLogEntry = z.infer<typeof diagnosticLogEntrySchema>
export type UserPreferences = z.infer<typeof userPreferencesSchema>
export type ShortcutAction = z.infer<typeof shortcutActionSchema>
export type ShortcutBinding = z.infer<typeof shortcutBindingSchema>
export type AppPanelView = z.infer<typeof appPanelViewSchema>
export type MiniPanelView = z.infer<typeof miniPanelViewSchema>
export type ProductResult<T> = { ok: true; value: T } | { ok: false; error: ProductError }

export interface ChromaShiftApi {
  getState(): Promise<ProductResult<ProductState>>
  createProfile(name: string): Promise<ProductResult<ColorProfile>>
  saveProfile(profile: ColorProfile, removeShortcut?: boolean): Promise<ProductResult<ColorProfile>>
  duplicateProfile(profileId: string): Promise<ProductResult<ColorProfile>>
  deleteProfile(profileId: string): Promise<ProductResult<boolean>>
  reorderProfiles(profileIds: string[]): Promise<ProductResult<null>>
  setDefaultProfile(profileId: string | null): Promise<ProductResult<null>>
  activateProfile(profileId: string): Promise<ProductResult<null>>
  enableAutomatic(): Promise<ProductResult<null>>
  restoreBaseline(): Promise<ProductResult<null>>
  controlChromaShift(action: 'pause' | 'resume' | 'retry'): Promise<ProductResult<null>>
  pickApplication(): Promise<ProductResult<ApplicationSelection | null>>
  listApplications(): Promise<ProductResult<ApplicationSelection[]>>
  getDiagnostics(): Promise<ProductResult<DiagnosticLogEntry[]>>
  updateSettings(settings: UserPreferences): Promise<ProductResult<UserPreferences>>
  startPreview(
    profile: ColorProfile,
    kind: 'preview' | 'edit' | 'override'
  ): Promise<ProductResult<null>>
  updatePreview(profileId: string, targets: PreviewTarget[]): Promise<ProductResult<null>>
  confirmPreview(
    profile: ColorProfile,
    activation: 'manual' | 'preserve'
  ): Promise<ProductResult<ColorProfile>>
  cancelPreview(): Promise<ProductResult<null>>
  requestExit(): Promise<ProductResult<boolean>>
  openAppPanel(view?: AppPanelView): Promise<ProductResult<null>>
  hideMiniPanel(): Promise<ProductResult<null>>
  showMiniPanel(): Promise<ProductResult<null>>
  openMiniPanelDevTools(): Promise<ProductResult<null>>
  setMiniPanelView(view: MiniPanelView): Promise<ProductResult<null>>
  onStateChanged(listener: (state: ProductState) => void): void
  onAppPanelClosed(listener: () => void): void
  onAppPanelNavigation(listener: (view: AppPanelView) => void): void
  onAppPanelProfileSelection(listener: (profileId: string) => void): void
}
