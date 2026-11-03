import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import {
  PROTOCOL_VERSION,
  type DisplayTopologyRefreshResult,
  type ForegroundApplication,
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
import type { TrayCommands } from '@main/tray-controller.js'
import { FakeNativeDisplayPort } from '@main/testing/fake-native-display.js'

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

  public eventHandler: ((event: unknown) => void) | undefined

  public on(name?: string, handler?: (event: unknown) => void): this {
    if (name === 'event') this.eventHandler = handler
    return this
  }

  public emitForegroundApplication(application: ForegroundApplication): void {
    this.eventHandler!({ event: 'foregroundApplicationChanged', data: { application } })
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
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function createHarness(
  intentOverrides: Partial<ChromaShiftIntent> = {},
  options: {
    profiles?: ColorProfile[]
    foregroundApplication?: ForegroundApplication
    preferences?: Partial<UserPreferences>
  } = {}
): Promise<{
  runtime: ProductRuntime
  client: FakeRuntimeNativeClient
  logger: RecordingLogger
  trayMenusCreated: () => number
  intent: () => ChromaShiftIntent
  emergencyRestore: () => void
  trayCommands: () => TrayCommands
  errors: Array<{ title: string; message: string }>
  notifications: Array<ProductNotification & { status: ChromaShiftIntent['chromaShiftStatus'] }>
  invokeRestore: () => Promise<unknown>
  invokeActivate: (profileId: string) => Promise<unknown>
  invokeAutomatic: () => Promise<unknown>
  pressShortcut: (accelerator: string) => void
}> {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-runtime-'))
  directories.push(directory)
  await writeFile(
    join(directory, 'profiles.json'),
    JSON.stringify({
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
    })
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
  let emergencyHandler: (() => void) | undefined
  let trayCommands: TrayCommands | undefined
  const shortcutHandlers = new Map<string, () => void>()
  const errors: Array<{ title: string; message: string }> = []
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
      openWindow: () => undefined,
      openProfile: () => undefined,
      openAppPanel: () => undefined,
      openMiniPanel: () => undefined,
      createTrayMenu: () => {
        trayMenus += 1
        return Promise.resolve({
          update: (_model, commands) => {
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
      onDisplayEvent: () => undefined
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
    })
  )
  return {
    runtime,
    client,
    logger,
    trayMenusCreated: () => trayMenus,
    intent: () => intent,
    emergencyRestore: () => emergencyHandler!(),
    trayCommands: () => trayCommands!,
    errors,
    notifications,
    invokeRestore: () =>
      handlers.get(productIpcChannels.restoreBaseline)!({} as IpcMainInvokeEvent, {}),
    invokeActivate: (profileId) =>
      handlers.get(productIpcChannels.activateProfile)!({} as IpcMainInvokeEvent, { profileId }),
    invokeAutomatic: () =>
      handlers.get(productIpcChannels.enableAutomatic)!({} as IpcMainInvokeEvent, {}),
    pressShortcut: (accelerator) => shortcutHandlers.get(accelerator)!()
  }
}

describe('product runtime startup wiring', () => {
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

  it('logs a native start failure while lifecycle configuration still proceeds', async () => {
    const harness = await createHarness()
    harness.client.startFailure = new Error('spawn failed')
    await harness.runtime.start()

    expect(harness.logger.has('NativeServiceStartupFailed')).toBe(true)
    // A start failure does not gate the product lifecycle: the controllers are
    // wired anyway, startup activation is attempted against the client (whose
    // operations fail in production), and native-service recovery owns getting
    // back to a healthy helper.
    expect(harness.runtime.productController).toBeDefined()
    expect(harness.trayMenusCreated()).toBe(1)
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
      expect(cancel).toHaveBeenCalledOnce()
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
        expect(cancel).not.toHaveBeenCalled()
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
