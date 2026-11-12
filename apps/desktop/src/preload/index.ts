import { contextBridge, ipcRenderer } from 'electron'
import type { ColorProfile } from '@chromashift/core'
import type { z } from 'zod'
import {
  applicationSelectionResultSchema,
  applicationSelectionsResultSchema,
  appPanelViewSchema,
  userPreferencesRequestSchema,
  userPreferencesResultSchema,
  updateStatusResultSchema,
  updateCheckResultSchema,
  booleanResultSchema,
  createProfileRequestSchema,
  controlChromaShiftRequestSchema,
  diagnosticLogEntriesResultSchema,
  profileReorderDiagnosticSchema,
  emptyRequestSchema,
  externalLinkRequestSchema,
  endPreviewRequestSchema,
  panelLifetimeEventSchema,
  scopedPreviewRequestSchema,
  openAppPanelRequestSchema,
  setMiniPanelViewRequestSchema,
  commitSessionRequestSchema,
  startSessionRequestSchema,
  previewUpdateRequestSchema,
  previewCompareRequestSchema,
  previewDraftFlushSchema,
  productIpcChannels,
  productStateResultSchema,
  productStateSchema,
  profileIdRequestSchema,
  displayLimitsResetRequestSchema,
  profileResultSchema,
  reorderProfilesRequestSchema,
  saveProfileRequestSchema,
  setDefaultProfileRequestSchema,
  voidResultSchema,
  type AppPanelView,
  type ChromaShiftApi,
  type EndPreviewRequest
} from '@shared/product-api.js'
import { LatestEventRelay } from '@shared/latest-event-relay.js'

// Main may request app-panel navigation before the renderer has mounted its
// listener (a fresh renderer waits for DisplayService and the lazy app chunk).
// Listen from preload time and keep the latest request until the app subscribes.
const appPanelNavigation = new LatestEventRelay<AppPanelView>()
const appPanelProfileSelection = new LatestEventRelay<string>()
const endPreviewRequests = new LatestEventRelay<EndPreviewRequest>()
let panelLifetime: number | null = null
ipcRenderer.on(productIpcChannels.endPreviewRequested, (_event, input: unknown) => {
  const request = endPreviewRequestSchema.safeParse(input)
  if (request.success) endPreviewRequests.publish(request.data)
})
ipcRenderer.on(productIpcChannels.panelLifetimeChanged, (_event, input: unknown) => {
  const event = panelLifetimeEventSchema.safeParse(input)
  if (event.success) panelLifetime = event.data.lifetime
})

ipcRenderer.on(productIpcChannels.navigateAppPanel, (_event, input: unknown) => {
  const view = appPanelViewSchema.safeParse(input)
  if (view.success) appPanelNavigation.publish(view.data)
  else console.error('Rejected invalid app-panel navigation event.', view.error)
})

ipcRenderer.on(productIpcChannels.selectAppPanelProfile, (_event, input: unknown) => {
  const request = profileIdRequestSchema.safeParse(input)
  if (request.success) appPanelProfileSelection.publish(request.data.profileId)
  else console.error('Rejected invalid app-panel profile selection event.', request.error)
})

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
  openExternalLink: (link) => invoke(productIpcChannels.openExternalLink, externalLinkRequestSchema, voidResultSchema, { link }),
  onEndPreviewRequested: (listener) => endPreviewRequests.subscribe((request) => {
    if (request.lifetime === panelLifetime) listener(request)
  }),
  getPanelLifetime: () => panelLifetime,
  onPanelClosing: (listener) => {
    const receive = (_event: unknown, input: unknown): void => {
      const event = panelLifetimeEventSchema.safeParse(input)
      if (event.success && event.data.lifetime === null) listener()
    }
    ipcRenderer.on(productIpcChannels.panelLifetimeChanged, receive)
    return () => ipcRenderer.removeListener(productIpcChannels.panelLifetimeChanged, receive)
  },
  getState: () =>
    invoke(productIpcChannels.getState, emptyRequestSchema, productStateResultSchema, {}),
  openProfile: (profileId) =>
    invoke(productIpcChannels.openProfile, profileIdRequestSchema, profileResultSchema, {
      profileId
    }),
  resetLearnedLimits: (displayId) =>
    invoke(
      productIpcChannels.resetLearnedLimits,
      displayLimitsResetRequestSchema,
      voidResultSchema,
      { displayId }
    ),
  getUpdateStatus: () =>
    invoke(productIpcChannels.getUpdateStatus, emptyRequestSchema, updateStatusResultSchema, {}),
  checkForUpdates: () =>
    invoke(productIpcChannels.checkForUpdates, emptyRequestSchema, updateCheckResultSchema, {}),
  installUpdate: () =>
    invoke(productIpcChannels.installUpdate, emptyRequestSchema, booleanResultSchema, {}),
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
  reorderProfiles: (profileIds, interactionId) =>
    invoke(productIpcChannels.reorderProfiles, reorderProfilesRequestSchema, voidResultSchema, {
      profileIds,
      interactionId
    }),
  setDefaultProfile: (profileId) =>
    invoke(productIpcChannels.setDefaultProfile, setDefaultProfileRequestSchema, voidResultSchema, {
      profileId
    }),
  activateProfile: (profileId, lifetime) =>
    invokePreview(
      productIpcChannels.activateProfile,
      profileIdRequestSchema,
      voidResultSchema,
      {
        profileId
      },
      lifetime
    ),
  enableAutomatic: (lifetime) =>
    invokePreview(
      productIpcChannels.enableAutomatic,
      emptyRequestSchema,
      voidResultSchema,
      {},
      lifetime
    ),
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
  copyDiagnostics: () =>
    invoke(productIpcChannels.copyDiagnostics, emptyRequestSchema, voidResultSchema, {}),
  downloadDiagnostics: () =>
    invoke(productIpcChannels.downloadDiagnostics, emptyRequestSchema, booleanResultSchema, {}),
  clearDiagnostics: () =>
    invoke(productIpcChannels.clearDiagnostics, emptyRequestSchema, voidResultSchema, {}),
  recordProfileReorder: (event) =>
    invoke(
      productIpcChannels.recordProfileReorder,
      profileReorderDiagnosticSchema,
      voidResultSchema,
      event
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
  startPreview: (profile, kind, lifetime) =>
    invokePreview(
      productIpcChannels.startPreview,
      startSessionRequestSchema,
      voidResultSchema,
      {
        profile,
        kind
      },
      lifetime
    ),
  updatePreview: (profileId, targets, draft, lifetime) =>
    invokePreview(
      productIpcChannels.updatePreview,
      previewUpdateRequestSchema,
      voidResultSchema,
      {
        profileId,
        targets,
        ...(draft === undefined ? {} : { draft })
      },
      lifetime
    ),
  setPreviewCompare: (profileId, showing, sessionId, lifetime) =>
    invokePreview(productIpcChannels.setPreviewCompare, previewCompareRequestSchema, voidResultSchema, { profileId, showing, sessionId }, lifetime),
  confirmPreview: (profile, activation) =>
    invokePreview(
      productIpcChannels.confirmPreview,
      commitSessionRequestSchema,
      profileResultSchema,
      {
        profile,
        activation
      }
    ),
  cancelPreview: (lifetime) =>
    invokePreview(
      productIpcChannels.cancelPreview,
      emptyRequestSchema,
      voidResultSchema,
      {},
      lifetime
    ),
  requestExit: () =>
    invoke(productIpcChannels.requestExit, emptyRequestSchema, booleanResultSchema, {}),
  openAppPanel: (view) =>
    invoke(productIpcChannels.openAppPanel, openAppPanelRequestSchema, voidResultSchema, { view }),
  hideMiniPanel: () =>
    invokePreview(productIpcChannels.hideMiniPanel, emptyRequestSchema, voidResultSchema, {}),
  showMiniPanel: () =>
    invoke(productIpcChannels.showMiniPanel, emptyRequestSchema, voidResultSchema, {}),
  openMiniPanelDevTools: () =>
    invoke(productIpcChannels.openMiniPanelDevTools, emptyRequestSchema, voidResultSchema, {}),
  setMiniPanelView: (view, showColorTemperature) =>
    invoke(productIpcChannels.setMiniPanelView, setMiniPanelViewRequestSchema, voidResultSchema, {
      view,
      showColorTemperature
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
  onAppPanelMinimized: (listener) => {
    ipcRenderer.removeAllListeners(productIpcChannels.appPanelMinimized)
    ipcRenderer.on(productIpcChannels.appPanelMinimized, (_event, input: unknown) => {
      const request = emptyRequestSchema.safeParse(input)
      if (request.success) listener()
      else console.error('Rejected invalid app-panel minimize event.', request.error)
    })
  },
  onFlushPreviewDraft: (listener) => {
    const receive = (_event: unknown, input: unknown): void => {
      const request = previewDraftFlushSchema.safeParse(input)
      if (!request.success) return
      void listener()
        .then(() => {
          ipcRenderer.send(
            productIpcChannels.previewDraftFlushed,
            previewDraftFlushSchema.parse(request.data)
          )
        })
        .catch((error: unknown) => console.error('Could not flush the preview draft.', error))
    }
    ipcRenderer.on(productIpcChannels.flushPreviewDraft, receive)
    return () => ipcRenderer.removeListener(productIpcChannels.flushPreviewDraft, receive)
  },
  onAppPanelNavigation: (listener) => appPanelNavigation.subscribe(listener),
  onAppPanelProfileSelection: (listener) => appPanelProfileSelection.subscribe(listener)
}

contextBridge.exposeInMainWorld('chromaShift', api)

async function invokePreview<TRequest, TValue>(
  channel: string,
  requestSchema: z.ZodType<TRequest>,
  resultSchema: z.ZodType<import('@shared/product-api.js').ProductResult<TValue>>,
  request: TRequest,
  lifetime?: number
): Promise<import('@shared/product-api.js').ProductResult<TValue>> {
  if (lifetime === undefined) {
    if (panelLifetime === null) {
      return {
        ok: false,
        error: { code: 'CONFLICT', message: 'This panel has closed. Reopen it to preview changes.' }
      }
    }
    lifetime = panelLifetime
  }
  return invoke(channel, scopedPreviewRequestSchema(requestSchema), resultSchema, {
    lifetime,
    request
  })
}

export type { ChromaShiftApi, ColorProfile }
