import { contextBridge, ipcRenderer } from 'electron'
import type { ColorProfile } from '@chromashift/core'
import type { z } from 'zod'
import {
  applicationSelectionResultSchema,
  applicationSelectionsResultSchema,
  appPanelViewSchema,
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
  productStateSchema,
  profileIdRequestSchema,
  profileResultSchema,
  saveProfileRequestSchema,
  setDefaultProfileRequestSchema,
  voidResultSchema,
  type ChromaShiftApi
} from '../shared/product-api.js'

async function invoke<TRequest, TResult>(
  channel: string,
  requestSchema: z.ZodType<TRequest>,
  resultSchema: z.ZodType<TResult>,
  request: TRequest
): Promise<TResult> {
  const validatedRequest = requestSchema.parse(request)
  const response: unknown = await ipcRenderer.invoke(channel, validatedRequest)
  return resultSchema.parse(response)
}

const api: ChromaShiftApi = {
  getState: () => invoke(
    productIpcChannels.getState,
    emptyRequestSchema,
    productStateResultSchema,
    {}
  ),
  createProfile: (name) => invoke(
    productIpcChannels.createProfile,
    createProfileRequestSchema,
    profileResultSchema,
    { name }
  ),
  saveProfile: (profile) => invoke(
    productIpcChannels.saveProfile,
    saveProfileRequestSchema,
    profileResultSchema,
    { profile }
  ),
  duplicateProfile: (profileId) => invoke(
    productIpcChannels.duplicateProfile,
    profileIdRequestSchema,
    profileResultSchema,
    { profileId }
  ),
  deleteProfile: (profileId) => invoke(
    productIpcChannels.deleteProfile,
    profileIdRequestSchema,
    booleanResultSchema,
    { profileId }
  ),
  setDefaultProfile: (profileId) => invoke(
    productIpcChannels.setDefaultProfile,
    setDefaultProfileRequestSchema,
    voidResultSchema,
    { profileId }
  ),
  activateProfile: (profileId) => invoke(
    productIpcChannels.activateProfile,
    profileIdRequestSchema,
    voidResultSchema,
    { profileId }
  ),
  enableAutomatic: () => invoke(
    productIpcChannels.enableAutomatic,
    emptyRequestSchema,
    voidResultSchema,
    {}
  ),
  restoreBaseline: () => invoke(
    productIpcChannels.restoreBaseline,
    emptyRequestSchema,
    voidResultSchema,
    {}
  ),
  pickApplication: () => invoke(
    productIpcChannels.pickApplication,
    emptyRequestSchema,
    applicationSelectionResultSchema,
    {}
  ),
  listApplications: () => invoke(
    productIpcChannels.listApplications,
    emptyRequestSchema,
    applicationSelectionsResultSchema,
    {}
  ),
  updateSettings: (settings) => invoke(
    productIpcChannels.updateSettings,
    appSettingsRequestSchema,
    appSettingsResultSchema,
    { settings }
  ),
  startPreview: (profile, kind) => invoke(
    productIpcChannels.startPreview,
    startSessionRequestSchema,
    voidResultSchema,
    { profile, kind }
  ),
  updatePreview: (profileId, color, displayIds) => invoke(
    productIpcChannels.updatePreview,
    previewUpdateRequestSchema,
    voidResultSchema,
    { profileId, color, displayIds }
  ),
  confirmPreview: (profile, activation) => invoke(
    productIpcChannels.confirmPreview,
    commitSessionRequestSchema,
    profileResultSchema,
    { profile, activation }
  ),
  cancelPreview: () => invoke(
    productIpcChannels.cancelPreview,
    emptyRequestSchema,
    voidResultSchema,
    {}
  ),
  requestExit: () => invoke(
    productIpcChannels.requestExit,
    emptyRequestSchema,
    booleanResultSchema,
    {}
  ),
  openAppPanel: (view) => invoke(
    productIpcChannels.openAppPanel,
    openAppPanelRequestSchema,
    voidResultSchema,
    { view }
  ),
  onStateChanged: (listener) => {
    ipcRenderer.removeAllListeners(productIpcChannels.stateChanged)
    ipcRenderer.on(productIpcChannels.stateChanged, (_event, input: unknown) => {
      const state = productStateSchema.safeParse(input)
      if (state.success) listener(state.data)
      else console.error('Rejected invalid product state event.', state.error)
    })
  },
  onAppPanelNavigation: (listener) => {
    ipcRenderer.removeAllListeners(productIpcChannels.navigateAppPanel)
    ipcRenderer.on(productIpcChannels.navigateAppPanel, (_event, input: unknown) => {
      const view = appPanelViewSchema.safeParse(input)
      if (view.success) listener(view.data)
      else console.error('Rejected invalid app-panel navigation event.', view.error)
    })
  }
}

contextBridge.exposeInMainWorld('chromaShift', api)

export type { ChromaShiftApi, ColorProfile }
