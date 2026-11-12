import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import {
  PROTOCOL_VERSION,
  type DisplayTopologyRefreshResult,
  type ForegroundApplication,
  type NativeEvent,
  type ServiceHealth,
  type SystemInfo
} from '@chromashift/native-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { productIpcChannels, type UserPreferences } from '@shared/product-api.js'
import { registerProductIpcHandlers } from '@main/product-ipc.js'
import { DiagnosticsService } from '@main/diagnostics-service.js'
import { AppUpdateService } from '@main/app-update-service.js'
import { UpdateChecker } from '@main/update-checker.js'
import type { ProductNotification } from '@main/profile-notification-controller.js'
import {
  defaultChromaShiftIntent,
  defaultUserPreferences,
  type ChromaShiftIntent
} from '@main/app-settings.js'
import {
  createProductRuntime,
  type ProductRuntime,
  type ProductRuntimePorts
} from '@main/product-runtime.js'
import type { StructuredLogEvent, StructuredLogger } from '@main/structured-logger.js'
import type { TrayCommands, TrayReadModel } from '@main/tray-controller.js'
import { FakeNativeDisplayPort } from '@main/testing/fake-native-display.js'
import { PreviewRestoreError } from '@main/preview-session-controller.js'
import { AppPanelCloseController } from '@main/app-panel-close-controller.js'
import { PanelController } from '@main/panel-controller.js'

class RecordingLogger implements StructuredLogger {
  public readonly events: StructuredLogEvent[] = []

  public write(event: StructuredLogEvent): void {
    this.events.push(event)
  }

  public has(eventName: string): boolean {
    return this.events.some((event) => event.eventName === eventName)
  }
}

class FakeRuntimeNativeClient extends FakeNativeDisplayPort {
  public foregroundApplication: ForegroundApplication | null = null
  public startFailure: Error | undefined
  public watchdogArmed = true
  public readonly potentialBaselineDisplayIds: string[] = []
  public readonly running = true

  private eventHandler: ((event: NativeEvent) => void) | undefined
  private readonly exitHandlers: Array<() => void> = []

  public on(
    name: string,
    handler:
      | ((event: NativeEvent) => void)
      | ((message: string) => void)
      | ((code: number | null, signal: NodeJS.Signals | null) => void)
  ): this {
    if (name === 'event') this.eventHandler = handler as (event: NativeEvent) => void
    if (name === 'exit') this.exitHandlers.push(handler as () => void)
    return this
  }

  public emitForegroundApplication(application: ForegroundApplication): void {
    this.eventHandler!({ event: 'foregroundApplicationChanged', data: { application } })
  }

  public emitExit(): void {
    for (const handler of this.exitHandlers) handler()
  }

  public async start(): Promise<SystemInfo> {
    if (this.startFailure !== undefined) throw this.startFailure
    return {
      protocolVersion: PROTOCOL_VERSION,
      serviceVersion: '1.0-test',
      operatingSystem: 'test',
      processId: 4242,
      providers: {
        amd: {
          libraryAvailable: false,
          initialized: false,
          displayCount: 0,
          runtimeValidation: 'skipped'
        }
      }
    }
  }

  public async getServiceHealth(): Promise<ServiceHealth> {
    return {
      status: 'healthy',
      protocolVersion: PROTOCOL_VERSION,
      serviceVersion: '1.0-test',
      processId: 4242,
      serviceInstanceId: 'test-instance',
      baselineOwnerId: 'test-owner',
      baselineCount: 0,
      watchdogArmed: this.watchdogArmed
    }
  }

  public getForegroundApplication(): Promise<ForegroundApplication | null> {
    return Promise.resolve(this.foregroundApplication)
  }

  public getVisibleApplications(): Promise<ForegroundApplication[]> {
    return Promise.resolve([])
  }

  public async refreshDisplayTopology(): Promise<DisplayTopologyRefreshResult> {
    return {
      generation: 1,
      displays: await this.getDisplays(),
      capabilityReports: [],
      baselines: []
    }
  }

  public stop(): Promise<void> {
    return Promise.resolve()
  }
}

const directories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function createHarness(
  intentOverrides: Partial<ChromaShiftIntent> = {},
  options: {
    profiles?: ColorProfile[]
    foregroundApplication?: ForegroundApplication
    confirmUnsavedQuit?: ProductRuntimePorts['dialogs']['confirmUnsavedQuit']
    preferences?: Partial<UserPreferences>
    displayLimits?: unknown
    profilesDocument?: unknown
  } = {}
): Promise<{
  runtime: ProductRuntime
  client: FakeRuntimeNativeClient
  logger: RecordingLogger
  trayMenusCreated: () => number
  intent: () => ChromaShiftIntent
  errors: Array<{ title: string; message: string }>
  displayEvent: (event: 'displayAdded' | 'displayRemoved' | 'displayMetricsChanged') => void
  emergencyRestore: () => void
  trayCommands: () => TrayCommands
  trayModel: () => TrayReadModel
  openAppPanel: ReturnType<typeof vi.fn>
  requestEndPreview: ReturnType<typeof vi.fn>
  configurationPath: string
  notifications: Array<ProductNotification & { status: ChromaShiftIntent['chromaShiftStatus'] }>
  invokeRestore: () => Promise<unknown>
  invokeActivate: (profileId: string) => Promise<unknown>
  invokeAutomatic: () => Promise<unknown>
  pressShortcut: (accelerator: string) => void
}> {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-runtime-'))
  directories.push(directory)
  if (options.displayLimits !== undefined)
    await writeFile(join(directory, 'display-limits.json'), JSON.stringify(options.displayLimits))
  await writeFile(
    join(directory, 'profiles.json'),
    JSON.stringify(
      options.profilesDocument ?? {
        schemaVersion: 2,
        profiles: [
          {
            id: 'default',
            name: 'Default',
            enabled: true,
            applications: [],
            displays: [{ displayId: 'display:one', color: { brightness: 60 } }]
          },
          ...(options.profiles ?? [])
        ],
        settings: { defaultProfileId: 'default' }
      }
    )
  )

  const client = new FakeRuntimeNativeClient()
  client.foregroundApplication = options.foregroundApplication ?? null
  const logger = new RecordingLogger()
  let preferences: UserPreferences = {
    ...defaultUserPreferences,
    notificationsEnabled: true,
    ...options.preferences
  }
  let intent: ChromaShiftIntent = { ...defaultChromaShiftIntent, ...intentOverrides }
  let trayMenus = 0
  const errors: Array<{ title: string; message: string }> = []
  let displayEventListener: Parameters<ProductRuntimePorts['system']['onDisplayEvent']>[0] = () =>
    undefined
  let emergencyHandler: (() => void) | undefined
  let trayCommands: TrayCommands | undefined
  let trayModel: TrayReadModel | undefined
  const openAppPanel = vi.fn()
  const requestEndPreview = vi.fn()
  const shortcutHandlers = new Map<string, () => void>()
  const notifications: Array<
    ProductNotification & { status: ChromaShiftIntent['chromaShiftStatus'] }
  > = []
  const ports: ProductRuntimePorts = {
    logger,
    configuration: {
      profileConfigurationPath: join(directory, 'profiles.json'),
      legacyProfileConfigurationPaths: [],
      appVersion: '0.0.0-test'
    },
    native: { createClient: () => client },
    settings: {
      preferences: {
        current: () => preferences,
        get: () => Promise.resolve(preferences),
        update: (updater) => {
          preferences = updater(preferences)
          return Promise.resolve(preferences)
        },
        applyToShell: () => undefined
      },
      chromaShiftIntent: {
        current: () => intent,
        update: (updater) => {
          intent = updater(intent)
          return Promise.resolve(intent)
        }
      }
    },
    shell: {
      getAppPanelLifetime: () => 21,
      requestEndPreview,
      openWindow: () => undefined,
      openProfile: () => undefined,
      openAppPanel,
      openMiniPanel: () => undefined,
      createTrayMenu: () => {
        trayMenus += 1
        return Promise.resolve({
          update: (model, commands) => {
            trayModel = model
            trayCommands = commands
          },
          showError: () => undefined,
          destroy: () => undefined
        })
      },
      broadcastProductState: () => undefined
    },
    dialogs: {
      showError: (title, message) => {
        errors.push({ title, message })
      },
      confirmUnsavedQuit: options.confirmUnsavedQuit ?? (() => Promise.resolve('cancel')),
      confirmShutdownRetry: () => Promise.resolve('cancel'),
      warnShortcutsUnavailable: () => undefined,
      pickApplicationFile: () => Promise.resolve(null)
    },
    icons: { applicationIconDataUrl: () => Promise.resolve(null) },
    system: {
      application: { exit: () => undefined },
      shortcutRegistrations: {
        register: (accelerator, handler) => {
          shortcutHandlers.set(accelerator, handler)
          return true
        },
        unregister: (accelerator) => {
          shortcutHandlers.delete(accelerator)
        }
      },
      powerMonitor: { on: () => undefined, off: () => undefined },
      registerEmergencyRestoreShortcut: (handler) => {
        emergencyHandler = handler
        return true
      },
      onDisplayEvent: (listener) => {
        displayEventListener = listener
      }
    },
    notifications: {
      isSupported: () => true,
      show: (message) => notifications.push({ ...message, status: intent.chromaShiftStatus })
    }
  }
  const runtime = createProductRuntime(ports)
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>
  >()
  registerProductIpcHandlers(
    {
      handle: (
        name: string,
        handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>
      ) => handlers.set(name, handler)
    } as unknown as IpcMain,
    () => runtime.productController,
    () => undefined,
    async () => true,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => [],
    new DiagnosticsService({
      read: () => [],
      copy: () => undefined,
      download: async () => false,
      clear: () => undefined,
      context: () => ({}),
      logger
    }),
    new AppUpdateService({
      checker: new UpdateChecker({
        currentVersion: '0.0.0-test',
        fetch: async () => Response.json([])
      }),
      requestExit: async () => true
    }),
    { get: () => 1, assert: () => undefined }
  )
  return {
    runtime,
    client,
    logger,
    trayMenusCreated: () => trayMenus,
    intent: () => intent,
    errors,
    displayEvent: (event) => displayEventListener(event),
    emergencyRestore: () => emergencyHandler!(),
    trayCommands: () => trayCommands!,
    trayModel: () => trayModel!,
    openAppPanel,
    requestEndPreview,
    configurationPath: join(directory, 'profiles.json'),
    notifications,
    invokeRestore: () =>
      handlers.get(productIpcChannels.restoreBaseline)!({} as IpcMainInvokeEvent, {}),
    invokeActivate: (profileId) =>
      handlers.get(productIpcChannels.activateProfile)!({} as IpcMainInvokeEvent, {
        lifetime: 1,
        request: { profileId }
      }),
    invokeAutomatic: () =>
      handlers.get(productIpcChannels.enableAutomatic)!({} as IpcMainInvokeEvent, {
        lifetime: 1,
        request: {}
      }),
    pressShortcut: (accelerator) => shortcutHandlers.get(accelerator)!()
  }
}

it.each(['inactive', 'preview', 'edit'] as const)('routes the registered End preview shortcut without an independent rollback: %s', async (kind) => {
  const h = await createHarness({}, { preferences: { shortcutBindings: [{ action: { kind: 'endPreview' }, accelerator: 'CommandOrControl+E' }] } })
  try {
    await h.runtime.start()
    if (kind !== 'inactive') {
      const saved = (await h.runtime.productController!.getState()).configuration.profiles[0]!
      await h.runtime.productController!.startPreview(kind === 'edit' ? { ...saved, name: 'Unsaved name' } : saved, kind)
    }
    const before = [...h.client.calls]
    h.pressShortcut('CommandOrControl+E')
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    if (kind === 'inactive') expect(h.requestEndPreview).not.toHaveBeenCalled()
    else expect(h.requestEndPreview).toHaveBeenCalledExactlyOnceWith({ lifetime: 21, sessionId: 1, profileId: 'default' }, kind === 'edit')
    expect(h.client.calls).toEqual(before)
  } finally {
    h.runtime.dispose()
  }
})

it('reports invalid learned-limit configuration before any automatic display writer starts', async () => {
  const h = await createHarness({}, { displayLimits: { schemaVersion: 999, displays: {} } })
  try {
    await h.runtime.start()
    expect(h.client.calls).toEqual([])
    expect(h.runtime.productController).toBeDefined()
    expect(h.logger.has('DisplayLimitsConfigurationInvalid')).toBe(true)
    expect(h.errors).toContainEqual({
      title: 'Display limits could not be loaded',
      message: expect.stringContaining('display-limits.json was left unchanged')
    })
  } finally {
    h.runtime.dispose()
  }
})

describe('product runtime startup wiring', () => {
  it('saves the main-owned override draft before restore-safe quit without a renderer', async () => {
    const decide = vi.fn(async () => 'update' as const)
    const harness = await createHarness({}, { confirmUnsavedQuit: decide })
    await harness.runtime.start()
    const product = harness.runtime.productController!
    const saved = (await product.getState()).configuration.profiles[0]!
    const draft = { ...saved, name: 'Unsaved quit name' }
    await product.startPreview(draft, 'override')
    const stop = vi.spyOn(harness.client, 'stop')
    expect(await harness.runtime.shutdownCoordinator!.request('tray')).toBe(true)
    expect(decide).toHaveBeenCalledWith(draft.name)
    expect((await product.getState()).configuration.profiles[0]!.name).toBe(draft.name)
    expect(stop).toHaveBeenCalledOnce()
    expect(harness.logger.has('ApplicationExiting')).toBe(true)
    await harness.runtime.dispose()
  })

  it.each(['update', 'discard', 'cancel'] as const)(
    'keeps the existing %s quit decision for dirty Edit and override with fake native restoration',
    async (decision) => {
      for (const kind of ['edit', 'override'] as const) {
        const decide = vi.fn(async () => decision)
        const h = await createHarness({}, { confirmUnsavedQuit: decide })
        await h.runtime.start()
        const product = h.runtime.productController!
        const saved = (await product.getState()).configuration.profiles[0]!
        const draft = {
          ...saved,
          name: 'Unsaved quit check',
          displays: [
            { displayId: 'display:one', color: { ...createNeutralColorSettings(), brightness: 40 } }
          ]
        }
        try {
          await product.startPreview(draft, kind)
          await product.setPreviewCompare(saved.id, true)
          expect((await product.getState()).preview).toMatchObject({
            comparing: true,
            draft,
            unsavedChanges: true
          })
          const stop = vi.spyOn(h.client, 'stop').mockImplementation(async () => {
            await h.client.restoreAllBaselines()
          })
          expect(await h.runtime.shutdownCoordinator!.request('tray')).toBe(decision !== 'cancel')
          expect(decide).toHaveBeenCalledWith(draft.name)
          expect((await product.getState()).configuration.profiles[0]).toEqual(
            decision === 'update' ? draft : saved
          )
          if (decision === 'cancel') {
            expect(stop).not.toHaveBeenCalled()
            expect((await product.getState()).preview).toMatchObject({
              state: 'active',
              kind,
              comparing: false,
              draft
            })
            expect(h.client.currentSettings.get('display:one')?.brightness).toBe(40)
          } else {
            expect(stop).toHaveBeenCalledOnce()
            expect(h.client.currentSettings.get('display:one')).toEqual({})
          }
        } finally {
          h.runtime.dispose()
        }
      }
    }
  )

  it('keeps a failed reconnect preview and surfaces it through the product error dialog', async () => {
    const empty: ColorProfile = {
      id: 'empty',
      name: 'Empty',
      enabled: true,
      applications: [],
      displays: []
    }
    const harness = await createHarness({}, { profiles: [empty] })
    await harness.runtime.start()
    harness.client.disconnectedDisplayIds.add('display:one')
    await harness.runtime.previewController!.start(empty, 'preview')
    harness.client.disconnectedDisplayIds.delete('display:one')
    harness.client.failRestoreDisplayIds.add('display:one')
    vi.useFakeTimers()

    try {
      harness.displayEvent('displayAdded')
      await vi.advanceTimersByTimeAsync(750)
      await vi.waitFor(() =>
        expect(harness.errors).toEqual([
          {
            title: 'Display preview failed',
            message:
              'ChromaShift kept your preview and unsaved changes. Use Retry to restore display control. Check Diagnostics for details.'
          }
        ])
      )

      expect((await harness.runtime.productController!.getState()).preview).toMatchObject({
        state: 'active',
        draft: empty
      })
      expect(harness.client.currentSettings.get('display:one')).toEqual({
        brightness: 60,
        saturation: 50
      })
      expect(harness.logger.has('DisplayTransitionFailed')).toBe(true)
      expect(harness.intent().chromaShiftStatus).toBe('safetyBlocked')
      harness.client.failRestoreDisplayIds.clear()
      await harness.runtime.productController!.controlChromaShift('retry')
      expect(harness.intent().chromaShiftStatus).toBe('active')
    } finally {
      await harness.runtime.dispose()
    }
  })

  it('starts activation in active mode and applies the default profile', async () => {
    const harness = await createHarness({
      chromaShiftStatus: 'active',
      intendedActivationMode: { kind: 'automatic' }
    })
    await harness.runtime.start()

    expect(harness.logger.has('NativeServiceHealthVerified')).toBe(true)
    expect(harness.client.applied).toEqual([
      { displayId: 'display:one', settings: { brightness: 60, saturation: 50 } }
    ])
    expect(harness.trayMenusCreated()).toBe(1)
    expect(harness.runtime.productController).toBeDefined()
    expect(harness.runtime.shutdownCoordinator).toBeDefined()
  })

  it('starts suspended without display writes when display control is paused', async () => {
    const harness = await createHarness({ chromaShiftStatus: 'paused' })
    await harness.runtime.start()

    expect(harness.client.applied).toEqual([])
    expect(harness.client.captured).toEqual([])
    expect(harness.trayMenusCreated()).toBe(1)
    expect(harness.runtime.productController).toBeDefined()
    expect(harness.intent().chromaShiftStatus).toBe('paused')
  })

  it('logs a failed startup handshake and never reports the service healthy', async () => {
    const harness = await createHarness()
    harness.client.watchdogArmed = false
    await harness.runtime.start()

    expect(harness.logger.has('NativeServiceStartupFailed')).toBe(true)
    expect(harness.logger.has('NativeServiceHealthVerified')).toBe(false)
  })

  it('blocks lifecycle writers when native startup fails', async () => {
    const harness = await createHarness()
    harness.client.startFailure = new Error('spawn failed')
    await harness.runtime.start()

    expect(harness.logger.has('NativeServiceStartupFailed')).toBe(true)
    expect(harness.runtime.productController).toBeDefined()
    expect(harness.trayMenusCreated()).toBe(1)
    expect(harness.client.calls).toEqual([])
    expect(() => harness.runtime.dispose()).not.toThrow()
  })
})

function reorderProfile(id: string, brightness = 61): ColorProfile {
  return {
    id,
    name: id,
    enabled: true,
    applications: [{ executableName: 'game.exe' }],
    displays: [{ displayId: 'display:one', color: { ...createNeutralColorSettings(), brightness } }]
  }
}

describe('unconfirmed preview restoration', () => {
  const id = 'display:one'
  const pending = { state: 'restorePending', displayIds: [id] }

  it.each(['edit', 'override'] as const)(
    'preserves a dirty %s across failed HDR recovery and HDR-off',
    async (kind) => {
      const saved = reorderProfile('draft', 50)
      saved.displays.push({ displayId: 'display:two', color: createNeutralColorSettings() })
      const draft = {
        ...saved,
        name: 'Unsaved name',
        applications: [{ executableName: 'Unsaved.exe' }],
        displays: saved.displays.map((target) => ({
          ...target,
          color: { ...target.color, brightness: 30 }
        }))
      }
      const h = await createHarness({}, { profiles: [saved] })
      await h.runtime.start()
      const product = h.runtime.productController!
      try {
        await product.startPreview(draft, kind)
        h.client.hdrDisplayIds.add(id)
        h.client.failRestoreDisplayIds.add(id)
        vi.useFakeTimers()
        h.displayEvent('displayMetricsChanged')
        await vi.advanceTimersByTimeAsync(750)
        await vi.waitFor(() => expect(h.intent().chromaShiftStatus).toBe('safetyBlocked'))
        expect(h.runtime.previewController!.unsavedDraft).toEqual(draft)
        expect((await product.getState()).preview).toMatchObject({
          state: 'active',
          draft,
          kind,
          unsavedChanges: true
        })
        expect(h.client.currentSettings.get('display:two')?.brightness).toBe(30)
        const before = h.client.calls.length
        await expect(product.updatePreview(draft.id, draft.displays, draft)).rejects.toThrow(
          'Resume ChromaShift'
        )
        await expect(product.startPreview(saved, 'preview')).rejects.toThrow('Resume ChromaShift')
        await expect(product.controlChromaShift('retry')).rejects.toBeInstanceOf(
          PreviewRestoreError
        )
        expect(h.client.calls.slice(before).filter((call) => call.operation === 'apply')).toEqual(
          []
        )
        expect(h.runtime.previewController!.unsavedDraft).toEqual(draft)
        h.client.failRestoreDisplayIds.clear()
        // Recovery validates ownership before writing any retained preview target.
        vi.spyOn(h.client, 'refreshDisplayTopology').mockResolvedValueOnce({
          generation: 2,
          displays: [],
          capabilityReports: [],
          baselines: [{ displayId: id, state: 'connected', ownership: 'providerChanged' }]
        })
        const beforeMismatch = h.client.calls.length
        await expect(product.controlChromaShift('retry')).rejects.toThrow('ownership changed')
        expect(h.client.calls).toHaveLength(beforeMismatch)
        await product.controlChromaShift('retry')
        expect(h.intent().chromaShiftStatus).toBe('active')
        expect(h.runtime.previewController!.unsavedDraft).toEqual(draft)
        expect(h.client.currentSettings.get(id)).toEqual({})
        expect(h.client.currentSettings.get('display:two')?.brightness).toBe(30)
        h.client.hdrDisplayIds.clear()
        h.displayEvent('displayMetricsChanged')
        await vi.advanceTimersByTimeAsync(750)
        expect(h.client.currentSettings.get(id)?.brightness).toBe(30)
        const changed = { ...draft, name: 'Editable after recovery' }
        await product.updatePreview(changed.id, changed.displays, changed)
        expect(h.runtime.previewController!.unsavedDraft).toEqual(changed)
      } finally {
        await h.runtime.dispose()
      }
    }
  )

  it('saves the complete retained draft during Safety blocked without any display writes', async () => {
    const saved = reorderProfile('draft', 50)
    const draft = {
      ...saved,
      name: 'Save during recovery',
      displays: reorderProfile('draft', 30).displays
    }
    const h = await createHarness({}, { profiles: [saved] })
    await h.runtime.start()
    const product = h.runtime.productController!
    try {
      await product.startPreview(draft, 'edit')
      h.client.hdrDisplayIds.add(id)
      h.client.failRestoreDisplayIds.add(id)
      await expect(
        h.runtime.previewController!.reapplyAfterDisplayTransition()
      ).rejects.toBeInstanceOf(PreviewRestoreError)
      const before = h.client.calls.length
      await expect(product.confirmPreview(draft, 'preserve')).resolves.toEqual(draft)
      expect(h.client.calls).toHaveLength(before)
      expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
      expect((await product.getState()).configuration.profiles).toContainEqual(draft)
      expect((await product.getState()).preview).toMatchObject({
        state: 'active',
        draft,
        unsavedChanges: false
      })
      h.client.failRestoreDisplayIds.clear()
      await product.controlChromaShift('retry')
      expect(h.intent().chromaShiftStatus).toBe('active')
      expect((await product.getState()).preview).toMatchObject({ state: 'active', draft })
    } finally {
      await h.runtime.dispose()
    }
  })

  async function previewHarness(
    mode: 'manual' | 'automatic' = 'manual',
    kind: 'preview' | 'edit' | 'override' = 'preview'
  ) {
    const live = reorderProfile('live', 65)
    const draft = reorderProfile('preview', 35)
    const harness = await createHarness(
      {},
      {
        profiles: [live, draft],
        ...(mode === 'automatic'
          ? {
              foregroundApplication: {
                pid: 42,
                executable: 'game.exe',
                path: null,
                title: 'Game',
                monitorDeviceName: null
              }
            }
          : {})
      }
    )
    await harness.runtime.start()
    const product = harness.runtime.productController!
    if (mode === 'manual') await product.activateProfile(live.id)
    await product.startPreview(draft, kind)
    harness.client.calls.length = 0
    return { ...harness, product, draft }
  }

  it('keeps an unconfirmed HDR transition restore Safety blocked until Retry succeeds', async () => {
    const h = await previewHarness('manual', 'edit')
    try {
      h.client.hdrDisplayIds.add(id)
      h.client.failRestoreDisplayIds.add(id)
      vi.useFakeTimers()
      h.displayEvent('displayMetricsChanged')
      await vi.advanceTimersByTimeAsync(750)
      await vi.waitFor(() => expect(h.logger.has('DisplayTransitionFailed')).toBe(true))
      expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
      expect((await h.product.getState()).preview).toMatchObject({
        state: 'active',
        kind: 'edit',
        draft: h.draft
      })
      expect(
        h.client.calls.filter((call) => call.operation === 'capture' || call.operation === 'apply')
      ).toEqual([])
      await expect(h.product.controlChromaShift('retry')).rejects.toBeInstanceOf(
        PreviewRestoreError
      )
      expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
      h.client.failRestoreDisplayIds.clear()
      await h.product.controlChromaShift('retry')
      expect(h.intent().chromaShiftStatus).toBe('active')
      expect(h.client.currentSettings.get(id)).toEqual({})
    } finally {
      h.runtime.dispose()
    }
  })

  it('blocks failed HDR restoration during a profile switch and on repeated Retry', async () => {
    const h = await createHarness({}, { profiles: [reorderProfile('live', 65)] })
    await h.runtime.start()
    const product = h.runtime.productController!
    try {
      h.client.hdrDisplayIds.add(id)
      h.client.failRestoreDisplayIds.add(id)
      h.client.failRestoreAllDisplayIds.add(id)
      await expect(product.activateProfile('live')).rejects.toThrow('Restore failed')
      await vi.waitFor(() => expect(h.intent().chromaShiftStatus).toBe('safetyBlocked'))
      await product.controlChromaShift('retry')
      expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
      const before = h.client.calls.length
      await product.activateProfile('default')
      expect(h.client.calls).toHaveLength(before)
      h.client.failRestoreDisplayIds.clear()
      h.client.failRestoreAllDisplayIds.clear()
      await product.controlChromaShift('retry')
      expect(h.intent().chromaShiftStatus).toBe('active')
      expect(h.client.currentSettings.get(id)).toEqual({})
    } finally {
      h.runtime.dispose()
    }
  })

  it('restores HDR baselines before Exit after the user discards unsaved changes', async () => {
    const h = await createHarness({}, { confirmUnsavedQuit: async () => 'discard' })
    await h.runtime.start()
    const product = h.runtime.productController!
    try {
      const saved = (await product.getState()).configuration.profiles[0]!
      const draft = {
        ...saved,
        displays: [
          {
            displayId: id,
            color: { ...createNeutralColorSettings(), brightness: 30, saturation: 85 }
          }
        ]
      }
      await product.startPreview(draft, 'edit')
      h.client.hdrDisplayIds.add(id)
      const stop = vi.spyOn(h.client, 'stop').mockImplementation(async () => {
        const result = await h.client.restoreAllBaselines()
        expect(result.displays).toEqual([{ displayId: id, restored: true }])
        expect(h.client.currentSettings.get(id)).toEqual({})
      })
      expect(await h.runtime.shutdownCoordinator!.request('tray')).toBe(true)
      expect(stop).toHaveBeenCalledOnce()
      expect(h.runtime.shutdownCoordinator!.state).toBe('complete')
      expect(h.logger.has('ApplicationExiting')).toBe(true)
    } finally {
      h.runtime.dispose()
    }
  })

  it.each(['manual', 'automatic'] as const)(
    'retries End preview and restores the exact prior %s target',
    async (mode) => {
      const h = await previewHarness(mode)
      try {
        h.client.failRestoreDisplayIds.add(id)
        await expect(h.product.cancelPreview()).rejects.toBeInstanceOf(PreviewRestoreError)
        expect((await h.product.getState()).preview).toEqual(pending)
        expect(h.intent()).toMatchObject({
          schemaVersion: 1,
          chromaShiftStatus: 'safetyBlocked',
          pendingControlOperation: 'resume'
        })
        expect((await h.product.getState()).chromaShift.pendingOperation).toBe('previewRestore')
        expect(h.client.currentSettings.get(id)?.brightness).toBe(35)
        expect(h.client.calls).toEqual([{ operation: 'restore', displayId: id }])
        h.client.failRestoreDisplayIds.clear()
        await h.product.cancelPreview()
        expect(h.client.calls.filter((call) => call.operation === 'restore')).toHaveLength(2)
        expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
        expect(h.intent()).toMatchObject({
          chromaShiftStatus: 'active',
          pendingControlOperation: null,
          intendedActivationMode:
            mode === 'manual' ? { kind: 'manual', profileId: 'live' } : { kind: 'automatic' },
          intendedTarget: { kind: 'profile', profileId: 'live' }
        })
        expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
        expect(h.client.maxConcurrentCalls).toBe(1)
        expect(
          h.client.baselineCaptures.every((capture) => capture.settings.brightness !== 35)
        ).toBe(true)
      } finally {
        h.runtime.dispose()
      }
    }
  )

  it.each(['preview', 'edit', 'override'] as const)(
    'keeps persistent %s failure blocked and retries from tray',
    async (kind) => {
      const h = await previewHarness('manual', kind)
      try {
        h.client.failRestoreDisplayIds.add(id)
        await expect(h.product.cancelPreview()).rejects.toBeInstanceOf(PreviewRestoreError)
        await expect(h.product.controlChromaShift('retry')).rejects.toBeInstanceOf(
          PreviewRestoreError
        )
        expect((await h.product.getState()).preview).toEqual(pending)
        expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
        const callsBefore = [...h.client.calls]
        await h.product.activateProfile('live')
        await h.product.enableAutomatic()
        h.client.emitForegroundApplication({
          pid: 50,
          executable: 'other.exe',
          path: null,
          title: 'Other',
          monitorDeviceName: null
        })
        await h.runtime.previewController!.waitForIdle()
        expect(h.client.calls).toEqual(callsBefore)
        await expect(h.product.startPreview(h.draft, 'edit')).rejects.toThrow('Resume ChromaShift')
        await expect(h.product.updatePreview(h.draft.id, h.draft.displays)).rejects.toThrow(
          'Resume ChromaShift'
        )
        h.client.failRestoreDisplayIds.clear()
        h.trayCommands().controlChromaShift()
        await vi.waitFor(() => expect(h.intent().chromaShiftStatus).toBe('active'))
        expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
        expect(h.client.calls.filter((call) => call.operation === 'restore')).toHaveLength(3)
        // The selections made while blocked are intent only; Retry resolves the latest intent.
        expect(h.client.currentSettings.get(id)?.brightness).toBe(60)
      } finally {
        h.runtime.dispose()
      }
    }
  )

  async function panelHarness(mode: 'manual' | 'automatic', kind: 'edit' | 'override') {
    const h = await previewHarness(mode, kind)
    const dirty = {
      ...h.draft,
      displays: [{ displayId: id, color: { ...createNeutralColorSettings(), brightness: 40 } }]
    }
    await h.product.updatePreview(dirty.id, dirty.displays, dirty)
    h.client.calls.length = 0
    let appVisible = true
    let appDestroyed = false
    let miniVisible = false
    let handoff = Promise.resolve()
    const close = new AppPanelCloseController({
      isExiting: () => false,
      closeBehavior: () => 'tray',
      isDestroyed: () => appDestroyed,
      isVisible: () => appVisible,
      flushWindowState: () => undefined,
      requestShutdown: () => {
        throw new Error('Unexpected shutdown')
      },
      getPanelHideScope: () => h.runtime.previewController!.panelHideScope,
      getPanelOpenVersion: () => panels.getPanelOpenVersion('app'),
      beginPanelHide: () => panels.endPanelLifetime('app'),
      renewPanelLifetime: (openVersion) => panels.renewPanelLifetime('app', openVersion),
      cancelForPanelHide: (reason, done, scope) =>
        h.runtime.previewController!.cancelForPanelHide(reason, done, scope),
      notifyClosed: () => undefined,
      waitForHandoffResponse: async () => undefined,
      notifyMinimized: () => undefined,
      releaseToTray: () => {
        appVisible = false
        appDestroyed = true
      },
      errors: { show: () => panels.openAppPanel(), showError: async () => 'cancel' as const },
      logger: h.logger
    })
    const panels = new PanelController(
      () => ({ isDestroyed: () => appDestroyed, isVisible: () => appVisible }),
      () => ({ isDestroyed: () => false, isVisible: () => miniVisible }),
      () => {
        appVisible = true
        appDestroyed = false
      },
      (reason) => {
        if (appDestroyed) return
        appVisible = false
        handoff = close.handleClose({ preventDefault: () => undefined }, reason)
      },
      () => {
        miniVisible = true
      },
      () => {
        miniVisible = false
      },
      'app',
      h.runtime.previewController!
    )
    return {
      ...h,
      dirty,
      close,
      panels,
      handoff: () => handoff,
      miniVisible: () => miniVisible,
      appDestroyed: () => appDestroyed
    }
  }

  it.each([false, true])('serializes close behind HDR restoration, failure=%s', async (fail) => {
    const h = await panelHarness('manual', 'edit')
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const restore = h.client.restoreDisplay.bind(h.client)
    vi.spyOn(h.client, 'restoreDisplay').mockImplementationOnce(async (displayId) => {
      enter()
      await gate
      return restore(displayId)
    })
    try {
      h.client.hdrDisplayIds.add(id)
      if (fail) h.client.failRestoreDisplayIds.add(id)
      vi.useFakeTimers()
      h.displayEvent('displayMetricsChanged')
      const transition = vi.advanceTimersByTimeAsync(750)
      await entered
      const closing = h.close.handleClose({ preventDefault: () => undefined })
      expect(h.appDestroyed()).toBe(false)
      release()
      await Promise.all([transition, closing])
      expect(
        h.client.calls.filter((call) => call.operation === 'apply' || call.operation === 'capture')
      ).toEqual([])
      expect(h.client.maxConcurrentCalls).toBe(1)
      if (fail) {
        expect(h.appDestroyed()).toBe(false)
        expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
        expect((await h.product.getState()).preview).toEqual(pending)
        h.client.failRestoreDisplayIds.clear()
        await h.close.handleClose({ preventDefault: () => undefined })
      }
      expect(h.appDestroyed()).toBe(true)
      expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
    } finally {
      release()
      h.runtime.dispose()
    }
  })

  it.each(['manual', 'automatic'] as const)(
    'panel close restores the exact prior %s target for dirty Edit and override',
    async (mode) => {
      for (const kind of ['edit', 'override'] as const) {
        const h = await panelHarness(mode, kind)
        try {
          const notifications = [...h.notifications]
          await h.close.handleClose({ preventDefault: () => undefined })
          expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
          expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
          expect((await h.product.getState()).activation.mode).toEqual(
            mode === 'manual' ? { kind: 'manual', profileId: 'live' } : { kind: 'automatic' }
          )
          expect(h.client.calls.filter((call) => call.operation === 'restore')).toHaveLength(1)
          expect(h.client.maxConcurrentCalls).toBe(1)
          expect(h.notifications).toEqual(notifications)
        } finally {
          h.runtime.dispose()
        }
      }
    }
  )

  it.each(['control', 'Escape'] as const)(
    'mini %s rolls back through main without a renderer',
    async (action) => {
      const h = await panelHarness('manual', 'override')
      try {
        h.panels.openMiniPanel()
        await h.handoff()
        h.client.calls.length = 0
        const event = { preventDefault: vi.fn() }
        if (action === 'control') await h.panels.closeMiniPanel()
        else await h.panels.handleMiniPanelInput(event, { type: 'keyDown', key: 'Escape' })
        expect(event.preventDefault).toHaveBeenCalledTimes(action === 'Escape' ? 1 : 0)
        expect(h.miniVisible()).toBe(false)
        expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
        expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
        expect(h.client.calls.filter((call) => call.operation === 'restore')).toHaveLength(1)
      } finally {
        h.runtime.dispose()
      }
    }
  )

  it.each(['edit', 'override'] as const)(
    'app to mini handoff handles %s explicitly',
    async (kind) => {
      const h = await panelHarness('manual', kind)
      try {
        h.panels.openMiniPanel()
        await h.handoff()
        expect(h.miniVisible()).toBe(true)
        if (kind === 'edit') {
          expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
          expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
        } else {
          expect((await h.product.getState()).preview).toMatchObject({
            state: 'active',
            kind,
            draft: h.dirty
          })
          expect(h.client.calls).toEqual([])
          h.panels.handleMiniPanelBlur('win32')
          await h.runtime.previewController!.waitForIdle()
          expect(h.miniVisible()).toBe(true)
          expect((await h.product.getState()).preview).toMatchObject({
            state: 'active',
            kind,
            draft: h.dirty
          })
          expect(h.client.calls).toEqual([])
          h.panels.openAppPanel()
          expect(h.miniVisible()).toBe(false)
          expect((await h.product.getState()).preview).toMatchObject({
            state: 'active',
            kind,
            draft: h.dirty
          })
          expect(h.client.calls).toEqual([])
        }
      } finally {
        h.runtime.dispose()
      }
    }
  )

  it('mini close failure keeps Safety blocked and Retry restores the prior target', async () => {
    const h = await panelHarness('manual', 'override')
    try {
      h.panels.openMiniPanel()
      await h.handoff()
      h.client.failRestoreDisplayIds.add(id)
      await expect(h.panels.closeMiniPanel()).rejects.toBeInstanceOf(PreviewRestoreError)
      expect(h.miniVisible()).toBe(true)
      expect((await h.product.getState()).preview).toEqual(pending)
      expect((await h.product.getState()).chromaShift).toMatchObject({
        status: 'safetyBlocked',
        pendingOperation: 'previewRestore'
      })
      h.client.failRestoreDisplayIds.clear()
      await h.product.controlChromaShift('retry')
      expect(h.intent().chromaShiftStatus).toBe('active')
      expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
      expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
      await h.panels.closeMiniPanel()
      expect(h.miniVisible()).toBe(false)
    } finally {
      h.runtime.dispose()
    }
  })

  it.each(['manual', 'automatic'] as const)(
    'close waits for an in-flight write before restoring the exact %s target',
    async (mode) => {
      const h = await panelHarness(mode, 'override')
      try {
        let entered!: () => void
        const writing = new Promise<void>((resolve) => {
          entered = resolve
        })
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        const apply = h.client.applyDisplaySettings.bind(h.client)
        vi.spyOn(h.client, 'applyDisplaySettings').mockImplementationOnce(
          async (displayId, color) => {
            entered()
            await gate
            return apply(displayId, color)
          }
        )
        const targets = [
          { displayId: id, color: { ...createNeutralColorSettings(), brightness: 45 } }
        ]
        const update = h.product.updatePreview(h.dirty.id, targets)
        await writing
        const close = h.close.handleClose({ preventDefault: () => undefined })
        await Promise.resolve()
        expect(h.client.calls).toEqual([])
        release()
        await Promise.all([update, close])
        expect(
          h.client.calls
            .filter((call) => call.operation !== 'capture')
            .map((call) => call.operation)
        ).toEqual(['apply', 'restore', 'apply'])
        expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
        expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
        expect(h.client.maxConcurrentCalls).toBe(1)
      } finally {
        h.runtime.dispose()
      }
    }
  )

  it('close Try again restores the tracked display before releasing the renderer', async () => {
    const h = await previewHarness()
    const release = vi.fn()
    try {
      h.client.failRestoreDisplayIds.add(id)
      const close = new AppPanelCloseController({
        isExiting: () => false,
        closeBehavior: () => 'tray',
        isDestroyed: () => false,
        isVisible: () => true,
        flushWindowState: () => undefined,
        requestShutdown: () => undefined,
        getPanelHideScope: () => h.runtime.previewController!.panelHideScope,
        getPanelOpenVersion: () => 0,
        cancelForPanelHide: (reason, done, scope) =>
          h.runtime.previewController!.cancelForPanelHide(reason, done, scope),
        notifyClosed: () => undefined,
        waitForHandoffResponse: async () => undefined,
        notifyMinimized: () => undefined,
        releaseToTray: release,
        errors: {
          show: () => undefined,
          showError: async () => {
            expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
            expect((await h.product.getState()).preview).toEqual(pending)
            expect(release).not.toHaveBeenCalled()
            h.client.failRestoreDisplayIds.clear()
            return 'retry' as const
          }
        },
        logger: h.logger
      })
      await close.handleClose({ preventDefault: () => undefined })
      expect(release).toHaveBeenCalledOnce()
      expect(h.client.calls.filter((call) => call.operation === 'restore')).toHaveLength(2)
      expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
      expect(h.intent().chromaShiftStatus).toBe('active')
    } finally {
      h.runtime.dispose()
    }
  })

  it.each(['manual', 'preserve'] as const)(
    'retains restoration failure during %s confirmation for a later Discard',
    async (completion) => {
      const h = await previewHarness('manual', 'edit')
      try {
        h.client.failRestoreDisplayIds.add(id)
        await expect(h.product.confirmPreview(h.draft, completion)).rejects.toBeInstanceOf(
          PreviewRestoreError
        )
        expect((await h.product.getState()).preview).toEqual(pending)
        expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
        expect(h.client.calls.filter((call) => call.operation === 'apply')).toEqual([])
        h.client.failRestoreDisplayIds.clear()
        await h.product.cancelPreview()
        expect(h.intent().chromaShiftStatus).toBe('active')
        expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
      } finally {
        h.runtime.dispose()
      }
    }
  )

  it('a later topology event retries pending restoration without reapplying preview values', async () => {
    const h = await previewHarness()
    try {
      h.client.failRestoreDisplayIds.add(id)
      await expect(h.product.cancelPreview()).rejects.toBeInstanceOf(PreviewRestoreError)
      vi.useFakeTimers()
      h.displayEvent('displayMetricsChanged')
      await vi.advanceTimersByTimeAsync(750)
      await vi.waitFor(() => expect(h.logger.has('DisplayTransitionSafetyRetryFailed')).toBe(true))
      expect((await h.product.getState()).preview).toEqual(pending)
      expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
      expect(h.client.calls.filter((call) => call.operation === 'apply')).toEqual([])
      h.client.failRestoreDisplayIds.clear()
      await h.product.controlChromaShift('retry')
      expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
    } finally {
      h.runtime.dispose()
    }
  })

  it.each([false, true])(
    'clears held compare on Pause, including restore failure=%s',
    async (fails) => {
      const h = await previewHarness('manual', 'edit')
      try {
        const draft = {
          ...h.draft,
          displays: [{ displayId: id, color: { ...createNeutralColorSettings(), brightness: 41 } }]
        }
        await h.product.updatePreview(draft.id, draft.displays, draft)
        await h.product.setPreviewCompare(draft.id, true)
        if (fails) h.client.failRestoreDisplayIds.add(id)
        const pausing = h.product.controlChromaShift('pause')
        if (fails) await expect(pausing).rejects.toBeInstanceOf(PreviewRestoreError)
        else await pausing
        expect((await h.product.getState()).preview).not.toMatchObject({ comparing: true })
        expect(h.intent().chromaShiftStatus).toBe(fails ? 'safetyBlocked' : 'paused')
        h.client.failRestoreDisplayIds.clear()
      } finally {
        await h.runtime.dispose()
      }
    }
  )

  it('clears held compare when topology fails before preview reapplication', async () => {
    const h = await previewHarness('manual', 'override')
    try {
      await h.product.setPreviewCompare(h.draft.id, true)
      vi.spyOn(h.client, 'refreshDisplayTopology').mockRejectedValueOnce(
        new Error('Ownership could not be validated')
      )
      vi.useFakeTimers()
      h.displayEvent('displayMetricsChanged')
      await vi.advanceTimersByTimeAsync(750)
      await vi.waitFor(() => expect(h.logger.has('DisplayTransitionFailed')).toBe(true))
      expect((await h.product.getState()).preview).toMatchObject({
        comparing: false,
        draft: h.draft
      })
    } finally {
      await h.runtime.dispose()
    }
  })

  it('Pause during pending restoration stays retryable and finishes Paused', async () => {
    const h = await previewHarness()
    try {
      h.client.failRestoreDisplayIds.add(id)
      await expect(h.product.cancelPreview()).rejects.toBeInstanceOf(PreviewRestoreError)
      await expect(h.product.controlChromaShift('pause')).rejects.toBeInstanceOf(
        PreviewRestoreError
      )
      expect(h.intent()).toMatchObject({
        chromaShiftStatus: 'safetyBlocked',
        pendingControlOperation: 'pause'
      })
      expect((await h.product.getState()).preview).toEqual(pending)
      h.client.failRestoreDisplayIds.clear()
      await h.product.controlChromaShift('retry')
      expect(h.intent().chromaShiftStatus).toBe('paused')
      expect(h.client.calls.filter((call) => call.operation === 'apply')).toEqual([])
      expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
    } finally {
      h.runtime.dispose()
    }
  })

  it('a restarted pending-restore intent resumes only through validated Retry', async () => {
    const h = await createHarness(
      {
        chromaShiftStatus: 'safetyBlocked',
        pendingControlOperation: 'resume',
        intendedActivationMode: { kind: 'manual', profileId: 'live' },
        intendedTarget: { kind: 'profile', profileId: 'live' }
      },
      { profiles: [reorderProfile('live', 65)] }
    )
    await h.runtime.start()
    try {
      expect(h.client.calls).toEqual([])
      await h.runtime.productController!.controlChromaShift('retry')
      expect((await h.runtime.productController!.getState()).preview).toEqual({ state: 'inactive' })
      expect(h.intent().chromaShiftStatus).toBe('active')
      expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
    } finally {
      h.runtime.dispose()
    }
  })

  it('blocks #79 transition rollback when both restore and prior-target apply would fail', async () => {
    const h = await previewHarness()
    try {
      h.client.failApplyDisplayIds.add(id)
      h.client.failRestoreDisplayIds.add(id)
      vi.useFakeTimers()
      h.displayEvent('displayMetricsChanged')
      await vi.advanceTimersByTimeAsync(750)
      await vi.waitFor(() => expect(h.logger.has('DisplayTransitionFailed')).toBe(true))
      expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
      expect((await h.product.getState()).preview).toEqual(pending)
      expect(h.client.currentSettings.get(id)?.brightness).toBe(35)
      // Rollback must never attempt the prior target while restoration is unconfirmed.
      expect(h.client.calls.filter((call) => call.operation === 'apply')).toEqual([
        { operation: 'apply', displayId: id, settings: { brightness: 35, saturation: 50 } }
      ])
      const callsBefore = [...h.client.calls]
      await h.product.activateProfile('live')
      expect(h.client.calls).toEqual(callsBefore)
      h.client.failRestoreDisplayIds.clear()
      h.client.failApplyDisplayIds.clear()
      await h.product.controlChromaShift('retry')
      expect(h.intent().chromaShiftStatus).toBe('active')
      expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
      expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
      expect(h.client.maxConcurrentCalls).toBe(1)
    } finally {
      h.runtime.dispose()
    }
  })

  it('clears blocked tracking after emergency restore-all and ends Paused without a renderer', async () => {
    const h = await previewHarness()
    try {
      h.client.failRestoreDisplayIds.add(id)
      await expect(h.product.cancelPreview()).rejects.toBeInstanceOf(PreviewRestoreError)
      h.client.calls.length = 0
      h.emergencyRestore()
      await vi.waitFor(() => expect(h.logger.has('EmergencyRestorePauseCompleted')).toBe(true))
      expect(h.intent()).toMatchObject({
        chromaShiftStatus: 'paused',
        pendingControlOperation: null,
        intendedActivationMode: { kind: 'manual', profileId: 'live' },
        intendedTarget: { kind: 'profile', profileId: 'live' }
      })
      expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
      expect(h.client.currentSettings.get(id)).toEqual({})
      expect(h.client.calls).toEqual([
        { operation: 'restore', displayId: id },
        { operation: 'restoreAll' },
        { operation: 'restoreAll' }
      ])
      await h.product.cancelPreview()
      expect(h.client.calls).toHaveLength(3)
    } finally {
      h.runtime.dispose()
    }
  })

  it('shutdown retries retained native baselines and keeps the app alive until restoration succeeds', async () => {
    const h = await previewHarness()
    try {
      h.client.failRestoreDisplayIds.add(id)
      await expect(h.product.cancelPreview()).rejects.toBeInstanceOf(PreviewRestoreError)
      h.client.failRestoreAllDisplayIds.add(id)
      const stop = vi.spyOn(h.client, 'stop').mockImplementation(async () => {
        const result = await h.client.restoreAllBaselines()
        if (result.displays.some((display) => !display.restored))
          throw new Error('Shutdown restore failed')
      })
      await expect(h.runtime.shutdownCoordinator!.request('tray')).resolves.toBe(false)
      expect((await h.product.getState()).preview).toEqual(pending)
      expect(h.client.currentSettings.get(id)?.brightness).toBe(35)
      h.client.failRestoreAllDisplayIds.clear()
      await expect(h.runtime.shutdownCoordinator!.request('tray')).resolves.toBe(true)
      expect(stop).toHaveBeenCalledTimes(2)
      expect(h.client.currentSettings.get(id)).toEqual({})
      expect(h.logger.has('ApplicationExiting')).toBe(true)
    } finally {
      h.runtime.dispose()
    }
  })

  it('keeps pending tracking and Safety blocked when emergency restore-all fails', async () => {
    const h = await previewHarness()
    try {
      h.client.failRestoreDisplayIds.add(id)
      await expect(h.product.cancelPreview()).rejects.toBeInstanceOf(PreviewRestoreError)
      h.client.failRestoreAllDisplayIds.add(id)
      h.emergencyRestore()
      await vi.waitFor(() =>
        expect(h.errors).toContainEqual(
          expect.objectContaining({ title: 'Emergency restore failed' })
        )
      )
      expect(h.intent()).toMatchObject({
        chromaShiftStatus: 'safetyBlocked',
        pendingControlOperation: 'resume'
      })
      expect((await h.product.getState()).preview).toEqual(pending)
      expect(h.client.currentSettings.get(id)?.brightness).toBe(35)
      expect(h.logger.has('EmergencyRestorePauseCompleted')).toBe(false)
      h.client.failRestoreDisplayIds.clear()
      h.client.failRestoreAllDisplayIds.clear()
      await h.product.controlChromaShift('retry')
      expect(h.client.currentSettings.get(id)?.brightness).toBe(65)
    } finally {
      h.runtime.dispose()
    }
  })

  it.each(['disconnected', 'hdr'] as const)(
    'handles %s baselines without entering Safety blocked',
    async (reason) => {
      const h = await previewHarness()
      try {
        if (reason === 'hdr') h.client.hdrDisplayIds.add(id)
        else h.client.disconnectedDisplayIds.add(id)
        await h.product.cancelPreview()
        expect(h.intent().chromaShiftStatus).toBe('active')
        expect((await h.product.getState()).preview).toEqual({ state: 'inactive' })
        expect(h.client.calls).toEqual(
          reason === 'hdr' ? [{ operation: 'restore', displayId: id }] : []
        )
      } finally {
        h.runtime.dispose()
      }
    }
  )
})

describe('profile reorder activation', () => {
  it('persists a reorder without resetting or reapplying an unchanged Default target', async () => {
    const harness = await createHarness(
      {},
      { profiles: [reorderProfile('first'), reorderProfile('second')] }
    )
    await harness.runtime.start()
    const callsBefore = [...harness.client.calls]
    const eventsBefore = harness.logger.events.length
    try {
      await harness.runtime.productController!.reorderProfiles(['default', 'second', 'first'])
      expect(harness.client.calls).toEqual(callsBefore)
      expect(
        harness.logger.events
          .slice(eventsBefore)
          .filter((event) => ['ActivationStateReset', 'ProfileActivated'].includes(event.eventName))
      ).toEqual([])
      expect(
        (await harness.runtime.productController!.getState()).configuration.profiles.map(
          (profile) => profile.id
        )
      ).toEqual(['default', 'second', 'first'])
    } finally {
      harness.runtime.dispose()
    }
  })

  it('preserves a manual selection without display writes when profiles are reordered', async () => {
    const harness = await createHarness(
      {},
      { profiles: [reorderProfile('first'), reorderProfile('second')] }
    )
    await harness.runtime.start()
    try {
      await harness.runtime.productController!.activateProfile('first')
      const callsBefore = [...harness.client.calls]
      await harness.runtime.productController!.reorderProfiles(['default', 'second', 'first'])
      expect(harness.client.calls).toEqual(callsBefore)
      expect(harness.runtime.productController!.getProfileDiagnosticContext()).toMatchObject({
        activation: {
          mode: { kind: 'manual', profileId: 'first' },
          currentTarget: { kind: 'profile', profileId: 'first' }
        }
      })
    } finally {
      harness.runtime.dispose()
    }
  })

  it('applies a different foreground match when reordering changes matching priority', async () => {
    const second = reorderProfile('second', 62)
    second.displays[0]!.displayId = 'display:two'
    const harness = await createHarness(
      {},
      {
        profiles: [reorderProfile('first', 61), second],
        foregroundApplication: {
          pid: 42,
          executable: 'game.exe',
          path: 'C:\\Games\\game.exe',
          title: 'Game',
          monitorDeviceName: null
        }
      }
    )
    await harness.runtime.start()
    try {
      expect(harness.client.applied.at(-1)?.settings.brightness).toBe(61)
      const eventsBefore = harness.logger.events.length
      await harness.runtime.productController!.reorderProfiles(['default', 'second', 'first'])
      expect(harness.client.applied.at(-1)?.settings.brightness).toBe(62)
      expect(harness.client.applied.at(-1)?.displayId).toBe('display:two')
      expect(harness.client.restored).toContain('display:one')
      expect(
        harness.logger.events
          .slice(eventsBefore)
          .filter((event) => event.eventName === 'ActivationStateReset')
      ).toEqual([])
      expect(harness.runtime.productController!.getProfileDiagnosticContext()).toMatchObject({
        activation: { currentTarget: { kind: 'profile', profileId: 'second' } }
      })
    } finally {
      harness.runtime.dispose()
    }
  })

  it('still reapplies an edited profile when its ID stays the same', async () => {
    const harness = await createHarness()
    await harness.runtime.start()
    try {
      const product = harness.runtime.productController!
      const profile = (await product.getState()).configuration.profiles[0]!
      profile.displays[0]!.color.brightness = 62
      await product.saveProfile(profile)
      expect(harness.client.applied.at(-1)?.settings.brightness).toBe(62)
      expect(harness.client.applied).toHaveLength(2)
    } finally {
      harness.runtime.dispose()
    }
  })

  it('retries a previously failed target instead of treating it as successfully activated', async () => {
    const harness = await createHarness(
      {},
      {
        profiles: [reorderProfile('first'), reorderProfile('second')]
      }
    )
    harness.client.failApplyDisplayIds.add('display:one')
    await harness.runtime.start()
    try {
      expect(harness.client.applied).toHaveLength(0)
      harness.client.failApplyDisplayIds.clear()
      await harness.runtime.productController!.reorderProfiles(['default', 'second', 'first'])
      expect(harness.client.applied.at(-1)?.settings.brightness).toBe(60)
      expect(harness.runtime.productController!.getProfileDiagnosticContext()).toMatchObject({
        activation: { currentTarget: { kind: 'profile', profileId: 'default' } }
      })
    } finally {
      harness.runtime.dispose()
    }
  })

  it('preserves an active preview without writes or rollback during a reorder', async () => {
    const harness = await createHarness(
      {},
      { profiles: [reorderProfile('first'), reorderProfile('second')] }
    )
    await harness.runtime.start()
    try {
      const product = harness.runtime.productController!
      await product.startPreview(reorderProfile('first'), 'preview')
      const callsBefore = [...harness.client.calls]
      await product.reorderProfiles(['default', 'second', 'first'])
      expect(harness.client.calls).toEqual(callsBefore)
      expect(product.getProfileDiagnosticContext()).toMatchObject({
        preview: { state: 'active', profileId: 'first' }
      })
      await product.cancelPreview()
      expect(harness.client.applied.at(-1)?.settings.brightness).toBe(60)
    } finally {
      harness.runtime.dispose()
    }
  })

  it.each(['paused', 'safetyBlocked'] as const)(
    'keeps %s display control quiescent during reordering',
    async (status) => {
      const harness = await createHarness(
        { chromaShiftStatus: status },
        { profiles: [reorderProfile('first'), reorderProfile('second')] }
      )
      await harness.runtime.start()
      try {
        const callsBefore = [...harness.client.calls]
        await harness.runtime.productController!.reorderProfiles(['default', 'second', 'first'])
        expect(harness.client.calls).toEqual(callsBefore)
        expect(harness.intent().chromaShiftStatus).toBe(status)
      } finally {
        harness.runtime.dispose()
      }
    }
  )
})

describe('product runtime display-control wiring', () => {
  const gameApplication: ForegroundApplication = {
    pid: 42,
    executable: 'game.exe',
    path: 'C:\\Games\\game.exe',
    title: 'Game',
    monitorDeviceName: null
  }

  it('keeps a newer Automatic target reached before the direct emergency restore', async () => {
    const harness = await createHarness({}, { profiles: [reorderProfile('first')] })
    await harness.runtime.start()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const preview = harness.runtime.previewController!
    const dispose = preview.dispose.bind(preview)
    const disposing = vi.spyOn(preview, 'dispose').mockImplementationOnce(async () => {
      await waiting
      return dispose()
    })
    try {
      expect(harness.intent().intendedTarget).toEqual({ kind: 'profile', profileId: 'default' })
      harness.emergencyRestore()
      await vi.waitFor(() => expect(disposing).toHaveBeenCalledOnce())
      harness.client.emitForegroundApplication(gameApplication)
      await vi.waitFor(() =>
        expect(harness.intent().intendedTarget).toEqual({ kind: 'profile', profileId: 'first' })
      )
      release()
      await vi.waitFor(() =>
        expect(harness.logger.has('EmergencyRestorePauseCompleted')).toBe(true)
      )
      expect(harness.intent()).toMatchObject({
        chromaShiftStatus: 'paused',
        pendingControlOperation: null,
        intendedActivationMode: { kind: 'automatic' },
        intendedTarget: { kind: 'profile', profileId: 'first' }
      })
    } finally {
      release()
      harness.runtime.dispose()
    }
  })

  it('preserves the newer Automatic target resolved during real emergency preview teardown', async () => {
    const harness = await createHarness({}, { profiles: [reorderProfile('first')] })
    await harness.runtime.start()
    try {
      await harness.runtime.productController!.startPreview(reorderProfile('first'), 'preview')
      const appliedBefore = harness.client.applied.length
      harness.client.emitForegroundApplication(gameApplication)
      expect(harness.intent().intendedTarget).toEqual({ kind: 'profile', profileId: 'default' })
      expect(harness.client.applied).toHaveLength(appliedBefore)

      harness.emergencyRestore()
      await vi.waitFor(() =>
        expect(harness.logger.has('EmergencyRestorePauseCompleted')).toBe(true)
      )
      expect(harness.intent()).toMatchObject({
        chromaShiftStatus: 'paused',
        pendingControlOperation: null,
        intendedActivationMode: { kind: 'automatic' },
        intendedTarget: { kind: 'profile', profileId: 'first' }
      })
      expect(harness.errors).toEqual([])
    } finally {
      harness.runtime.dispose()
    }
  })

  it.each([true, false])(
    'handles Paused shortcut selection with notificationsEnabled=%s',
    async (notificationsEnabled) => {
      const harness = await createHarness(
        { chromaShiftStatus: 'paused' },
        {
          preferences: {
            notificationsEnabled,
            shortcutBindings: [
              { accelerator: 'CommandOrControl+Alt+1', action: { kind: 'defaultProfile' } },
              { accelerator: 'CommandOrControl+Alt+2', action: { kind: 'automatic' } }
            ]
          }
        }
      )
      await harness.runtime.start()
      try {
        harness.pressShortcut('CommandOrControl+Alt+1')
        await vi.waitFor(() =>
          expect(harness.intent().intendedActivationMode).toEqual({
            kind: 'manual',
            profileId: 'default'
          })
        )
        harness.pressShortcut('CommandOrControl+Alt+2')
        await vi.waitFor(() =>
          expect(harness.intent().intendedActivationMode).toEqual({ kind: 'automatic' })
        )
        await vi.waitFor(() =>
          expect(harness.notifications).toHaveLength(notificationsEnabled ? 2 : 0)
        )
        expect(harness.notifications).toMatchObject(
          notificationsEnabled
            ? [
                {
                  title: 'ChromaShift paused',
                  body: 'Default applies when you resume.',
                  status: 'paused'
                },
                {
                  title: 'ChromaShift paused',
                  body: 'Automatic applies when you resume.',
                  status: 'paused'
                }
              ]
            : []
        )
        expect(harness.client.calls).toEqual([])
        expect(harness.intent()).toMatchObject({
          chromaShiftStatus: 'paused',
          intendedActivationMode: { kind: 'automatic' }
        })
      } finally {
        harness.runtime.dispose()
      }
    }
  )
  it('runs a fresh direct emergency restore on a second press while Resume is held', async () => {
    const harness = await createHarness({ chromaShiftStatus: 'paused' })
    await harness.runtime.start()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const refresh = harness.client.refreshDisplayTopology.bind(harness.client)
    const refreshing = vi
      .spyOn(harness.client, 'refreshDisplayTopology')
      .mockImplementationOnce(async () => {
        await waiting
        return refresh()
      })
    const restoring = vi.spyOn(harness.client, 'restoreAllBaselines')
    const resuming = harness.runtime.productController!.controlChromaShift('resume')
    try {
      await vi.waitFor(() => expect(refreshing).toHaveBeenCalledOnce())
      harness.emergencyRestore()
      await vi.waitFor(() =>
        expect(
          harness.logger.events.filter((event) => event.eventName === 'EmergencyRestoreCompleted')
        ).toHaveLength(1)
      )
      expect(harness.logger.has('EmergencyRestorePauseCompleted')).toBe(false)
      harness.emergencyRestore()
      await vi.waitFor(() =>
        expect(
          harness.logger.events.filter((event) => event.eventName === 'EmergencyRestoreCompleted')
        ).toHaveLength(2)
      )
      expect(restoring).toHaveBeenCalledTimes(2)
      expect(harness.logger.has('EmergencyRestorePauseCompleted')).toBe(false)
      expect(harness.errors).toEqual([])
    } finally {
      release()
      await resuming
      await vi.waitFor(() =>
        expect(
          harness.logger.events.filter(
            (event) => event.eventName === 'EmergencyRestorePauseCompleted'
          )
        ).toHaveLength(2)
      )
      expect(harness.intent().chromaShiftStatus).toBe('paused')
      expect(harness.client.currentSettings.get('display:one')).toEqual({})
      const applies = harness.client.applied.length
      harness.client.emitForegroundApplication(gameApplication)
      await harness.runtime.productController!.getState()
      expect(harness.client.applied).toHaveLength(applies)
      harness.runtime.dispose()
    }
  })

  it('tears down an active preview before direct emergency restore and safely cancels again in the follow-up', async () => {
    const harness = await createHarness({}, { profiles: [reorderProfile('first')] })
    await harness.runtime.start()
    try {
      await harness.runtime.productController!.startPreview(reorderProfile('first'), 'preview')
      const preview = harness.runtime.previewController!
      const dispose = vi.spyOn(preview, 'dispose')
      const cancel = vi.spyOn(preview, 'cancel')
      harness.emergencyRestore()
      await vi.waitFor(() =>
        expect(harness.logger.has('EmergencyRestorePauseCompleted')).toBe(true)
      )
      expect(dispose).toHaveBeenCalledOnce()
      expect(cancel).toHaveBeenCalledTimes(2)
      expect(dispose.mock.invocationCallOrder[0]!).toBeLessThan(cancel.mock.invocationCallOrder[0]!)
      expect(harness.intent()).toMatchObject({
        chromaShiftStatus: 'paused',
        pendingControlOperation: null,
        intendedActivationMode: { kind: 'automatic' },
        intendedTarget: { kind: 'profile', profileId: 'default' }
      })
      expect(harness.logger.has('EmergencyRestorePauseFailed')).toBe(false)
      expect(harness.errors).toEqual([])
    } finally {
      harness.runtime.dispose()
    }
  })

  it('preserves the newer Automatic target resolved by a held Resume after the emergency snapshot', async () => {
    const harness = await createHarness(
      { chromaShiftStatus: 'paused' },
      {
        profiles: [reorderProfile('first')]
      }
    )
    await harness.runtime.start()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const refresh = harness.client.refreshDisplayTopology.bind(harness.client)
    const refreshing = vi
      .spyOn(harness.client, 'refreshDisplayTopology')
      .mockImplementationOnce(async () => {
        await waiting
        return refresh()
      })
    const resuming = harness.runtime.productController!.controlChromaShift('resume')
    try {
      await vi.waitFor(() => expect(refreshing).toHaveBeenCalledOnce())
      harness.emergencyRestore()
      await vi.waitFor(() => expect(harness.logger.has('EmergencyRestoreCompleted')).toBe(true))
      expect(harness.logger.has('EmergencyRestorePauseCompleted')).toBe(false)
      harness.client.foregroundApplication = {
        pid: 42,
        executable: 'game.exe',
        path: 'C:\\Games\\game.exe',
        title: 'Game',
        monitorDeviceName: null
      }
      release()
      await resuming
      await vi.waitFor(() =>
        expect(harness.logger.has('EmergencyRestorePauseCompleted')).toBe(true)
      )
      expect(harness.intent()).toMatchObject({
        chromaShiftStatus: 'paused',
        pendingControlOperation: null,
        intendedActivationMode: { kind: 'automatic' },
        intendedTarget: { kind: 'profile', profileId: 'first' }
      })
      expect(harness.errors).toEqual([])
    } finally {
      release()
      await resuming
      harness.runtime.dispose()
    }
  })

  it.each(['tray', 'ipc'] as const)(
    'updates C2 selections through %s without bypassing Safety blocked',
    async (surface) => {
      const harness = await createHarness(
        {
          chromaShiftStatus: 'safetyBlocked',
          pendingControlOperation: 'resume',
          intendedActivationMode: { kind: 'manual', profileId: 'default' },
          intendedTarget: { kind: 'profile', profileId: 'default' }
        },
        { profiles: [reorderProfile('first')] }
      )
      await harness.runtime.start()
      try {
        const callsBefore = [...harness.client.calls]
        const refresh = vi.spyOn(harness.client, 'refreshDisplayTopology')
        if (surface === 'tray') harness.trayCommands().selectProfile('first')
        else expect(await harness.invokeActivate('first')).toMatchObject({ ok: true })
        await vi.waitFor(() =>
          expect(harness.intent()).toMatchObject({
            chromaShiftStatus: 'safetyBlocked',
            pendingControlOperation: 'resume',
            intendedActivationMode: { kind: 'manual', profileId: 'first' },
            intendedTarget: { kind: 'profile', profileId: 'first' }
          })
        )
        if (surface === 'tray') harness.trayCommands().enableAutomatic()
        else expect(await harness.invokeAutomatic()).toMatchObject({ ok: true })
        await vi.waitFor(() =>
          expect(harness.intent()).toMatchObject({
            chromaShiftStatus: 'safetyBlocked',
            pendingControlOperation: 'resume',
            intendedActivationMode: { kind: 'automatic' },
            intendedTarget: null
          })
        )
        expect(harness.client.calls).toEqual(callsBefore)
        expect(refresh).not.toHaveBeenCalled()
        expect(harness.notifications).toEqual([])
      } finally {
        harness.runtime.dispose()
      }
    }
  )
  const restorableIntent: Partial<ChromaShiftIntent> = {
    chromaShiftStatus: 'active',
    intendedActivationMode: { kind: 'manual', profileId: 'default' },
    intendedTarget: { kind: 'profile', profileId: 'default' }
  }

  it('keeps original settings Paused when an in-flight topology refresh completes after emergency restore', async () => {
    const harness = await createHarness()
    harness.client.currentSettings.set('display:one', { brightness: 43 })
    await harness.runtime.start()
    expect(harness.client.currentSettings.get('display:one')?.brightness).toBe(60)
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const refresh = harness.client.refreshDisplayTopology.bind(harness.client)
    const refreshing = vi
      .spyOn(harness.client, 'refreshDisplayTopology')
      .mockImplementationOnce(async () => {
        await waiting
        return refresh()
      })
    try {
      vi.useFakeTimers()
      harness.displayEvent('displayMetricsChanged')
      await vi.advanceTimersByTimeAsync(750)
      vi.useRealTimers()
      expect(refreshing).toHaveBeenCalledOnce()
      harness.emergencyRestore()
      await vi.waitFor(() => expect(harness.logger.has('EmergencyRestoreCompleted')).toBe(true))
      expect(harness.client.currentSettings.get('display:one')).toEqual({ brightness: 43 })
      const appliesAfterRestore = harness.client.applied.length
      release()
      await vi.waitFor(() => expect(harness.logger.has('DisplayTransitionCompleted')).toBe(true))
      await vi.waitFor(() =>
        expect(harness.logger.has('EmergencyRestorePauseCompleted')).toBe(true)
      )
      expect(harness.intent()).toMatchObject({
        chromaShiftStatus: 'paused',
        pendingControlOperation: null
      })
      expect((await harness.runtime.productController!.getState()).chromaShift).toMatchObject({
        status: 'paused',
        transitionInProgress: false
      })
      expect(harness.client.currentSettings.get('display:one')).toEqual({ brightness: 43 })
      expect(harness.client.applied).toHaveLength(appliesAfterRestore)
      harness.client.emitForegroundApplication(gameApplication)
      await harness.runtime.productController!.getState()
      expect(harness.client.applied).toHaveLength(appliesAfterRestore)
      expect(harness.errors).toEqual([])
    } finally {
      release()
      harness.runtime.dispose()
    }
  })

  it('pauses after a successful emergency restore without a renderer', async () => {
    const harness = await createHarness(restorableIntent)
    await harness.runtime.start()
    try {
      expect(harness.client.captured).toEqual(['display:one'])
      await harness.runtime.productController!.activateProfile('default')

      harness.emergencyRestore()

      await vi.waitFor(() => expect(harness.intent().chromaShiftStatus).toBe('paused'))
      expect(harness.intent()).toMatchObject({
        pendingControlOperation: null,
        intendedActivationMode: { kind: 'manual', profileId: 'default' },
        intendedTarget: { kind: 'profile', profileId: 'default' }
      })
      expect(harness.client.calls.some((call) => call.operation === 'restoreAll')).toBe(true)
      expect(harness.errors).toEqual([])
      await vi.waitFor(() => expect(harness.notifications).toHaveLength(1))
      expect(harness.notifications[0]).toMatchObject({
        title: 'Original settings restored',
        body: 'ChromaShift is paused.',
        status: 'paused'
      })
    } finally {
      harness.runtime.dispose()
    }
  })

  it('keeps status and reports the existing failure when an emergency restore fails', async () => {
    const harness = await createHarness(restorableIntent)
    await harness.runtime.start()
    try {
      harness.client.failRestoreAllDisplayIds.add('display:one')

      harness.emergencyRestore()

      await vi.waitFor(() => expect(harness.errors).toHaveLength(1))
      expect(harness.errors[0]?.title).toBe('Emergency restore failed')
      expect(harness.logger.has('EmergencyRestoreCompleted')).toBe(true)
      expect(harness.logger.events).toContainEqual(
        expect.objectContaining({
          level: 'critical',
          eventName: 'EmergencyRestoreCompleted',
          restored: false
        })
      )
      expect(harness.intent()).toMatchObject({
        chromaShiftStatus: 'active',
        pendingControlOperation: null
      })
      expect(harness.notifications).toEqual([])
    } finally {
      harness.runtime.dispose()
    }
  })

  it.each([
    ['paused', null],
    ['safetyBlocked', 'pause'],
    ['safetyBlocked', 'resume']
  ] as const)(
    'leaves %s (%s) unchanged after an emergency restore succeeds',
    async (status, pendingOperation) => {
      const harness = await createHarness({
        ...restorableIntent,
        chromaShiftStatus: status,
        pendingControlOperation: pendingOperation
      })
      await harness.runtime.start()
      try {
        const before = { ...harness.intent() }
        const restore = vi.spyOn(harness.client, 'restoreAllBaselines')
        const cancel = vi.spyOn(harness.runtime.previewController!, 'cancel')
        harness.emergencyRestore()
        await vi.waitFor(() =>
          expect(harness.logger.has('EmergencyRestorePauseCompleted')).toBe(true)
        )
        expect(restore).toHaveBeenCalledOnce()
        expect(cancel).toHaveBeenCalledOnce()
        expect(harness.intent()).toEqual(before)
        expect(harness.errors).toEqual([])
        expect(harness.notifications).toEqual([])
      } finally {
        harness.runtime.dispose()
      }
    }
  )

  it('persists the pending pause before IPC restoration and announces completion only afterwards', async () => {
    const harness = await createHarness(restorableIntent)
    await harness.runtime.start()
    try {
      let release!: () => void
      const waiting = new Promise<void>((resolve) => {
        release = resolve
      })
      const restoreAll = harness.client.restoreAllBaselines.bind(harness.client)
      const restoring = vi
        .spyOn(harness.client, 'restoreAllBaselines')
        .mockImplementation(async () => {
          await waiting
          return restoreAll()
        })
      const restore = harness.invokeRestore()
      await vi.waitFor(() => expect(restoring).toHaveBeenCalledOnce())
      expect(harness.intent()).toMatchObject({
        chromaShiftStatus: 'safetyBlocked',
        pendingControlOperation: 'pause'
      })
      expect(harness.notifications).toEqual([])
      release()
      expect(await restore).toMatchObject({ ok: true })
      await vi.waitFor(() => expect(harness.notifications).toHaveLength(1))
      expect(harness.notifications[0]).toMatchObject({
        title: 'Original settings restored',
        status: 'paused'
      })
    } finally {
      harness.runtime.dispose()
    }
  })

  it('pauses after the tray restores original settings', async () => {
    const harness = await createHarness(restorableIntent)
    await harness.runtime.start()
    try {
      harness.trayCommands().resetBaseline()

      await vi.waitFor(() => expect(harness.intent().chromaShiftStatus).toBe('paused'))
      expect(harness.intent()).toMatchObject({
        pendingControlOperation: null,
        intendedTarget: { kind: 'profile', profileId: 'default' }
      })
    } finally {
      harness.runtime.dispose()
    }
  })

  it('pauses after the Displays page restores original settings', async () => {
    const harness = await createHarness(restorableIntent)
    await harness.runtime.start()
    try {
      expect(await harness.invokeRestore()).toMatchObject({ ok: true, value: null })

      expect(harness.intent()).toMatchObject({
        chromaShiftStatus: 'paused',
        pendingControlOperation: null,
        intendedTarget: { kind: 'profile', profileId: 'default' }
      })
      await vi.waitFor(() => expect(harness.notifications).toHaveLength(1))
      expect(harness.notifications[0]).toMatchObject({
        title: 'Original settings restored',
        body: 'ChromaShift is paused.',
        status: 'paused'
      })
    } finally {
      harness.runtime.dispose()
    }
  })

  it('keeps display control Paused when a profile or Automatic is selected', async () => {
    const harness = await createHarness({
      ...restorableIntent,
      chromaShiftStatus: 'paused'
    })
    await harness.runtime.start()
    try {
      const product = harness.runtime.productController!
      await product.enableAutomatic()
      expect(harness.intent()).toMatchObject({
        chromaShiftStatus: 'paused',
        intendedActivationMode: { kind: 'automatic' },
        intendedTarget: null
      })

      await product.activateProfile('default')
      expect(harness.intent()).toMatchObject({
        chromaShiftStatus: 'paused',
        intendedActivationMode: { kind: 'manual', profileId: 'default' },
        intendedTarget: { kind: 'profile', profileId: 'default' }
      })
      expect(harness.client.applied).toEqual([])
      expect(harness.client.captured).toEqual([])
    } finally {
      harness.runtime.dispose()
    }
  })
})
it('keeps Original settings when an in-flight Retry resumes after emergency restore', async () => {
  const id = 'display:one'
  const h = await createHarness(
    {},
    { profiles: [reorderProfile('live', 65), reorderProfile('preview', 35)] }
  )
  await h.runtime.start()
  const product = h.runtime.productController!
  await product.activateProfile('live')
  await product.startPreview(reorderProfile('preview', 35), 'preview')
  h.client.failRestoreDisplayIds.add(id)
  await expect(product.cancelPreview()).rejects.toBeInstanceOf(PreviewRestoreError)
  h.client.failRestoreDisplayIds.clear()
  let releaseRestore!: () => void
  let releaseTopology!: () => void
  const restoreGate = new Promise<void>((resolve) => {
    releaseRestore = resolve
  })
  const topologyGate = new Promise<void>((resolve) => {
    releaseTopology = resolve
  })
  const restore = h.client.restoreDisplay.bind(h.client)
  const refresh = h.client.refreshDisplayTopology.bind(h.client)
  const restoring = vi
    .spyOn(h.client, 'restoreDisplay')
    .mockImplementationOnce(async (displayId) => {
      await restoreGate
      return restore(displayId)
    })
  const refreshing = vi
    .spyOn(h.client, 'refreshDisplayTopology')
    .mockImplementationOnce(async () => {
      await topologyGate
      return refresh()
    })
  const retry = product.controlChromaShift('retry')
  try {
    await vi.waitFor(() => expect(restoring).toHaveBeenCalledOnce())
    h.emergencyRestore()
    releaseRestore()
    await vi.waitFor(() => expect(refreshing).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(h.logger.has('EmergencyRestoreCompleted')).toBe(true))
    expect(h.client.currentSettings.get(id)).toEqual({})
    releaseTopology()
    await retry
    await vi.waitFor(() => expect(h.logger.has('EmergencyRestorePauseCompleted')).toBe(true))
    expect(h.intent().chromaShiftStatus).toBe('paused')
    expect(h.client.currentSettings.get(id)).toEqual({})
    expect(h.client.calls.at(-1)).toEqual({ operation: 'restoreAll' })
    expect((await product.getState()).preview).toEqual({ state: 'inactive' })
    const applies = h.client.applied.length
    h.client.emitForegroundApplication({
      pid: 42,
      executable: 'game.exe',
      path: null,
      title: 'Game',
      monitorDeviceName: null
    })
    await product.getState()
    expect(h.client.applied).toHaveLength(applies)
  } finally {
    releaseRestore()
    releaseTopology()
    await retry.catch(() => undefined)
    h.runtime.dispose()
  }
})
it('rereview90: Retry must restore a teardown failure after interrupted HDR continuation', async () => {
  const one = 'display:one'
  const two = 'display:two'
  const saved = reorderProfile('draft', 50)
  saved.displays.push({ displayId: two, color: createNeutralColorSettings() })
  const draft = {
    ...saved,
    displays: saved.displays.map((target) => ({
      ...target,
      color: { ...target.color, brightness: 30 }
    }))
  }
  const h = await createHarness({}, { profiles: [saved] })
  await h.runtime.start()
  const product = h.runtime.productController!
  try {
    await product.startPreview(draft, 'edit')
    h.client.hdrDisplayIds.add(one)
    h.client.failRestoreDisplayIds.add(one)
    await expect(
      h.runtime.previewController!.reapplyAfterDisplayTransition()
    ).rejects.toBeInstanceOf(PreviewRestoreError)
    expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
    h.client.failRestoreDisplayIds.delete(one)
    h.client.failRestoreDisplayIds.add(two)
    await expect(product.cancelPreview()).rejects.toBeInstanceOf(PreviewRestoreError)
    expect((await product.getState()).preview).toMatchObject({
      state: 'restorePending',
      displayIds: [two]
    })
    expect(h.client.currentSettings.get(two)?.brightness).toBe(30)
    const before = h.client.calls.length
    await expect(product.controlChromaShift('retry')).rejects.toBeInstanceOf(PreviewRestoreError)
    expect(h.intent().chromaShiftStatus).toBe('safetyBlocked')
    expect((await product.getState()).preview).toEqual({
      state: 'restorePending',
      displayIds: [two]
    })
    expect(h.client.calls.slice(before)).toEqual([{ operation: 'restore', displayId: two }])
    expect(h.client.currentSettings.get(two)?.brightness).toBe(30)
    h.client.failRestoreDisplayIds.clear()
    const recoveryStart = h.client.calls.length
    await product.controlChromaShift('retry')
    expect(h.client.calls[recoveryStart]).toEqual({ operation: 'restore', displayId: two })
    expect(h.client.currentSettings.get(two)).toEqual({})
    expect((await product.getState()).preview).toEqual({ state: 'inactive' })
    expect(h.intent()).toMatchObject({
      chromaShiftStatus: 'active',
      pendingControlOperation: null
    })
  } finally {
    h.client.failRestoreDisplayIds.clear()
    await h.runtime.dispose()
  }
})

it('rereview90: End preview must recover after a failed continuation Retry', async () => {
  const id = 'display:one'
  const saved = reorderProfile('draft', 50)
  const draft = reorderProfile('draft', 30)
  const h = await createHarness({}, { profiles: [saved] })
  await h.runtime.start()
  const product = h.runtime.productController!
  try {
    await product.startPreview(draft, 'edit')
    h.client.hdrDisplayIds.add(id)
    h.client.failRestoreDisplayIds.add(id)
    await expect(
      h.runtime.previewController!.reapplyAfterDisplayTransition()
    ).rejects.toBeInstanceOf(PreviewRestoreError)
    await expect(product.controlChromaShift('retry')).rejects.toBeInstanceOf(PreviewRestoreError)
    expect((await product.getState()).chromaShift.pendingOperation).toBe('previewRestore')
    expect(h.intent()).toMatchObject({
      chromaShiftStatus: 'safetyBlocked',
      pendingControlOperation: 'resume'
    })
    h.client.failRestoreDisplayIds.clear()
    await product.cancelPreview()
    expect(h.intent().chromaShiftStatus).toBe('active')
    expect((await product.getState()).preview).toEqual({ state: 'inactive' })
    expect(h.intent().pendingControlOperation).toBeNull()
    expect(h.client.currentSettings.get(id)).toEqual({})
  } finally {
    h.client.failRestoreDisplayIds.clear()
    await h.runtime.dispose()
  }
})
it('review92: incompatible protocol v1 helper cannot receive display writes', async () => {
  const h = await createHarness()
  const start = h.client.start.bind(h.client)
  const health = h.client.getServiceHealth.bind(h.client)
  h.client.start = async () => ({ ...(await start()), protocolVersion: 1 })
  h.client.getServiceHealth = async () => ({ ...(await health()), protocolVersion: 1 })
  await h.runtime.start()
  try {
    expect(h.logger.has('NativeServiceStartupFailed')).toBe(true)
    expect(h.logger.has('NativeServiceHealthVerified')).toBe(false)
    expect(h.client.calls.filter((call) => call.operation === 'apply')).toEqual([])
    expect(h.client.calls).toEqual([])
    expect(h.runtime.productController).toBeDefined()
    expect(h.errors).toContainEqual({
      title: 'DisplayService compatibility check failed',
      message: expect.stringContaining('matching ChromaShift and DisplayService versions')
    })
    expect(() => h.emergencyRestore()).not.toThrow()
    expect(() => h.emergencyRestore()).not.toThrow()
    expect(h.logger.has('EmergencyRestoreSkipped')).toBe(true)
    await expect(h.invokeRestore()).resolves.toMatchObject({ ok: false })
    await expect(h.invokeActivate('default')).resolves.toMatchObject({ ok: false })
    await expect(h.invokeAutomatic()).resolves.toMatchObject({ ok: false })
    h.displayEvent('displayAdded')
    h.client.emitForegroundApplication({
      pid: 7,
      executable: 'game.exe',
      path: 'C:\\game.exe',
      title: 'Game',
      monitorDeviceName: null
    })
    expect(h.client.calls).toEqual([])
  } finally {
    h.runtime.dispose()
  }
})

it('rereview92: a transient helper startup failure must leave product UI reachable', async () => {
  const h = await createHarness()
  h.client.startFailure = new Error('spawn failed')
  await h.runtime.start()
  try {
    expect(h.client.calls).toEqual([])
    expect(h.errors).toContainEqual(
      expect.objectContaining({ title: 'DisplayService compatibility check failed' })
    )
    h.emergencyRestore()
    expect(h.logger.has('EmergencyRestoreSkipped')).toBe(true)
    expect({
      tray: h.trayMenusCreated(),
      product: !!h.runtime.productController,
      shutdown: !!h.runtime.shutdownCoordinator
    }).toEqual({ tray: 1, product: true, shutdown: true })
  } finally {
    h.runtime.dispose()
  }
})

describe('offline product lifecycle', () => {
  it('serves product state and tray navigation while offline, then recovers only after negotiation', async () => {
    const h = await createHarness()
    vi.useFakeTimers()
    const start = vi.spyOn(h.client, 'start')
    h.client.startFailure = new Error('spawn failed')
    await h.runtime.start()
    try {
      expect(start).toHaveBeenCalledTimes(1)
      const state = await h.runtime.productController!.getState()
      expect(state.configuration.profiles).toHaveLength(1)
      expect(state.displays).toEqual([])
      expect(state.activation.enabled).toBe(false)
      expect(h.trayModel()).toMatchObject({
        displayServiceError: expect.stringContaining('DisplayService unavailable'),
        controlsEnabled: false,
        automaticEnabled: false,
        restoreEnabled: false
      })
      h.trayCommands().openAppPanel()
      expect(h.openAppPanel).toHaveBeenCalledOnce()
      await expect(h.invokeActivate('default')).resolves.toMatchObject({ ok: false })
      await expect(
        h.runtime.productController!.startPreview(state.configuration.profiles[0]!, 'preview')
      ).rejects.toThrow('DisplayService unavailable')
      expect(h.client.calls).toEqual([])
      h.client.startFailure = undefined
      await vi.advanceTimersByTimeAsync(250)
      await vi.waitFor(() => expect(h.logger.has('NativeServiceRecovered')).toBe(true))
      expect(start).toHaveBeenCalledTimes(2)
      expect(h.logger.has('NativeServiceHealthVerified')).toBe(true)
      expect(h.client.calls.some((call) => call.operation === 'apply')).toBe(true)
      await vi.waitFor(() => expect(h.trayModel().displayServiceError).toBeUndefined())
      expect((await h.runtime.productController!.getState()).activation.enabled).toBe(true)
    } finally {
      h.runtime.dispose()
    }
  })

  it('keeps a persistent compatibility status without retrying an incompatible helper, including after exit', async () => {
    const h = await createHarness()
    vi.useFakeTimers()
    const compatibleStart = h.client.start.bind(h.client)
    const start = vi.spyOn(h.client, 'start').mockImplementation(async () => ({
      ...(await compatibleStart()),
      protocolVersion: 1
    }))
    await h.runtime.start()
    try {
      expect(h.trayMenusCreated()).toBe(1)
      expect(h.trayModel().displayServiceError).toContain('DisplayService incompatible')
      expect(h.runtime.shutdownCoordinator).toBeDefined()
      expect((await h.runtime.productController!.getState()).configuration.profiles).toHaveLength(1)
      h.trayCommands().openAppPanel()
      h.emergencyRestore()
      h.emergencyRestore()
      h.client.emitExit()
      h.displayEvent('displayAdded')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(start).toHaveBeenCalledTimes(1)
      expect(h.client.calls).toEqual([])
      expect(h.trayModel().displayServiceError).toContain('Reinstall matching versions')
      await expect(h.invokeAutomatic()).resolves.toMatchObject({ ok: false })
      await expect(h.invokeActivate('default')).resolves.toMatchObject({ ok: false })
      expect(h.openAppPanel).toHaveBeenCalledOnce()
    } finally {
      h.runtime.dispose()
    }
    // A fresh process after reinstall negotiates normally; incompatibility is session-local.
    const restarted = await createHarness()
    try {
      await restarted.runtime.start()
      expect(restarted.client.calls.some((call) => call.operation === 'apply')).toBe(true)
      expect(restarted.trayModel().displayServiceError).toBeUndefined()
    } finally {
      restarted.runtime.dispose()
    }
  })

  it('stops startup recovery as soon as a retry discovers an incompatible helper', async () => {
    const h = await createHarness()
    vi.useFakeTimers()
    const compatibleStart = h.client.start.bind(h.client)
    const start = vi
      .spyOn(h.client, 'start')
      .mockRejectedValueOnce(new Error('transient spawn failure'))
      .mockImplementation(async () => ({ ...(await compatibleStart()), protocolVersion: 1 }))
    await h.runtime.start()
    try {
      await vi.advanceTimersByTimeAsync(250)
      await vi.waitFor(() => expect(h.logger.has('NativeServiceRecoveryTerminated')).toBe(true))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(start).toHaveBeenCalledTimes(2)
      expect(h.client.calls).toEqual([])
      // Refresh is asynchronous, just as it is for a helper-exit broadcast.
      h.trayCommands().openAppPanel()
      await expect(h.invokeActivate('default')).resolves.toMatchObject({ ok: false })
    } finally {
      h.runtime.dispose()
    }
  })

  it('retains invalid limits and still provides state, navigation and shutdown without starting native', async () => {
    const invalid = { schemaVersion: 999, displays: {} }
    const h = await createHarness({}, { displayLimits: invalid })
    const start = vi.spyOn(h.client, 'start')
    await h.runtime.start()
    try {
      expect(start).not.toHaveBeenCalled()
      expect(h.trayModel().displayServiceError).toContain('display-limits.json')
      expect((await h.runtime.productController!.getState()).displays).toEqual([])
      h.trayCommands().openAppPanel()
      expect(h.openAppPanel).toHaveBeenCalledOnce()
      await expect(h.invokeActivate('default')).resolves.toMatchObject({ ok: false })
      expect(h.client.calls).toEqual([])
      expect(
        JSON.parse(await readFile(join(h.configurationPath, '..', 'display-limits.json'), 'utf8'))
      ).toEqual(invalid)
      await expect(h.runtime.shutdownCoordinator!.request('tray')).resolves.toBe(true)
    } finally {
      h.runtime.dispose()
    }
  })

  it('retains invalid profiles while keeping tray navigation and restore-safe shutdown reachable', async () => {
    const invalid = { schemaVersion: 999, profiles: [] }
    const h = await createHarness({}, { profilesDocument: invalid })
    await h.runtime.start()
    try {
      expect(h.runtime.productController).toBeDefined()
      expect(h.trayMenusCreated()).toBe(1)
      expect(h.trayModel().profiles).toEqual([])
      h.trayCommands().openAppPanel()
      expect(h.openAppPanel).toHaveBeenCalledOnce()
      await expect(h.runtime.productController!.getState()).rejects.toThrow()
      expect(
        h.client.calls.filter((call) => call.operation === 'capture' || call.operation === 'apply')
      ).toEqual([])
      expect(JSON.parse(await readFile(h.configurationPath, 'utf8'))).toEqual(invalid)
      await expect(h.runtime.shutdownCoordinator!.request('tray')).resolves.toBe(true)
    } finally {
      h.runtime.dispose()
    }
  })
})
