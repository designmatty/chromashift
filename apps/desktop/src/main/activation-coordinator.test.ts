import {
  JsonProfileRepository,
  createNeutralColorSettings,
  manualActivationMode,
  type ColorProfile,
  type ColorSettings,
  type ProfileConfigurationStorage
} from '@chromashift/core'
import { NativeServiceError, type NativeEvent } from '@chromashift/native-client'
import { describe, expect, it, vi } from 'vitest'
import { ActivationCoordinator } from '@main/activation-coordinator.js'
import { AutomaticActivationController } from '@main/automatic-activation-controller.js'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { activationStateSchema } from '@shared/product-api.js'
import {
  FakeNativeDisplayPort as FakeNativeActivationPort,
  nvidiaCapabilityReport
} from '@main/testing/fake-native-display.js'
import type { StructuredLogEvent, StructuredLogger } from '@main/structured-logger.js'

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
  color: Partial<ColorSettings>,
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
  displays: Array<{ displayId: string; color: Partial<ColorSettings> }>,
  executableName?: string
): ColorProfile {
  return {
    id,
    name: id,
    enabled: true,
    applications: executableName === undefined ? [] : [{ executableName }],
    displays: displays.map((target) => ({
      displayId: target.displayId,
      color: { ...createNeutralColorSettings(), ...target.color }
    }))
  }
}

function configuration(profiles: ColorProfile[], defaultProfileId: string | null = null): object {
  return {
    schemaVersion: 2,
    profiles,
    settings: { defaultProfileId }
  }
}

function repository(configuration: object): JsonProfileRepository {
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
        .map((call) => [
          call.displayId,
          call.settings?.saturation,
          call.settings?.brightness,
          call.settings?.gamma
        ])
    ).toEqual([
      ['display:one', 75, 50, 1],
      ['display:two', 50, 30, 1.4]
    ])
  })

  it('migrates an empty legacy target to neutral settings', async () => {
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
      'apply:display:one',
      'capture:display:two',
      'apply:display:two'
    ])
  })

  it('applies neutral settings when a legacy target was empty in the next profile', async () => {
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
      'capture:display:one',
      'apply:display:one',
      'capture:display:two',
      'apply:display:two'
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
        .map((call) => [call.displayId, call.settings?.colorTemperature, call.settings?.brightness])
    ).toEqual([
      ['display:one', 60, 50],
      ['display:two', 50, 30]
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

  it('defers an Intel HDR target without capture or writes and reapplies after HDR turns off', async () => {
    const native = new FakeNativeActivationPort()
    native.intelDisplayIds.add('display:one')
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

  it('restores an SDR baseline immediately while HDR is on', async () => {
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
      status: 'activated',
      deferredDisplayIds: [],
      failures: []
    })
    await expect(coordinator.activate(application('Browser.exe'))).resolves.toMatchObject({
      status: 'skipped'
    })
    expect(native.currentSettings.get('display:one')).toEqual({})
    expect(coordinator.capturedDisplayIds).toEqual([])

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

  it.each(['game-a', 'default', 'game-b'])(
    'restores an Intel HDR display before switching to %s',
    async (next) => {
      const native = new FakeNativeActivationPort()
      native.intelDisplayIds.add('display:one')
      native.currentSettings.set('display:one', { brightness: 47, saturation: 43 })
      const coordinator = new ActivationCoordinator(
        repository(configuration([defaultProfile, gameAProfile, gameBProfile], 'default')),
        native,
        new RecordingLogger()
      )
      await coordinator.activate(null, manualActivationMode('game-a'))
      native.hdrDisplayIds.add('display:one')
      await coordinator.resetForDisplayTransition()
      const before = native.calls.length
      await expect(coordinator.activate(null, manualActivationMode(next))).resolves.toMatchObject({
        status: 'activated',
        failures: []
      })
      expect(native.calls.slice(before).filter((call) => call.displayId === 'display:one')).toEqual(
        [{ operation: 'restore', displayId: 'display:one' }]
      )
      expect(native.currentSettings.get('display:one')).toEqual({ brightness: 47, saturation: 43 })
      native.hdrDisplayIds.clear()
      await coordinator.resetForDisplayTransition()
      await coordinator.activate(null, manualActivationMode(next))
      if (next !== 'game-b') {
        expect(native.currentSettings.get('display:one')?.saturation).toBe(
          next === 'game-a' ? 75 : 50
        )
      }
    }
  )

  it('applies only NVIDIA saturation and hue under HDR and the full vector after HDR turns off', async () => {
    const native = new FakeNativeActivationPort()
    native.reports.set('display:one', nvidiaCapabilityReport('display:one'))
    native.currentSettings.set('display:one', { brightness: 47, saturation: 43, hue: 2 })
    const logger = new RecordingLogger()
    const profileOnOne = profile('game-a', { brightness: 30, saturation: 75, hue: 10 }, [
      'display:one'
    ])
    const coordinator = new ActivationCoordinator(
      repository(configuration([profileOnOne], 'game-a')),
      native,
      logger
    )
    native.hdrDisplayIds.add('display:one')

    await expect(coordinator.activate(null)).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: [],
      failures: []
    })
    // Capture under HDR, then saturation and hue only; brightness stays at baseline.
    expect(native.calls).toEqual([
      { operation: 'capture', displayId: 'display:one' },
      { operation: 'apply', displayId: 'display:one', settings: { saturation: 75, hue: 10 } }
    ])
    expect(native.currentSettings.get('display:one')).toEqual({
      brightness: 47,
      saturation: 75,
      hue: 10
    })
    expect(coordinator.hdrProjectedDisplayIds).toEqual(['display:one'])
    expect(logger.events).toContainEqual(
      expect.objectContaining({
        eventName: 'HdrSettingsWithheld',
        displayId: 'display:one',
        settings: ['brightness', 'contrast', 'gamma', 'colorTemperature']
      })
    )

    native.hdrDisplayIds.clear()
    await coordinator.resetForDisplayTransition()
    await coordinator.activate(null)
    expect(native.calls.slice(2).map((call) => call.operation)).toEqual(['capture', 'apply'])
    expect(native.calls[3]?.settings).toEqual(profileOnOne.displays[0]!.color)
    expect(native.currentSettings.get('display:one')?.brightness).toBe(30)
    expect(coordinator.hdrProjectedDisplayIds).toEqual([])
  })

  it('applies every AMD ADLX control but gamma under HDR and the full vector after HDR turns off (#122)', async () => {
    const native = new FakeNativeActivationPort()
    native.amdDisplayIds.add('display:one')
    native.currentSettings.set('display:one', { brightness: 47, gamma: 1, saturation: 43 })
    const logger = new RecordingLogger()
    const color = {
      brightness: 30,
      contrast: 60,
      gamma: 1.4,
      saturation: 75,
      hue: 10,
      colorTemperature: 40
    }
    const profileOnOne = profile('game-a', color, ['display:one'])
    const coordinator = new ActivationCoordinator(
      repository(configuration([profileOnOne], 'game-a')),
      native,
      logger
    )
    native.hdrDisplayIds.add('display:one')

    await expect(coordinator.activate(null)).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: [],
      failures: []
    })
    expect(native.calls).toEqual([
      { operation: 'capture', displayId: 'display:one' },
      {
        operation: 'apply',
        displayId: 'display:one',
        settings: { brightness: 30, contrast: 60, saturation: 75, hue: 10, colorTemperature: 40 }
      }
    ])
    // Gamma uses the Windows ramp and stays at its captured value under HDR.
    expect(native.currentSettings.get('display:one')?.gamma).toBe(1)
    expect(coordinator.hdrProjectedDisplayIds).toEqual(['display:one'])
    expect(logger.events).toContainEqual(
      expect.objectContaining({
        eventName: 'HdrSettingsWithheld',
        displayId: 'display:one',
        settings: ['gamma']
      })
    )

    native.hdrDisplayIds.clear()
    await coordinator.resetForDisplayTransition()
    await coordinator.activate(null)
    expect(native.calls.slice(2).map((call) => call.operation)).toEqual(['capture', 'apply'])
    expect(native.calls[3]?.settings).toEqual(profileOnOne.displays[0]!.color)
    expect(native.currentSettings.get('display:one')?.gamma).toBe(1.4)
    expect(coordinator.hdrProjectedDisplayIds).toEqual([])
  })

  it('restores an NVIDIA HDR display whose only supported controls are SDR-only', async () => {
    const native = new FakeNativeActivationPort()
    // No vibrance or hue interface: brightness is the only control, and it is SDR-only.
    native.reports.set('display:one', nvidiaCapabilityReport('display:one', false))
    const coordinator = new ActivationCoordinator(
      repository(configuration([profile('dim', { brightness: 30 }, ['display:one'])], 'dim')),
      native,
      new RecordingLogger()
    )
    await coordinator.activate(null)
    expect(native.currentSettings.get('display:one')?.brightness).toBe(30)

    native.hdrDisplayIds.add('display:one')
    await coordinator.resetForDisplayTransition()
    const before = native.calls.length
    await expect(coordinator.activate(null)).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: ['display:one']
    })
    expect(native.calls.slice(before)).toEqual([{ operation: 'restore', displayId: 'display:one' }])
    expect(native.currentSettings.get('display:one')).toEqual({})
  })

  it.each([
    { next: 'game-a', expected: { saturation: 75 } },
    { next: 'default', expected: { saturation: 50 } },
    { next: 'game-b', expected: undefined }
  ])(
    'switches an NVIDIA HDR display to $next with restore-then-apply',
    async ({ next, expected }) => {
      const native = new FakeNativeActivationPort()
      native.currentSettings.set('display:one', { brightness: 47, saturation: 43 })
      const coordinator = new ActivationCoordinator(
        repository(configuration([defaultProfile, gameAProfile, gameBProfile], 'default')),
        native,
        new RecordingLogger()
      )
      await coordinator.activate(null, manualActivationMode('game-a'))
      native.hdrDisplayIds.add('display:one')
      await coordinator.resetForDisplayTransition()
      const before = native.calls.length
      await coordinator.activate(null, manualActivationMode(next))
      const calls = native.calls.slice(before).filter((call) => call.displayId === 'display:one')
      if (expected === undefined) {
        // A profile without a target on the HDR display restores it.
        expect(calls).toEqual([{ operation: 'restore', displayId: 'display:one' }])
        expect(native.currentSettings.get('display:one')).toEqual({
          brightness: 47,
          saturation: 43
        })
      } else {
        expect(calls).toEqual([
          { operation: 'capture', displayId: 'display:one' },
          { operation: 'apply', displayId: 'display:one', settings: expected }
        ])
        expect(native.currentSettings.get('display:one')).toEqual({ brightness: 47, ...expected })
      }
    }
  )

  it.each([false, true])(
    'holds an HDR display at Original settings when native refuses its projection, restore fails=%s',
    async (restoreFails) => {
      const one = 'display:one'
      const two = 'display:two'
      const native = new FakeNativeActivationPort()
      // A transient NVIDIA read fails at capture: the baseline holds the ramp only.
      native.reports.set(one, nvidiaCapabilityReport(one, false))
      native.captureWithoutNvidiaDisplayIds.add(one)
      native.currentSettings.set(one, { brightness: 48 })
      const logger = new RecordingLogger()
      const both = profile('default', { brightness: 30, saturation: 85 }, [one, two])
      const next = profile('next', { saturation: 60 }, [two])
      const coordinator = new ActivationCoordinator(
        repository(configuration([both, next], 'default')),
        native,
        logger
      )
      await coordinator.activate(null)
      // A transformed SDR ramp is on screen.
      expect(native.currentSettings.get(one)?.brightness).toBe(30)

      // NVIDIA reads recover and HDR turns on; the retained baseline still lacks NVIDIA state.
      native.captureWithoutNvidiaDisplayIds.clear()
      native.reports.set(one, nvidiaCapabilityReport(one))
      native.hdrDisplayIds.add(one)
      if (restoreFails) native.failRestoreDisplayIds.add(one)
      await coordinator.resetForDisplayTransition()
      const before = native.calls.length
      const failing = coordinator.activate(null)
      const queued = coordinator.activate(null, manualActivationMode('next'))
      const outcome = await failing
      expect(outcome.failures).toContainEqual(
        expect.objectContaining({
          operation: 'apply',
          displayId: one,
          code: 'CAPABILITY_UNSUPPORTED'
        })
      )
      expect(logger.events).toContainEqual(
        expect.objectContaining({
          eventName: 'DisplaySettingFailed',
          displayId: one,
          code: 'CAPABILITY_UNSUPPORTED'
        })
      )
      expect(native.calls.slice(before).filter((call) => call.displayId === one)).toEqual([
        { operation: 'capture', displayId: one },
        { operation: 'apply', displayId: one, settings: { saturation: 85, hue: 0 } },
        { operation: 'restore', displayId: one }
      ])

      if (restoreFails) {
        // The SDR ramp stays until a confirmed restore; nothing else may write.
        expect(outcome.failures).toContainEqual(
          expect.objectContaining({ operation: 'restore', displayId: one })
        )
        expect(coordinator.restorationBlocked).toBe(true)
        expect((await queued).failures).toContainEqual(
          expect.objectContaining({ code: 'RESTORE_PENDING' })
        )
        expect(native.calls.slice(before).filter((call) => call.displayId === two)).toEqual([])
        expect(native.currentSettings.get(one)?.brightness).toBe(30)
        return
      }

      expect(native.currentSettings.get(one)).toEqual({ brightness: 48 })
      expect(coordinator.restorationBlocked).toBe(false)
      expect(coordinator.hdrProjectedDisplayIds).toEqual([])
      expect(logger.events).toContainEqual(
        expect.objectContaining({
          eventName: 'BaselineRestored',
          displayId: one,
          reason: 'hdrProjectionRefused'
        })
      )
      await queued
      // The failed target stays retryable: a fresh capture of the restored
      // original now includes NVIDIA state, and saturation applies.
      await coordinator.activate(null, manualActivationMode('default'))
      expect(native.currentSettings.get(one)).toEqual({ brightness: 48, saturation: 85, hue: 0 })
      expect(
        native.baselineCaptures
          .filter((capture) => capture.displayId === one)
          .map((c) => c.settings)
      ).toEqual([{ brightness: 48 }, { brightness: 48 }])
    }
  )

  it('retries a held HDR display on the next activation of the same target', async () => {
    const one = 'display:one'
    const native = new FakeNativeActivationPort()
    native.reports.set(one, nvidiaCapabilityReport(one, false))
    native.captureWithoutNvidiaDisplayIds.add(one)
    native.currentSettings.set(one, { brightness: 48 })
    const coordinator = new ActivationCoordinator(
      repository(configuration([profile('default', { saturation: 85 }, [one])], 'default')),
      native,
      new RecordingLogger()
    )
    await coordinator.activate(null)
    native.captureWithoutNvidiaDisplayIds.clear()
    native.reports.set(one, nvidiaCapabilityReport(one))
    native.hdrDisplayIds.add(one)
    await coordinator.resetForDisplayTransition()
    await expect(coordinator.activate(null)).resolves.toMatchObject({ status: 'partialFailure' })
    expect(native.currentSettings.get(one)).toEqual({ brightness: 48 })
    // The failed outcome reset deduplication, so the same target retries at once.
    await expect(coordinator.activate(null)).resolves.toMatchObject({
      status: 'activated',
      failures: []
    })
    expect(native.currentSettings.get(one)).toEqual({ brightness: 48, saturation: 85, hue: 0 })
  })

  it('blocks when an HDR apply and its hold both meet an ownership change', async () => {
    const native = new FakeNativeActivationPort()
    native.hdrDisplayIds.add('display:one')
    const ownershipChanged = (command: string) =>
      new NativeServiceError(
        'BASELINE_OWNERSHIP_CHANGED',
        'Adapter owner changed.',
        command,
        'test'
      )
    // Native refuses both the cleanup and the explicit restore without writing.
    vi.spyOn(native, 'applyDisplaySettings').mockRejectedValue(ownershipChanged('display.apply'))
    vi.spyOn(native, 'restoreDisplay').mockRejectedValue(ownershipChanged('display.restore'))
    const both = profile('both', { saturation: 85 }, ['display:one', 'display:two'])
    const coordinator = new ActivationCoordinator(
      repository(configuration([both], 'both')),
      native,
      new RecordingLogger()
    )
    const outcome = await coordinator.activate(null)
    expect(outcome.failures).toContainEqual(
      expect.objectContaining({ operation: 'restore', code: 'BASELINE_OWNERSHIP_CHANGED' })
    )
    expect(coordinator.restorationBlocked).toBe(true)
    expect(native.calls.filter((call) => call.displayId === 'display:two')).toEqual([])
  })

  it('never deduplicates a target that native refused with HDR_UNSAFE', async () => {
    const native = new FakeNativeActivationPort()
    const coordinator = new ActivationCoordinator(
      repository(configuration([gameAProfile])),
      native,
      new RecordingLogger()
    )
    // HDR turns on between enumeration and the write: native refuses before any write.
    vi.spyOn(native, 'applyDisplaySettings').mockRejectedValueOnce(
      new NativeServiceError('HDR_UNSAFE', 'HDR is active', 'display.apply', 'test')
    )
    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: ['display:one']
    })
    expect(coordinator.hdrProjectedDisplayIds).toEqual([])
    await expect(coordinator.activate(application('GameA.exe'))).resolves.toMatchObject({
      status: 'activated',
      deferredDisplayIds: []
    })
    expect(native.currentSettings.get('display:one')?.saturation).toBe(75)
  })

  it('stops other displays and queued work when a failed write cannot be cleaned up', async () => {
    const native = new FakeNativeActivationPort()
    native.hdrDisplayIds.add('display:one')
    native.failApplyWriteDisplayIds.add('display:one')
    native.failRestoreDisplayIds.add('display:one')
    const both = profile('both', { saturation: 75 }, ['display:one', 'display:two'])
    const next = profile('next', { saturation: 60 }, ['display:two'])
    const coordinator = new ActivationCoordinator(
      repository(configuration([both, next], 'both')),
      native,
      new RecordingLogger()
    )
    const failed = coordinator.activate(null)
    const queued = coordinator.activate(null, manualActivationMode('next'))
    expect((await failed).failures).toContainEqual(
      expect.objectContaining({
        operation: 'apply',
        displayId: 'display:one',
        code: 'BASELINE_RESTORE_FAILED'
      })
    )
    expect((await queued).failures).toContainEqual(
      expect.objectContaining({ code: 'RESTORE_PENDING' })
    )
    expect(coordinator.restorationBlocked).toBe(true)
    expect(native.calls.filter((call) => call.displayId === 'display:two')).toEqual([])
    // The modified output stays on screen until a confirmed restore.
    expect(native.currentSettings.get('display:one')?.saturation).toBe(75)

    native.failApplyWriteDisplayIds.clear()
    native.failRestoreDisplayIds.clear()
    await expect(coordinator.activate(null, undefined, { recovery: true })).resolves.toMatchObject({
      status: 'activated',
      failures: []
    })
    expect(coordinator.restorationBlocked).toBe(false)
    expect(native.currentSettings.get('display:two')?.saturation).toBe(75)
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
  it.each([
    { kind: 'manual', surface: 'panel' },
    { kind: 'automatic', surface: 'panel' },
    { kind: 'manual', surface: 'tray' },
    { kind: 'automatic', surface: 'tray' },
    { kind: 'manual', surface: 'shortcut' },
    { kind: 'automatic', surface: 'shortcut' }
  ] as const)(
    'queued $surface $kind selection governs foreground events received after it',
    async ({ kind, surface }) => {
      const native = new FakeNativeActivationPort()
      const repo = repository(
        configuration([defaultProfile, gameAProfile, gameBProfile], 'default')
      )
      const logger = new RecordingLogger()
      const coordinator = new ActivationCoordinator(repo, native, logger)
      const automatic = new AutomaticActivationController(repo, coordinator, logger)
      await automatic.start(application('Browser.exe'))
      if (kind === 'automatic') await automatic.selectManualProfile('game-b')
      let release!: () => void
      let entered!: () => void
      const reading = new Promise<void>((resolve) => {
        entered = resolve
      })
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      const getDisplays = native.getDisplays.bind(native)
      vi.spyOn(native, 'getDisplays').mockImplementationOnce(async () => {
        entered()
        await pending
        return getDisplays()
      })
      // A native transition is still draining when the user selects a mode.
      const first =
        kind === 'manual'
          ? automatic.handleNativeEvent(foregroundEvent('GameA.exe'))
          : automatic.refreshAfterConfigurationChange()
      await reading
      const queuedActivations = vi.spyOn(coordinator, 'activate')
      const assertCurrent = vi.fn(() => undefined)
      const context = {
        source: surface === 'shortcut' ? ('shortcut' as const) : ('manual' as const),
        ...(surface === 'panel' ? { assertCurrent } : {})
      }
      const selecting =
        kind === 'manual'
          ? automatic.selectManualProfile('game-b', {
              ...context,
              origin: 'profileSelection'
            })
          : automatic.enableAutomatic({
              ...context,
              origin: 'automaticSelection'
            })
      await vi.waitFor(() => expect(queuedActivations).toHaveBeenCalledOnce())
      // The panel remains open. A genuine later foreground change must use the selected mode.
      const foreground = automatic.handleNativeEvent(foregroundEvent('Browser.exe'))
      release()
      await Promise.all([first, selecting, foreground])
      expect(automatic.state.mode).toEqual(
        kind === 'manual' ? manualActivationMode('game-b') : { kind: 'automatic' }
      )
      expect({
        currentTarget: automatic.state.currentTarget,
        lastAppliedDisplay: native.applied.at(-1)?.displayId
      }).toEqual({
        currentTarget: { kind: 'profile', profileId: kind === 'manual' ? 'game-b' : 'default' },
        lastAppliedDisplay: kind === 'manual' ? 'display:two' : 'display:one'
      })
    }
  )

  it('rejects a panel choice that closes while queued and retains the preceding activation mode', async () => {
    const native = new FakeNativeActivationPort()
    const repo = repository(configuration([defaultProfile, gameAProfile, gameBProfile], 'default'))
    const logger = new RecordingLogger()
    const coordinator = new ActivationCoordinator(repo, native, logger)
    const automatic = new AutomaticActivationController(repo, coordinator, logger)
    await automatic.start(null)
    const getDisplays = native.getDisplays.bind(native)
    let release!: () => void
    let entered!: () => void
    const reading = new Promise<void>((resolve) => {
      entered = resolve
    })
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(native, 'getDisplays').mockImplementationOnce(async () => {
      entered()
      await pending
      return getDisplays()
    })
    const first = coordinator.activate(application('GameA.exe'))
    await reading
    let panelOpen = true
    const assertCurrent = vi.fn(() => {
      if (!panelOpen) throw new Error('Panel closed')
    })
    const choice = automatic.selectManualProfile('game-b', {
      source: 'manual',
      origin: 'profileSelection',
      assertCurrent
    })
    const rejected = expect(choice).rejects.toThrow('Panel closed')
    await vi.waitFor(() => expect(assertCurrent).toHaveBeenCalledOnce())
    expect(automatic.state.mode).toEqual({ kind: 'automatic' })
    panelOpen = false
    release()
    await first
    await rejected
    expect(automatic.state.mode).toEqual({ kind: 'automatic' })
    expect(native.calls.filter((call) => call.displayId === 'display:two')).toEqual([])
    await automatic.handleNativeEvent(foregroundEvent('Browser.exe'))
    expect(automatic.state.mode).toEqual({ kind: 'automatic' })
    expect(native.calls.filter((call) => call.displayId === 'display:two')).toEqual([])
  })

  it('rejects a queued Automatic choice from a closed panel before leaving Manual', async () => {
    const native = new FakeNativeActivationPort()
    const repo = repository(configuration([defaultProfile, gameAProfile, gameBProfile], 'default'))
    const logger = new RecordingLogger()
    const coordinator = new ActivationCoordinator(repo, native, logger)
    const automatic = new AutomaticActivationController(repo, coordinator, logger)
    await automatic.start(application('Browser.exe'))
    await automatic.selectManualProfile('game-b')
    let release!: () => void
    let entered!: () => void
    const reading = new Promise<void>((resolve) => {
      entered = resolve
    })
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const getDisplays = native.getDisplays.bind(native)
    vi.spyOn(native, 'getDisplays').mockImplementationOnce(async () => {
      entered()
      await pending
      return getDisplays()
    })
    const first = automatic.refreshAfterConfigurationChange()
    await reading
    let panelOpen = true
    const assertCurrent = vi.fn(() => {
      if (!panelOpen) throw new Error('Panel closed')
    })
    const choice = automatic.enableAutomatic({
      source: 'manual',
      origin: 'automaticSelection',
      assertCurrent
    })
    const rejected = expect(choice).rejects.toThrow('Panel closed')
    await vi.waitFor(() => expect(assertCurrent).toHaveBeenCalledOnce())
    expect(automatic.state.mode).toEqual(manualActivationMode('game-b'))
    const foreground = automatic.handleNativeEvent(foregroundEvent('Browser.exe'))
    panelOpen = false
    release()
    await Promise.all([first, rejected, foreground])
    expect(automatic.state.mode).toEqual(manualActivationMode('game-b'))
    expect(automatic.state.currentTarget).toEqual({ kind: 'profile', profileId: 'game-b' })
    expect(native.applied.map(({ displayId }) => displayId)).toEqual([
      'display:one',
      'display:two',
      'display:two'
    ])
  })

  it.each(['update', 'discard'] as const)(
    'publishes the latest held switch and applies it after %s',
    async (decision) => {
      const native = new FakeNativeActivationPort()
      const repo = repository(
        configuration([defaultProfile, gameAProfile, gameBProfile], 'default')
      )
      const logger = new RecordingLogger()
      const automatic = new AutomaticActivationController(
        repo,
        new ActivationCoordinator(repo, native, logger),
        logger
      )
      const preview = new PreviewSessionController(native, automatic, () => undefined)
      await automatic.start(application('Browser.exe'))
      const draft = structuredClone(defaultProfile)
      draft.name = 'Draft name'
      await preview.start(draft, 'edit', defaultProfile)
      const callsBeforeSwitch = native.calls.length
      await automatic.handleNativeEvent(foregroundEvent('GameA.exe'))
      expect(activationStateSchema.parse(automatic.state).queuedTarget).toEqual({
        kind: 'profile',
        profileId: 'game-a'
      })
      await automatic.handleNativeEvent(foregroundEvent('Browser.exe'))
      expect(automatic.state.queuedTarget).toBeNull()
      await automatic.handleNativeEvent(foregroundEvent('GameB.exe'))
      expect(native.calls).toHaveLength(callsBeforeSwitch)
      expect(automatic.state.queuedTarget).toEqual({ kind: 'profile', profileId: 'game-b' })
      if (decision === 'update') {
        await repo.save(draft)
        await preview.completePreservingMode(draft.id)
      } else await preview.cancel()
      expect(automatic.state.currentTarget).toEqual({ kind: 'profile', profileId: 'game-b' })
      expect(automatic.state.queuedTarget).toBeNull()
      expect(native.calls.filter((call) => call.operation === 'apply').at(-1)).toMatchObject({
        displayId: 'display:two',
        settings: { gamma: 1.2 }
      })
    }
  )

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

  it('resumes a failed topology hold after the caller validates recovery', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([gameAProfile, gameBProfile]))
    const controller = new AutomaticActivationController(
      profileRepository,
      new ActivationCoordinator(profileRepository, native, new RecordingLogger()),
      new RecordingLogger()
    )
    await controller.start(application('GameA.exe'))
    await controller.beginSystemTransition()
    await controller.completeSystemTransition(false, false)
    native.calls.length = 0
    await controller.resumeCurrent(application('GameB.exe'))
    expect(native.calls.filter((call) => call.operation === 'apply')).toMatchObject([
      { displayId: 'display:two' }
    ])
    await expect(controller.selectManualProfile('game-a')).resolves.toMatchObject({
      status: 'activated'
    })
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

  it('continues a preview hold only where a new preview could begin, without writing the live target', async () => {
    const native = new FakeNativeActivationPort()
    const profileRepository = repository(configuration([defaultProfile, gameAProfile], 'default'))
    const controller = new AutomaticActivationController(
      profileRepository,
      new ActivationCoordinator(profileRepository, native, new RecordingLogger()),
      new RecordingLogger()
    )
    await controller.start(application('Browser.exe'))
    const applies = () => native.calls.filter((call) => call.operation === 'apply')

    await expect(controller.continuePreview()).rejects.toThrow('No display preview is active.')
    await expect(controller.beginPreview()).resolves.toEqual(['display:one'])
    await controller.handleNativeEvent(foregroundEvent('GameA.exe'))
    await expect(controller.continuePreview()).resolves.toEqual(['display:one'])
    expect(controller.state.queuedTarget).toEqual({ kind: 'profile', profileId: 'game-a' })
    expect(controller.state.currentTarget).toEqual({ kind: 'profile', profileId: 'default' })
    expect(applies()).toHaveLength(1)

    await controller.beginSystemTransition()
    await expect(controller.continuePreview()).rejects.toThrow(
      'A display transition is in progress.'
    )
    await controller.completeSystemTransition(true)
    await expect(controller.continuePreview()).resolves.toEqual(['display:one'])
    await controller.suspendWrites()
    await expect(controller.continuePreview()).rejects.toThrow('Restore the pending displays')
    expect(applies()).toHaveLength(1)
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

  it('retains failed baseline resets and requires explicit recovery before later transitions', async () => {
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
    await expect(coordinator.activate(application('GameB.exe'))).resolves.toMatchObject({
      status: 'failed',
      failures: [{ code: 'RESTORE_PENDING' }]
    })
    expect(native.calls).toHaveLength(3)
    await coordinator.activate(application('GameB.exe'), undefined, { recovery: true })

    expect(native.calls.map((call) => `${call.operation}:${call.displayId ?? 'all'}`)).toEqual([
      'capture:display:one',
      'apply:display:one',
      'restoreAll:all',
      'restoreAll:all',
      'capture:display:two',
      'apply:display:two'
    ])
  })
})
