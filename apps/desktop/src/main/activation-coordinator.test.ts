import {
  JsonProfileRepository,
  manualActivationMode,
  type ColorProfile,
  type ColorSettings,
  type ProfileConfiguration,
  type ProfileConfigurationStorage
} from '@chromashift/core'
import type { NativeEvent } from '@chromashift/native-client'
import { describe, expect, it } from 'vitest'
import { ActivationCoordinator } from './activation-coordinator.js'
import { AutomaticActivationController } from './automatic-activation-controller.js'
import { FakeNativeDisplayPort as FakeNativeActivationPort } from './testing/fake-native-display.js'
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

function profile(
  id: string,
  color: ColorSettings,
  displayIds: string[],
  executableName?: string
): ColorProfile {
  return targetedProfile(
    id,
    displayIds.map((displayId) => ({ displayId, color })),
    executableName
  )
}

function targetedProfile(
  id: string,
  displays: ColorProfile['displays'],
  executableName?: string
): ColorProfile {
  return {
    id,
    name: id,
    enabled: true,
    applications: executableName === undefined ? [] : [{ executableName }],
    displays
  }
}

function configuration(
  profiles: ColorProfile[],
  defaultProfileId: string | null = null
): ProfileConfiguration {
  return {
    schemaVersion: 2,
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

  it('applies a different payload to each display in one profile', async () => {
    const native = new FakeNativeActivationPort()
    const perDisplay = targetedProfile(
      'per-display',
      [
        { displayId: 'display:one', color: { saturation: 75 } },
        { displayId: 'display:two', color: { brightness: 30, gamma: 1.4 } }
      ],
      'Multi.exe'
    )
    const coordinator = new ActivationCoordinator(
      repository(configuration([perDisplay])),
      native,
      new RecordingLogger()
    )

    await expect(coordinator.activate(application('Multi.exe'))).resolves.toMatchObject({
      status: 'activated'
    })

    expect(
      native.calls
        .filter((call) => call.operation === 'apply')
        .map((call) => [call.displayId, call.settings])
    ).toEqual([
      ['display:one', { saturation: 75 }],
      ['display:two', { brightness: 30, gamma: 1.4 }]
    ])
  })

  it('leaves an empty target at baseline and issues no apply write for it', async () => {
    const native = new FakeNativeActivationPort()
    const mixed = targetedProfile(
      'mixed',
      [
        { displayId: 'display:one', color: { saturation: 75 } },
        { displayId: 'display:two', color: {} }
      ],
      'Mixed.exe'
    )
    const coordinator = new ActivationCoordinator(
      repository(configuration([mixed])),
      native,
      new RecordingLogger()
    )

    await coordinator.activate(application('Mixed.exe'))

    expect(native.calls.map((call) => `${call.operation}:${call.displayId ?? 'all'}`)).toEqual([
      'capture:display:one',
      'apply:display:one'
    ])
  })

  it('restores a display whose target became empty in the next profile', async () => {
    const native = new FakeNativeActivationPort()
    const both = targetedProfile(
      'both',
      [
        { displayId: 'display:one', color: { saturation: 75 } },
        { displayId: 'display:two', color: { brightness: 30 } }
      ],
      'Both.exe'
    )
    const onlyOne = targetedProfile(
      'only-one',
      [
        { displayId: 'display:one', color: { saturation: 75 } },
        { displayId: 'display:two', color: {} }
      ],
      'OnlyOne.exe'
    )
    const coordinator = new ActivationCoordinator(
      repository(configuration([both, onlyOne])),
      native,
      new RecordingLogger()
    )

    await coordinator.activate(application('Both.exe'))
    await coordinator.activate(application('OnlyOne.exe'))

    expect(native.calls.map((call) => `${call.operation}:${call.displayId ?? 'all'}`)).toEqual([
      'capture:display:one',
      'apply:display:one',
      'capture:display:two',
      'apply:display:two',
      'restore:display:two',
      'capture:display:one',
      'apply:display:one'
    ])
  })

  it('isolates a capability failure on one display from the others', async () => {
    const native = new FakeNativeActivationPort()
    native.failApplyDisplayIds.add('display:one')
    const perDisplay = targetedProfile(
      'per-display',
      [
        { displayId: 'display:one', color: { colorTemperature: 60 } },
        { displayId: 'display:two', color: { brightness: 30 } }
      ],
      'Multi.exe'
    )
    const coordinator = new ActivationCoordinator(
      repository(configuration([perDisplay])),
      native,
      new RecordingLogger()
    )

    const outcome = await coordinator.activate(application('Multi.exe'))

    expect(outcome).toMatchObject({
      status: 'partialFailure',
      failures: [{ operation: 'apply', displayId: 'display:one' }]
    })
    expect(outcome.failures).toHaveLength(1)
    expect(
      native.calls
        .filter((call) => call.operation === 'apply')
        .map((call) => [call.displayId, call.settings])
    ).toEqual([
      ['display:one', { colorTemperature: 60 }],
      ['display:two', { brightness: 30 }]
    ])
  })

  it('applies targets in persisted order across displays', async () => {
    const native = new FakeNativeActivationPort()
    const ordered = targetedProfile(
      'ordered',
      [
        { displayId: 'display:three', color: { hue: 10 } },
        { displayId: 'display:one', color: { hue: 20 } },
        { displayId: 'display:two', color: { hue: 30 } }
      ],
      'Ordered.exe'
    )
    const coordinator = new ActivationCoordinator(
      repository(configuration([ordered])),
      native,
      new RecordingLogger()
    )

    await coordinator.activate(application('Ordered.exe'))

    expect(
      native.calls.filter((call) => call.operation === 'apply').map((call) => call.displayId)
    ).toEqual(['display:three', 'display:one', 'display:two'])
  })

  it('leaves a connected display the default profile does not target at baseline', async () => {
    const native = new FakeNativeActivationPort()
    const defaultOnOne = targetedProfile('default', [
      { displayId: 'display:one', color: { saturation: 50 } }
    ])
    const coordinator = new ActivationCoordinator(
      repository(configuration([defaultOnOne], 'default')),
      native,
      new RecordingLogger()
    )

    await coordinator.activate(application('Browser.exe'))

    expect(native.calls.map((call) => call.displayId)).toEqual(['display:one', 'display:one'])
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
      native.calls.filter((call) => call.operation === 'apply').map((call) => call.displayId)
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

  it('defers an HDR target without capture or writes and reapplies after HDR turns off', async () => {
    const native = new FakeNativeActivationPort()
    native.hdrDisplayIds.add('display:one')
    const logger = new RecordingLogger()
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile])),
      native,
      logger
    )

    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: ['display:one'],
      failures: []
    })
    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'skipped'
    })
    expect(native.calls).toEqual([])

    native.hdrDisplayIds.clear()
    await coordinator.resetForDisplayTransition()
    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: []
    })
    expect(native.calls.map((call) => call.operation)).toEqual(['capture', 'apply'])
    expect(logger.events).toContainEqual(
      expect.objectContaining({
        eventName: 'DisplaySettingDeferred',
        displayId: 'display:one',
        reason: 'hdrActive'
      })
    )
  })

  it('defers a disconnected profile target without native writes and applies it after reconnect', async () => {
    const native = new FakeNativeActivationPort()
    native.disconnectedDisplayIds.add('display:one')
    const logger = new RecordingLogger()
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile])),
      native,
      logger
    )

    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: ['display:one'],
      failures: []
    })
    expect(native.calls).toEqual([])

    native.disconnectedDisplayIds.clear()
    await coordinator.resetForDisplayTransition()
    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: []
    })
    expect(native.calls.map((call) => call.operation)).toEqual(['capture', 'apply'])
    expect(logger.events).toContainEqual(
      expect.objectContaining({
        eventName: 'DisplaySettingDeferred',
        displayId: 'display:one',
        reason: 'displayDisconnected'
      })
    )
  })

  it('defers a target that disconnects between enumeration and apply', async () => {
    const native = new FakeNativeActivationPort()
    native.disconnectOnApplyDisplayIds.add('display:one')
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile])),
      native,
      new RecordingLogger()
    )

    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: ['display:one'],
      failures: []
    })
    expect(native.calls.map((call) => call.operation)).toEqual(['capture', 'apply'])

    native.disconnectedDisplayIds.clear()
    await coordinator.resetForDisplayTransition()
    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: []
    })
    expect(native.calls.map((call) => call.operation)).toEqual([
      'capture',
      'apply',
      'capture',
      'apply'
    ])
  })

  it('retains and restores a baseline when its display disconnects before a profile switch', async () => {
    const native = new FakeNativeActivationPort()
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile, gameBProfile])),
      native,
      new RecordingLogger()
    )

    await coordinator.activate(application('GameA.exe'))
    native.disconnectedDisplayIds.add('display:one')
    await coordinator.resetForDisplayTransition()
    await expect(coordinator.activate(application('GameB.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: ['display:one'],
      failures: []
    })
    expect(native.calls.map((call) => call.operation)).toEqual([
      'capture',
      'apply',
      'capture',
      'apply'
    ])

    native.disconnectedDisplayIds.clear()
    await coordinator.resetForDisplayTransition()
    await expect(coordinator.activate(application('GameB.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: []
    })
    expect(native.calls.map((call) => call.operation)).toEqual([
      'capture',
      'apply',
      'capture',
      'apply',
      'restore',
      'capture',
      'apply'
    ])
  })

  it('defers restore-all for a disconnected display and retries after reconnect', async () => {
    const native = new FakeNativeActivationPort()
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile])),
      native,
      new RecordingLogger()
    )

    await coordinator.activate(application('GameA.exe'))
    native.disconnectedDisplayIds.add('display:one')
    await coordinator.resetAfterExternalRestore(['display:one'])
    await expect(coordinator.activate(application('Browser.exe'))).resolves.toMatchObject({
      status: 'skipped',
      deferredDisplayIds: ['display:one'],
      failures: []
    })

    native.disconnectedDisplayIds.clear()
    await coordinator.resetForDisplayTransition()
    await expect(coordinator.activate(application('Browser.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: []
    })
    expect(native.calls.map((call) => call.operation)).toEqual([
      'capture',
      'apply',
      'restoreAll',
      'restoreAll'
    ])
  })

  it('retains an SDR baseline through HDR and restores it once HDR turns off', async () => {
    const native = new FakeNativeActivationPort()
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile])),
      native,
      new RecordingLogger()
    )

    await coordinator.activate(application('GameA.exe'))
    native.hdrDisplayIds.add('display:one')
    await coordinator.resetForDisplayTransition()
    await expect(coordinator.activate(application('Browser.exe'))).resolves.toMatchObject({
      status: 'skipped',
      deferredDisplayIds: ['display:one'],
      failures: []
    })
    await expect(coordinator.activate(application('Browser.exe'))).resolves.toMatchObject({
      status: 'skipped'
    })

    native.hdrDisplayIds.clear()
    await coordinator.resetForDisplayTransition()
    await expect(coordinator.activate(application('Browser.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: []
    })
    expect(native.calls.map((call) => call.operation)).toEqual([
      'capture',
      'apply',
      'restoreAll',
      'restoreAll'
    ])
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

function foregroundEvent(executable: string, pid = 42): NativeEvent {
  return {
    event: 'foregroundApplicationChanged',
    data: {
      application: {
        pid,
        executable,
        path: null,
        title: executable,
        monitorDeviceName: '\\\\.\\DISPLAY1'
      }
    }
  }
}

describe('AutomaticActivationController', () => {
  it('hydrates a persisted Paused intent without display reads or writes until resume', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([defaultProfile, gameAProfile], 'default'))
    const controller = new AutomaticActivationController(
      profileRepository,
      new ActivationCoordinator(profileRepository, native, new RecordingLogger()),
      new RecordingLogger()
    )

    await controller.startSuspended(application('Browser.exe'), manualActivationMode('game-a'), {
      kind: 'profile',
      profileId: 'game-a'
    })
    await controller.handleNativeEvent(foregroundEvent('Browser.exe'))

    expect(native.calls).toEqual([])
    expect(controller.state).toMatchObject({
      enabled: true,
      mode: { kind: 'manual', profileId: 'game-a' },
      currentTarget: { kind: 'profile', profileId: 'game-a' }
    })

    await controller.resumeCurrent(application('Browser.exe'))

    expect(native.calls.map((call) => call.operation)).toEqual(['capture', 'apply'])
  })

  it('buffers foreground events until configuration is validated and then enables automation', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([defaultProfile, gameAProfile], 'default'))
    const coordinator = new ActivationCoordinator(profileRepository, native, new RecordingLogger())
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
    const controller = new AutomaticActivationController(profileRepository, coordinator, logger)

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
    const coordinator = new ActivationCoordinator(profileRepository, native, new RecordingLogger())
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
    const profileRepository = repository(configuration([defaultProfile, gameAProfile], 'default'))
    const coordinator = new ActivationCoordinator(profileRepository, native, new RecordingLogger())
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
    expect(native.calls.filter((call) => call.operation === 'apply')).toHaveLength(3)
    expect(native.calls.at(-1)).toEqual({ operation: 'restoreAll' })
  })

  it('publishes completed outcomes with their activation source and origin', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([defaultProfile, gameAProfile], 'default'))
    const coordinator = new ActivationCoordinator(profileRepository, native, new RecordingLogger())
    const controller = new AutomaticActivationController(
      profileRepository,
      coordinator,
      new RecordingLogger()
    )
    const completed: Array<{ source: string; origin: string; status: string }> = []
    controller.subscribeOutcomes((outcome) => {
      completed.push({ source: outcome.source, origin: outcome.origin, status: outcome.status })
    })

    await expect(controller.start(application('Browser.exe'))).resolves.toMatchObject({
      source: 'automatic',
      origin: 'startup',
      status: 'activated'
    })
    await expect(controller.selectManualProfile('game-a')).resolves.toMatchObject({
      source: 'manual',
      origin: 'profileSelection',
      status: 'activated'
    })
    await expect(controller.enableAutomatic()).resolves.toMatchObject({
      source: 'manual',
      origin: 'automaticSelection',
      status: 'activated'
    })
    await expect(controller.restoreBaseline()).resolves.toMatchObject({
      source: 'manual',
      origin: 'originalSettingsRestore',
      status: 'activated'
    })

    expect(completed).toEqual([
      { source: 'automatic', origin: 'startup', status: 'activated' },
      { source: 'manual', origin: 'profileSelection', status: 'activated' },
      { source: 'manual', origin: 'automaticSelection', status: 'activated' },
      { source: 'manual', origin: 'originalSettingsRestore', status: 'activated' }
    ])
  })

  it('suspends writes during preview and applies the latest foreground target on rollback', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([defaultProfile, gameAProfile], 'default'))
    const controller = new AutomaticActivationController(
      profileRepository,
      new ActivationCoordinator(profileRepository, native, new RecordingLogger()),
      new RecordingLogger()
    )
    await controller.start(application('Browser.exe'))

    await controller.beginPreview()
    await controller.handleNativeEvent(foregroundEvent('GameA.exe'))
    expect(native.calls.filter((call) => call.operation === 'apply')).toHaveLength(1)

    await controller.cancelPreview()

    expect(
      native.calls
        .filter((call) => call.operation === 'apply')
        .map((call) => call.settings?.saturation)
    ).toEqual([50, 75])
  })

  it('preserves a preview-owned baseline while its display is disconnected', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([gameAProfile]))
    const controller = new AutomaticActivationController(
      profileRepository,
      new ActivationCoordinator(profileRepository, native, new RecordingLogger()),
      new RecordingLogger()
    )
    await controller.start(application('GameA.exe'))

    await controller.beginPreview()
    native.disconnectedDisplayIds.add('display:one')
    await controller.cancelPreview(['display:one'])

    expect(native.calls.map((call) => call.operation)).toEqual(['capture', 'apply'])

    native.disconnectedDisplayIds.clear()
    await controller.beginSystemTransition()
    await controller.completeSystemTransition(true)

    expect(native.calls.map((call) => call.operation)).toEqual([
      'capture',
      'apply',
      'capture',
      'apply'
    ])
  })

  it('ignores ChromaShift foreground events so saving restores the external application profile', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([defaultProfile, gameAProfile], 'default'))
    const controller = new AutomaticActivationController(
      profileRepository,
      new ActivationCoordinator(profileRepository, native, new RecordingLogger()),
      new RecordingLogger(),
      (foreground) => foreground?.pid === 99
    )
    await controller.start(application('GameA.exe'))

    await controller.beginPreview()
    await controller.handleNativeEvent(foregroundEvent('electron.exe', 99))
    await controller.cancelPreview()

    expect(controller.state.currentTarget).toEqual({ kind: 'profile', profileId: 'game-a' })
    expect(
      native.calls
        .filter((call) => call.operation === 'apply')
        .map((call) => call.settings?.saturation)
    ).toEqual([75, 75])
  })

  it('buffers foreground changes during an OS transition and force-reapplies the latest target', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([defaultProfile, gameAProfile], 'default'))
    const controller = new AutomaticActivationController(
      profileRepository,
      new ActivationCoordinator(profileRepository, native, new RecordingLogger()),
      new RecordingLogger()
    )
    await controller.start(application('Browser.exe'))

    await controller.beginSystemTransition()
    await controller.handleNativeEvent(foregroundEvent('GameA.exe'))
    expect(native.calls.filter((call) => call.operation === 'apply')).toHaveLength(1)

    await controller.completeSystemTransition(true)

    expect(
      native.calls
        .filter((call) => call.operation === 'apply')
        .map((call) => call.settings?.saturation)
    ).toEqual([50, 75])
    expect(controller.state.currentTarget).toEqual({ kind: 'profile', profileId: 'game-a' })
  })

  it('keeps profile writes blocked when topology ownership validation fails', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([gameAProfile]))
    const controller = new AutomaticActivationController(
      profileRepository,
      new ActivationCoordinator(profileRepository, native, new RecordingLogger()),
      new RecordingLogger()
    )
    await controller.start(application('GameA.exe'))
    await controller.beginSystemTransition()
    await controller.completeSystemTransition(false, false)

    await expect(controller.selectManualProfile('game-a')).rejects.toThrow(
      'display transition is in progress'
    )
    await controller.handleNativeEvent(foregroundEvent('GameA.exe'))

    expect(native.calls.filter((call) => call.operation === 'apply')).toHaveLength(1)
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
