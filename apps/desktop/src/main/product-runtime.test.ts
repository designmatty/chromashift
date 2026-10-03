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
import { afterEach, describe, expect, it } from 'vitest'
import type { UserPreferences } from '@shared/product-api.js'
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

  public on(): this {
    return this
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
  options: { profiles?: ColorProfile[]; foregroundApplication?: ForegroundApplication } = {}
): Promise<{
  runtime: ProductRuntime
  client: FakeRuntimeNativeClient
  logger: RecordingLogger
  trayMenusCreated: () => number
  intent: () => ChromaShiftIntent
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
  let preferences: UserPreferences = { ...defaultUserPreferences }
  let intent: ChromaShiftIntent = { ...defaultChromaShiftIntent, ...intentOverrides }
  let trayMenus = 0
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
          update: () => undefined,
          showError: () => undefined,
          destroy: () => undefined
        })
      },
      broadcastProductState: () => undefined
    },
    dialogs: {
      showError: () => undefined,
      confirmShutdownRetry: () => Promise.resolve('cancel'),
      warnShortcutsUnavailable: () => undefined,
      pickApplicationFile: () => Promise.resolve(null)
    },
    icons: { applicationIconDataUrl: () => Promise.resolve(null) },
    system: {
      application: { exit: () => undefined },
      shortcutRegistrations: { register: () => true, unregister: () => undefined },
      powerMonitor: { on: () => undefined, off: () => undefined },
      registerEmergencyRestoreShortcut: () => true,
      onDisplayEvent: () => undefined
    },
    notifications: { isSupported: () => false, show: () => undefined }
  }
  return {
    runtime: createProductRuntime(ports),
    client,
    logger,
    trayMenusCreated: () => trayMenus,
    intent: () => intent
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
