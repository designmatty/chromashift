import { contextBridge, ipcRenderer } from 'electron'
import type { ColorProfile } from '@chromashift/core'
import type { z } from 'zod'
import {
  applicationSelectionResultSchema,
  applicationSelectionsResultSchema,
  appPanelViewSchema,
  userPreferencesRequestSchema,
  userPreferencesResultSchema,
  booleanResultSchema,
  createProfileRequestSchema,
  controlChromaShiftRequestSchema,
  diagnosticLogEntriesResultSchema,
  emptyRequestSchema,
  openAppPanelRequestSchema,
  setMiniPanelViewRequestSchema,
  commitSessionRequestSchema,
  startSessionRequestSchema,
  previewUpdateRequestSchema,
  productIpcChannels,
  productStateResultSchema,
  productStateSchema,
  profileIdRequestSchema,
  profileResultSchema,
  reorderProfilesRequestSchema,
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
  getState: () =>
    invoke(productIpcChannels.getState, emptyRequestSchema, productStateResultSchema, {}),
  createProfile: (name) =>
    invoke(productIpcChannels.createProfile, createProfileRequestSchema, profileResultSchema, {
      name
    }),
  saveProfile: (profile, removeShortcut) =>
    invoke(productIpcChannels.saveProfile, saveProfileRequestSchema, profileResultSchema, {
      profile,
      removeShortcut
    }),
  duplicateProfile: (profileId) =>
    invoke(productIpcChannels.duplicateProfile, profileIdRequestSchema, profileResultSchema, {
      profileId
    }),
  deleteProfile: (profileId) =>
    invoke(productIpcChannels.deleteProfile, profileIdRequestSchema, booleanResultSchema, {
      profileId
    }),
  reorderProfiles: (profileIds) =>
    invoke(productIpcChannels.reorderProfiles, reorderProfilesRequestSchema, voidResultSchema, {
      profileIds
    }),
  setDefaultProfile: (profileId) =>
    invoke(productIpcChannels.setDefaultProfile, setDefaultProfileRequestSchema, voidResultSchema, {
      profileId
    }),
  activateProfile: (profileId) =>
    invoke(productIpcChannels.activateProfile, profileIdRequestSchema, voidResultSchema, {
      profileId
    }),
  enableAutomatic: () =>
    invoke(productIpcChannels.enableAutomatic, emptyRequestSchema, voidResultSchema, {}),
  restoreBaseline: () =>
    invoke(productIpcChannels.restoreBaseline, emptyRequestSchema, voidResultSchema, {}),
  controlChromaShift: (action) =>
    invoke(
      productIpcChannels.controlChromaShift,
      controlChromaShiftRequestSchema,
      voidResultSchema,
      { action }
    ),
  pickApplication: () =>
    invoke(
      productIpcChannels.pickApplication,
      emptyRequestSchema,
      applicationSelectionResultSchema,
      {}
    ),
  listApplications: () =>
    invoke(
      productIpcChannels.listApplications,
      emptyRequestSchema,
      applicationSelectionsResultSchema,
      {}
    ),
  getDiagnostics: () =>
    invoke(
      productIpcChannels.getDiagnostics,
      emptyRequestSchema,
      diagnosticLogEntriesResultSchema,
      {}
    ),
  updateSettings: (settings) =>
    invoke(
      productIpcChannels.updateSettings,
      userPreferencesRequestSchema,
      userPreferencesResultSchema,
      {
        settings
      }
    ),
  startPreview: (profile, kind) =>
    invoke(productIpcChannels.startPreview, startSessionRequestSchema, voidResultSchema, {
      profile,
      kind
    }),
  updatePreview: (profileId, targets) =>
    invoke(productIpcChannels.updatePreview, previewUpdateRequestSchema, voidResultSchema, {
      profileId,
      targets
    }),
  confirmPreview: (profile, activation) =>
    invoke(productIpcChannels.confirmPreview, commitSessionRequestSchema, profileResultSchema, {
      profile,
      activation
    }),
  cancelPreview: () =>
    invoke(productIpcChannels.cancelPreview, emptyRequestSchema, voidResultSchema, {}),
  requestExit: () =>
    invoke(productIpcChannels.requestExit, emptyRequestSchema, booleanResultSchema, {}),
  openAppPanel: (view) =>
    invoke(productIpcChannels.openAppPanel, openAppPanelRequestSchema, voidResultSchema, { view }),
  hideMiniPanel: () =>
    invoke(productIpcChannels.hideMiniPanel, emptyRequestSchema, voidResultSchema, {}),
  showMiniPanel: () =>
    invoke(productIpcChannels.showMiniPanel, emptyRequestSchema, voidResultSchema, {}),
  openMiniPanelDevTools: () =>
    invoke(productIpcChannels.openMiniPanelDevTools, emptyRequestSchema, voidResultSchema, {}),
  setMiniPanelView: (view) =>
    invoke(productIpcChannels.setMiniPanelView, setMiniPanelViewRequestSchema, voidResultSchema, {
      view
    }),
  onStateChanged: (listener) => {
    ipcRenderer.removeAllListeners(productIpcChannels.stateChanged)
    ipcRenderer.on(productIpcChannels.stateChanged, (_event, input: unknown) => {
      const state = productStateSchema.safeParse(input)
      if (state.success) listener(state.data)
      else console.error('Rejected invalid product state event.', state.error)
    })
  },
  onAppPanelClosed: (listener) => {
    ipcRenderer.removeAllListeners(productIpcChannels.appPanelClosed)
    ipcRenderer.on(productIpcChannels.appPanelClosed, () => listener())
  },
  onAppPanelNavigation: (listener) => {
    ipcRenderer.removeAllListeners(productIpcChannels.navigateAppPanel)
    ipcRenderer.on(productIpcChannels.navigateAppPanel, (_event, input: unknown) => {
      const view = appPanelViewSchema.safeParse(input)
      if (view.success) listener(view.data)
      else console.error('Rejected invalid app-panel navigation event.', view.error)
    })
  },
  onAppPanelProfileSelection: (listener) => {
    ipcRenderer.removeAllListeners(productIpcChannels.selectAppPanelProfile)
    ipcRenderer.on(productIpcChannels.selectAppPanelProfile, (_event, input: unknown) => {
      const request = profileIdRequestSchema.safeParse(input)
      if (request.success) listener(request.data.profileId)
      else console.error('Rejected invalid app-panel profile selection event.', request.error)
    })
  }
}

contextBridge.exposeInMainWorld('chromaShift', api)

export type { ChromaShiftApi, ColorProfile }
