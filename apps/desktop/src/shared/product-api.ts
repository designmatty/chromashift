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
  setDefaultProfile: 'product:set-default-profile',
  activateProfile: 'product:activate-profile',
  enableAutomatic: 'product:enable-automatic',
  restoreBaseline: 'product:restore-baseline',
  pickApplication: 'product:pick-application',
  listApplications: 'product:list-applications',
  updateSettings: 'product:update-settings',
  startPreview: 'product:start-preview',
  updatePreview: 'product:update-preview',
  confirmPreview: 'product:confirm-preview',
  cancelPreview: 'product:cancel-preview',
  requestExit: 'application:request-exit',
  openAppPanel: 'application:open-app-panel',
  hideMiniPanel: 'application:hide-mini-panel',
  appPanelClosed: 'application:app-panel-closed',
  navigateAppPanel: 'application:navigate-app-panel',
  stateChanged: 'product:state-changed'
} as const

export const activationStateSchema = z.object({
  enabled: z.boolean(),
  mode: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('automatic') }),
    z.object({ kind: z.literal('manual'), profileId: z.string().min(1) })
  ]),
  currentTarget: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('baseline') }),
    z.object({ kind: z.literal('profile'), profileId: z.string().min(1) })
  ]).nullable()
})

export const previewStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('inactive') }),
  z.object({
    state: z.literal('active'),
    profileId: z.string().min(1),
    kind: z.enum(['preview', 'edit', 'override']),
    color: displaySettingsSchema,
    displayIds: z.array(z.string().startsWith('display:'))
  })
])

export const appSettingsSchema = z.object({
  launchAtStartup: z.boolean(),
  launchBehavior: z.enum(['tray', 'app']),
  closeBehavior: z.enum(['tray', 'shutdown']),
  theme: z.enum(['system', 'light', 'dark']),
  miniPanelPosition: z.object({
    x: z.number().int(),
    y: z.number().int()
  }).strict().optional()
})

export const productStateSchema = z.object({
  configuration: profileConfigurationSchema,
  displays: z.array(displaySchema),
  capabilityReports: z.record(z.string(), displayCapabilitiesResultSchema),
  activation: activationStateSchema,
  foregroundApplication: foregroundApplicationSchema.nullable(),
  preview: previewStateSchema,
  settings: appSettingsSchema
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
export const appPanelViewSchema = z.enum(['profiles', 'displays', 'settings'])
export const openAppPanelRequestSchema = z.object({ view: appPanelViewSchema.optional() }).strict()
export const profileIdRequestSchema = z.object({ profileId: z.string().trim().min(1) }).strict()
export const createProfileRequestSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict()
export const saveProfileRequestSchema = z.object({ profile: colorProfileSchema }).strict()
export const setDefaultProfileRequestSchema = z.object({
  profileId: z.string().trim().min(1).nullable()
}).strict()
export const previewProfileRequestSchema = z.object({ profile: colorProfileSchema }).strict()
export const startSessionRequestSchema = z.object({
  profile: colorProfileSchema,
  kind: z.enum(['preview', 'edit', 'override'])
}).strict()
export const commitSessionRequestSchema = z.object({
  profile: colorProfileSchema,
  activation: z.enum(['manual', 'preserve'])
}).strict()
export const previewUpdateRequestSchema = z.object({
  profileId: z.string().trim().min(1),
  color: displaySettingsSchema,
  displayIds: z.array(z.string().startsWith('display:')).min(1)
}).strict()

export const productStateResultSchema = productResultSchema(productStateSchema)
export const profileResultSchema = productResultSchema(colorProfileSchema)
export const booleanResultSchema = productResultSchema(z.boolean())
export const voidResultSchema = productResultSchema(z.null())
export const applicationSelectionResultSchema = productResultSchema(applicationSelectionSchema.nullable())
export const applicationSelectionsResultSchema = productResultSchema(z.array(applicationSelectionSchema))
export const appSettingsRequestSchema = z.object({ settings: appSettingsSchema }).strict()
export const appSettingsResultSchema = productResultSchema(appSettingsSchema)

export type ProductState = z.infer<typeof productStateSchema>
export type PreviewState = z.infer<typeof previewStateSchema>
export type ProductError = z.infer<typeof productErrorSchema>
export type ApplicationSelection = z.infer<typeof applicationSelectionSchema>
export type AppSettings = z.infer<typeof appSettingsSchema>
export type AppPanelView = z.infer<typeof appPanelViewSchema>
export type ProductResult<T> = { ok: true; value: T } | { ok: false; error: ProductError }

export interface ChromaShiftApi {
  getState(): Promise<ProductResult<ProductState>>
  createProfile(name: string): Promise<ProductResult<ColorProfile>>
  saveProfile(profile: ColorProfile): Promise<ProductResult<ColorProfile>>
  duplicateProfile(profileId: string): Promise<ProductResult<ColorProfile>>
  deleteProfile(profileId: string): Promise<ProductResult<boolean>>
  setDefaultProfile(profileId: string | null): Promise<ProductResult<null>>
  activateProfile(profileId: string): Promise<ProductResult<null>>
  enableAutomatic(): Promise<ProductResult<null>>
  restoreBaseline(): Promise<ProductResult<null>>
  pickApplication(): Promise<ProductResult<ApplicationSelection | null>>
  listApplications(): Promise<ProductResult<ApplicationSelection[]>>
  updateSettings(settings: AppSettings): Promise<ProductResult<AppSettings>>
  startPreview(profile: ColorProfile, kind: 'preview' | 'edit' | 'override'): Promise<ProductResult<null>>
  updatePreview(profileId: string, color: ColorProfile['color'], displayIds: string[]): Promise<ProductResult<null>>
  confirmPreview(profile: ColorProfile, activation: 'manual' | 'preserve'): Promise<ProductResult<ColorProfile>>
  cancelPreview(): Promise<ProductResult<null>>
  requestExit(): Promise<ProductResult<boolean>>
  openAppPanel(view?: AppPanelView): Promise<ProductResult<null>>
  hideMiniPanel(): Promise<ProductResult<null>>
  onStateChanged(listener: (state: ProductState) => void): void
  onAppPanelClosed(listener: () => void): void
  onAppPanelNavigation(listener: (view: AppPanelView) => void): void
}
