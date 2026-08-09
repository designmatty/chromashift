import {
  JsonProfileRepository,
  type ColorProfile,
  type ProfileConfiguration,
  type ProfileConfigurationStorage
} from '@chromashift/core'
import {
  NativeServiceError,
  type BaselineCaptureResult,
  type DisplayApplyResult,
  type DisplayRestoreResult,
  type DisplaySettings,
  type NativeEvent,
  type RestoreAllResult
} from '@chromashift/native-client'
import { describe, expect, it } from 'vitest'
import { ActivationCoordinator, type NativeActivationPort } from './activation-coordinator.js'
import { AutomaticActivationController } from './automatic-activation-controller.js'
import type { StructuredLogEvent, StructuredLogger } from './structured-logger.js'

class MemoryStorage implements ProfileConfigurationStorage {
  public constructor(private contents: string | null) {}

  public async read(): Promise<string | null> {
    return this.contents
  }

  public async write(contents: string): Promise<void> {
    this.contents = contents
  }
}

class RecordingLogger implements StructuredLogger {
  public readonly events: StructuredLogEvent[] = []

  public write(event: StructuredLogEvent): void {
    this.events.push(event)
  }
}

type NativeCall = {
  operation: 'capture' | 'apply' | 'restore' | 'restoreAll'
  displayId?: string
  settings?: DisplaySettings
}

class FakeNativeActivationPort implements NativeActivationPort {
  public readonly calls: NativeCall[] = []
  public readonly failApplyDisplayIds = new Set<string>()
  public readonly failRestoreAllDisplayIds = new Set<string>()
  public maxConcurrentCalls = 0
  readonly #capturedDisplayIds = new Set<string>()
  #activeCalls = 0

  public constructor(private readonly delayMs = 0) {}

  public captureBaseline(displayId: string): Promise<BaselineCaptureResult> {
    return this.#call({ operation: 'capture', displayId }, async () => {
      const alreadyCaptured = this.#capturedDisplayIds.has(displayId)
      this.#capturedDisplayIds.add(displayId)
      return { displayId, state: alreadyCaptured ? 'alreadyCaptured' : 'captured' }
    })
  }

  public applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    return this.#call({ operation: 'apply', displayId, settings }, async () => {
      if (this.failApplyDisplayIds.has(displayId)) {
        throw new NativeServiceError(
          'CAPABILITY_UNSUPPORTED',
          `Unsupported on ${displayId}`,
          'display.apply',
          'test-request'
        )
      }
      return { displayId, settings, applied: {} }
    })
  }

  public restoreDisplay(displayId: string): Promise<DisplayRestoreResult> {
    return this.#call({ operation: 'restore', displayId }, async () => {
      const restored = this.#capturedDisplayIds.delete(displayId)
      return restored
        ? { displayId, restored: true }
        : { displayId, restored: false, reason: 'baselineNotCaptured' }
    })
  }

  public restoreAllBaselines(): Promise<RestoreAllResult> {
    return this.#call({ operation: 'restoreAll' }, async () => {
      const displays = [...this.#capturedDisplayIds].map((displayId) => {
        if (this.failRestoreAllDisplayIds.has(displayId)) {
          return { displayId, restored: false as const, error: `Restore failed on ${displayId}` }
        }
        this.#capturedDisplayIds.delete(displayId)
        return { displayId, restored: true as const }
      })
      return { displays }
    })
  }

  async #call<T>(call: NativeCall, operation: () => Promise<T>): Promise<T> {
    this.calls.push(call)
    this.#activeCalls += 1
    this.maxConcurrentCalls = Math.max(this.maxConcurrentCalls, this.#activeCalls)
    try {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs))
      }
      return await operation()
    } finally {
      this.#activeCalls -= 1
    }
  }
}

function profile(
  id: string,
  color: ColorProfile['color'],
  displayIds: string[],
  executableName?: string
): ColorProfile {
  return {
    id,
    name: id,
    enabled: true,
    color,
    applications: executableName === undefined ? [] : [{ executableName }],
    displays: displayIds.map((displayId) => ({ displayId }))
  }
}

function configuration(
  profiles: ColorProfile[],
  defaultProfileId: string | null = null
): ProfileConfiguration {
  return {
    schemaVersion: 1,
    profiles,
    settings: { defaultProfileId }
  }
}

function repository(configuration: ProfileConfiguration): JsonProfileRepository {
  return new JsonProfileRepository(new MemoryStorage(JSON.stringify(configuration)))
}

function application(executable: string): { executable: string; path: null } {
  return { executable, path: null }
}

const defaultProfile = profile('default', { saturation: 50 }, ['display:one'])
const gameAProfile = profile('game-a', { saturation: 75 }, ['display:one'], 'GameA.exe')
const gameBProfile = profile('game-b', { gamma: 1.2 }, ['display:two'], 'GameB.exe')

describe('ActivationCoordinator', () => {
  it('applies foreground and default transitions from a captured baseline and skips duplicates', async () => {
    const native = new FakeNativeActivationPort()
    const logger = new RecordingLogger()
    const coordinator = new ActivationCoordinator(
      repository(configuration([defaultProfile, gameAProfile], 'default')),
      native,
      logger
    )

    await expect(coordinator.activate(application('Browser.exe'))).resolves.toMatchObject({
      status: 'activated',
      resolution: { reason: 'defaultProfile' }
    })
    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'activated',
      resolution: { reason: 'foregroundApplication' }
    })
    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'skipped'
    })
    await coordinator.activate(application('Browser.exe'))

    expect(native.calls.filter((call) => call.operation === 'capture')).toHaveLength(3)
    expect(
      native.calls
        .filter((call) => call.operation === 'apply')
        .map((call) => call.settings?.saturation)
    ).toEqual([50, 75, 50])
    expect(logger.events).toContainEqual(
      expect.objectContaining({
        eventName: 'ProfileMatched',
        profileId: 'game-a',
        reason: 'foregroundApplication',
        matchType: 'filename'
      })
    )
    expect(logger.events).toContainEqual(
      expect.objectContaining({
        eventName: 'ProfileActivationSkipped',
        reason: 'targetUnchanged'
      })
    )
  })

  it('restores stale display targets and returns to baseline when no profile applies', async () => {
    const native = new FakeNativeActivationPort()
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile, gameBProfile])),
      native,
      new RecordingLogger()
    )

    await coordinator.activate(application('GameA.exe'))
    await coordinator.activate(application('GameB.exe'))
    await expect(coordinator.activate(application('Browser.exe'))).resolves.toMatchObject({
      status: 'activated',
      resolution: { target: { kind: 'baseline' } }
    })

    expect(native.calls.map((call) => `${call.operation}:${call.displayId ?? 'all'}`)).toEqual([
      'capture:display:one',
      'apply:display:one',
      'restore:display:one',
      'capture:display:two',
      'apply:display:two',
      'restoreAll:all'
    ])
  })

  it('serializes rapid foreground changes without interleaving native writes', async () => {
    const native = new FakeNativeActivationPort(2)
    const coordinator = new ActivationCoordinator(
      repository(configuration([defaultProfile, gameAProfile, gameBProfile], 'default')),
      native,
      new RecordingLogger()
    )

    const outcomes = await Promise.all([
      coordinator.activate(application('GameA.exe')),
      coordinator.activate(application('Browser.exe')),
      coordinator.activate(application('GameB.exe'))
    ])

    expect(outcomes.map((outcome) => outcome.resolution?.target)).toEqual([
      { kind: 'profile', profileId: 'game-a' },
      { kind: 'profile', profileId: 'default' },
      { kind: 'profile', profileId: 'game-b' }
    ])
    expect(native.maxConcurrentCalls).toBe(1)
    expect(
      native.calls
        .filter((call) => call.operation === 'apply')
        .map((call) => call.displayId)
    ).toEqual(['display:one', 'display:one', 'display:two'])
  })

  it('surfaces partial capability failures, continues other displays, and permits retry', async () => {
    const native = new FakeNativeActivationPort()
    native.failApplyDisplayIds.add('display:one')
    const logger = new RecordingLogger()
    const multiDisplay = profile(
      'multi',
      { saturation: 80 },
      ['display:one', 'display:two'],
      'Multi.exe'
    )
    const coordinator = new ActivationCoordinator(
      repository(configuration([multiDisplay])),
      native,
      logger
    )

    const first = await coordinator.activate(application('Multi.exe'))
    const second = await coordinator.activate(application('Multi.exe'))

    expect(first).toMatchObject({
      status: 'partialFailure',
      failures: [
        {
          operation: 'apply',
          displayId: 'display:one',
          code: 'CAPABILITY_UNSUPPORTED'
        }
      ]
    })
    expect(second.status).toBe('partialFailure')
    expect(native.calls.filter((call) => call.operation === 'apply')).toHaveLength(4)
    expect(logger.events).toContainEqual(
      expect.objectContaining({
        eventName: 'DisplaySettingFailed',
        code: 'CAPABILITY_UNSUPPORTED'
      })
    )
  })

  it('invalidates duplicate suppression after external restore and native restart', async () => {
    const native = new FakeNativeActivationPort()
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile])),
      native,
      new RecordingLogger()
    )

    await coordinator.activate(application('GameA.exe'))
    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'skipped'
    })
    await coordinator.resetAfterExternalRestore()
    await coordinator.activate(application('GameA.exe'))
    await coordinator.resetAfterNativeServiceRestart()
    await coordinator.activate(application('GameA.exe'))

    expect(native.calls.filter((call) => call.operation === 'apply')).toHaveLength(3)
  })

  it('reports per-display restore-all failures without rejecting the transition', async () => {
    const native = new FakeNativeActivationPort()
    const logger = new RecordingLogger()
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile])),
      native,
      logger
    )
    await coordinator.activate(application('GameA.exe'))
    native.failRestoreAllDisplayIds.add('display:one')

    await expect(coordinator.activate(application('Browser.exe'))).resolves.toMatchObject({
      status: 'partialFailure',
      failures: [
        {
          operation: 'restoreAll',
          displayId: 'display:one',
          message: 'Restore failed on display:one'
        }
      ]
    })
    expect(logger.events).toContainEqual(
      expect.objectContaining({ eventName: 'ProfileActivationFailed' })
    )
  })
})

function foregroundEvent(executable: string): NativeEvent {
  return {
    event: 'foregroundApplicationChanged',
    data: {
      application: {
        pid: 42,
        executable,
        path: null,
        title: executable,
        monitorDeviceName: '\\\\.\\DISPLAY1'
      }
    }
  }
}

describe('AutomaticActivationController', () => {
  it('buffers foreground events until configuration is validated and then enables automation', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(
      configuration([defaultProfile, gameAProfile], 'default')
    )
    const coordinator = new ActivationCoordinator(
      profileRepository,
      native,
      new RecordingLogger()
    )
    const controller = new AutomaticActivationController(
      profileRepository,
      coordinator,
      new RecordingLogger()
    )

    await controller.handleNativeEvent(foregroundEvent('GameA.exe'))
    await controller.start(application('Browser.exe'))

    expect(controller.enabled).toBe(true)
    expect(
      native.calls
        .filter((call) => call.operation === 'apply')
        .map((call) => call.settings?.saturation)
    ).toEqual([50, 75])
  })

  it('does not enable or process buffered events when persisted configuration is invalid', async () => {
    const profileRepository = new JsonProfileRepository(new MemoryStorage('{'))
    const native = new FakeNativeActivationPort()
    const logger = new RecordingLogger()
    const coordinator = new ActivationCoordinator(profileRepository, native, logger)
    const controller = new AutomaticActivationController(
      profileRepository,
      coordinator,
      logger
    )

    await controller.handleNativeEvent(foregroundEvent('GameA.exe'))
    await expect(controller.start(null)).rejects.toThrow('not valid JSON')

    expect(controller.enabled).toBe(false)
    expect(native.calls).toEqual([])
    expect(logger.events).toContainEqual(
      expect.objectContaining({ eventName: 'AutomaticActivationDisabled' })
    )
  })

  it('disables and resets activation state on native exit before a restart', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([gameAProfile]))
    const coordinator = new ActivationCoordinator(
      profileRepository,
      native,
      new RecordingLogger()
    )
    const controller = new AutomaticActivationController(
      profileRepository,
      coordinator,
      new RecordingLogger()
    )
    await controller.start(application('GameA.exe'))

    await controller.handleNativeServiceExit()
    await controller.start(application('GameA.exe'))

    expect(controller.enabled).toBe(true)
    expect(native.calls.filter((call) => call.operation === 'apply')).toHaveLength(2)
  })

  it('supports manual profile selection, automatic mode, and an explicit baseline reset', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(
      configuration([defaultProfile, gameAProfile], 'default')
    )
    const coordinator = new ActivationCoordinator(
      profileRepository,
      native,
      new RecordingLogger()
    )
    const controller = new AutomaticActivationController(
      profileRepository,
      coordinator,
      new RecordingLogger()
    )
    await controller.start(application('Browser.exe'))

    await expect(controller.selectManualProfile('game-a')).resolves.toMatchObject({
      status: 'activated',
      resolution: { reason: 'manualOverride' }
    })
    await controller.handleNativeEvent(foregroundEvent('Browser.exe'))
    await expect(controller.enableAutomatic()).resolves.toMatchObject({
      status: 'activated',
      resolution: { reason: 'defaultProfile' }
    })
    await expect(controller.restoreBaseline()).resolves.toMatchObject({
      status: 'activated',
      resolution: { target: { kind: 'baseline' } }
    })

    expect(controller.state).toMatchObject({
      enabled: true,
      mode: { kind: 'automatic' },
      currentTarget: { kind: 'baseline' }
    })
    expect(
      native.calls.filter((call) => call.operation === 'apply')
    ).toHaveLength(3)
    expect(native.calls.at(-1)).toEqual({ operation: 'restoreAll' })
  })

  it('retains failed baseline resets so a later transition retries stale displays', async () => {
    const native = new FakeNativeActivationPort()
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile, gameBProfile])),
      native,
      new RecordingLogger()
    )
    await coordinator.activate(application('GameA.exe'))
    native.failRestoreAllDisplayIds.add('display:one')

    await expect(coordinator.restoreBaseline()).resolves.toMatchObject({
      status: 'partialFailure',
      failures: [{ operation: 'restoreAll', displayId: 'display:one' }]
    })
    native.failRestoreAllDisplayIds.clear()
    await coordinator.activate(application('GameB.exe'))

    expect(native.calls.map((call) => `${call.operation}:${call.displayId ?? 'all'}`)).toEqual([
      'capture:display:one',
      'apply:display:one',
      'restoreAll:all',
      'restore:display:one',
      'capture:display:two',
      'apply:display:two'
    ])
  })
})
