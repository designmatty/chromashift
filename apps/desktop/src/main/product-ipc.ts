import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { ConfigurationValidationError } from '@chromashift/core'
import { NativeServiceError } from '@chromashift/native-client'
import { z } from 'zod'
import {
  applicationSelectionResultSchema,
  applicationSelectionsResultSchema,
  appSettingsRequestSchema,
  appSettingsResultSchema,
  booleanResultSchema,
  createProfileRequestSchema,
  emptyRequestSchema,
  openAppPanelRequestSchema,
  commitSessionRequestSchema,
  startSessionRequestSchema,
  previewUpdateRequestSchema,
  productIpcChannels,
  productStateResultSchema,
  profileIdRequestSchema,
  profileResultSchema,
  saveProfileRequestSchema,
  setDefaultProfileRequestSchema,
  voidResultSchema,
  type AppPanelView,
  type ProductError
} from '../shared/product-api.js'
import { PreviewValidationError } from './preview-session-controller.js'
import { ProductConflictError, ProductController, ProductNotFoundError } from './product-controller.js'

export function registerProductIpcHandlers(
  ipc: IpcMain,
  getController: () => ProductController | undefined,
  assertTrustedRenderer: (event: IpcMainInvokeEvent) => void,
  requestExit: () => Promise<boolean>,
  openAppPanel: (view?: AppPanelView) => void,
  hideMiniPanel: () => void
): void {
  const controller = (): ProductController => {
    const value = getController()
    if (value === undefined) throw new ProductControllerUnavailableError()
    return value
  }

  register(ipc, productIpcChannels.getState, emptyRequestSchema, productStateResultSchema,
    assertTrustedRenderer, async () => controller().getState())
  register(ipc, productIpcChannels.createProfile, createProfileRequestSchema, profileResultSchema,
    assertTrustedRenderer, async (request) => controller().createProfile(request.name))
  register(ipc, productIpcChannels.saveProfile, saveProfileRequestSchema, profileResultSchema,
    assertTrustedRenderer, async (request) => controller().saveProfile(request.profile))
  register(ipc, productIpcChannels.duplicateProfile, profileIdRequestSchema, profileResultSchema,
    assertTrustedRenderer, async (request) => controller().duplicateProfile(request.profileId))
  register(ipc, productIpcChannels.deleteProfile, profileIdRequestSchema, booleanResultSchema,
    assertTrustedRenderer, async (request) => controller().deleteProfile(request.profileId))
  register(ipc, productIpcChannels.setDefaultProfile, setDefaultProfileRequestSchema, voidResultSchema,
    assertTrustedRenderer, async (request) => {
      await controller().setDefaultProfile(request.profileId)
      return null
    })
  register(ipc, productIpcChannels.activateProfile, profileIdRequestSchema, voidResultSchema,
    assertTrustedRenderer, async (request) => {
      await controller().activateProfile(request.profileId)
      return null
    })
  register(ipc, productIpcChannels.enableAutomatic, emptyRequestSchema, voidResultSchema,
    assertTrustedRenderer, async () => {
      await controller().enableAutomatic()
      return null
    })
  register(ipc, productIpcChannels.restoreBaseline, emptyRequestSchema, voidResultSchema,
    assertTrustedRenderer, async () => {
      await controller().restoreBaseline()
      return null
    })
  register(ipc, productIpcChannels.pickApplication, emptyRequestSchema,
    applicationSelectionResultSchema, assertTrustedRenderer,
    async () => controller().pickApplication())
  register(ipc, productIpcChannels.listApplications, emptyRequestSchema,
    applicationSelectionsResultSchema, assertTrustedRenderer,
    async () => controller().listApplications())
  register(ipc, productIpcChannels.updateSettings, appSettingsRequestSchema,
    appSettingsResultSchema, assertTrustedRenderer,
    async (request) => controller().updateSettings(request.settings))
  register(ipc, productIpcChannels.startPreview, startSessionRequestSchema, voidResultSchema,
    assertTrustedRenderer, async (request) => {
      await controller().startPreview(request.profile, request.kind)
      return null
    })
  register(ipc, productIpcChannels.updatePreview, previewUpdateRequestSchema, voidResultSchema,
    assertTrustedRenderer, async (request) => {
      await controller().updatePreview(request.profileId, request.color, request.displayIds)
      return null
    })
  register(ipc, productIpcChannels.confirmPreview, commitSessionRequestSchema, profileResultSchema,
    assertTrustedRenderer, async (request) =>
      controller().confirmPreview(request.profile, request.activation))
  register(ipc, productIpcChannels.cancelPreview, emptyRequestSchema, voidResultSchema,
    assertTrustedRenderer, async () => {
      await controller().cancelPreview()
      return null
    })
  register(ipc, productIpcChannels.requestExit, emptyRequestSchema, booleanResultSchema,
    assertTrustedRenderer, requestExit)
  register(ipc, productIpcChannels.openAppPanel, openAppPanelRequestSchema, voidResultSchema,
    assertTrustedRenderer, async (request) => {
      openAppPanel(request.view)
      return null
    })
  register(ipc, productIpcChannels.hideMiniPanel, emptyRequestSchema, voidResultSchema,
    assertTrustedRenderer, async () => {
      hideMiniPanel()
      return null
    })
}

function register<TRequest, TValue>(
  ipc: IpcMain,
  channel: string,
  requestSchema: z.ZodType<TRequest>,
  responseSchema: z.ZodType,
  assertTrustedRenderer: (event: IpcMainInvokeEvent) => void,
  operation: (request: TRequest) => Promise<TValue>
): void {
  ipc.handle(channel, async (event, input: unknown): Promise<unknown> => {
    assertTrustedRenderer(event)
    const request = requestSchema.safeParse(input)
    if (!request.success) {
      return responseSchema.parse({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'The request was invalid.',
          details: request.error.issues.map((issue) =>
            `${issue.path.join('.') || 'request'}: ${issue.message}`)
        }
      })
    }

    try {
      return responseSchema.parse({ ok: true, value: await operation(request.data) })
    } catch (error) {
      return responseSchema.parse({ ok: false, error: mapProductError(error) })
    }
  })
}

export function mapProductError(error: unknown): ProductError {
  if (error instanceof ProductControllerUnavailableError) {
    return { code: 'NATIVE_UNAVAILABLE', message: error.message }
  }
  if (error instanceof ProductNotFoundError) {
    return { code: 'NOT_FOUND', message: error.message }
  }
  if (error instanceof ProductConflictError) {
    return { code: 'CONFLICT', message: error.message }
  }
  if (error instanceof PreviewValidationError) {
    return { code: 'UNSUPPORTED', message: error.message }
  }
  if (error instanceof ConfigurationValidationError) {
    return {
      code: 'INVALID_REQUEST',
      message: error.message,
      ...(error.details.length === 0 ? {} : { details: [...error.details] })
    }
  }
  if (error instanceof z.ZodError) {
    return {
      code: 'INVALID_REQUEST',
      message: 'The profile contains invalid values.',
      details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    }
  }
  if (error instanceof NativeServiceError) {
    return {
      code: error.code === 'CAPABILITY_UNSUPPORTED' ? 'UNSUPPORTED' : 'OPERATION_FAILED',
      message: error.message
    }
  }
  return {
    code: 'OPERATION_FAILED',
    message: error instanceof Error ? error.message : String(error)
  }
}

class ProductControllerUnavailableError extends Error {
  public constructor() {
    super('Display profile controls are unavailable while the native service is offline.')
    this.name = 'ProductControllerUnavailableError'
  }
}
