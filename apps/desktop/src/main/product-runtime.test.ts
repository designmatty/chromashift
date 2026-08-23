import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PROTOCOL_VERSION,
  type DisplayTopologyRefreshResult,
  type ForegroundApplication,
  type ServiceHealth,
  type SystemInfo
} from '@chromashift/native-client'
import { afterEach, describe, expect, it } from 'vitest'
import type { UserPreferences } from '../shared/product-api.js'
import {
  defaultChromaShiftIntent,
  defaultUserPreferences,
  type ChromaShiftIntent
} from './app-settings.js'
import {
  createProductRuntime,
  type ProductRuntime,
  type ProductRuntimePorts
} from './product-runtime.js'
import type { StructuredLogEvent, StructuredLogger } from './structured-logger.js'
import { FakeNativeDisplayPort } from './testing/fake-native-display.js'

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
    return Promise.resolve(null)
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

async function createHarness(intentOverrides: Partial<ChromaShiftIntent> = {}): Promise<{
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
        }
      ],
      settings: { defaultProfileId: 'default' }
    })
  )

  const client = new FakeRuntimeNativeClient()
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
      { displayId: 'display:one', settings: { brightness: 60 } }
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
