import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createNeutralColorSettings,
  JsonProfileRepository,
  type ColorProfile
} from '@chromashift/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LearnedGammaLimits } from '@main/learned-gamma-limits.js'
import { PhysicalDisplayClient } from '@main/physical-display-client.js'
import { ActivationCoordinator } from '@main/activation-coordinator.js'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { ProductController, type ProductActivationPort } from '@main/product-controller.js'
import { defaultUserPreferences } from '@main/app-settings.js'
import {
  FakeNativeDisplayPort,
  testCapabilityReport,
  testDisplay
} from '@main/testing/fake-native-display.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const logger = { write: vi.fn() }

function profile(gamma = 2.5, id = 'game'): ColorProfile {
  return {
    id,
    name: id,
    enabled: true,
    applications: [],
    displays: [{ displayId: 'display:one', color: { ...createNeutralColorSettings(), gamma } }]
  }
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-gamma-'))
  directories.push(directory)
  const path = join(directory, 'display-limits.json')
  const limits = new LearnedGammaLimits(path, logger)
  await limits.load()
  const native = Object.assign(new FakeNativeDisplayPort(0, [testDisplay('display:one')]), {
    getForegroundApplication: async () => null,
    getVisibleApplications: async () => []
  })
  const report = testCapabilityReport('display:one')
  for (const name of ['brightness', 'contrast', 'gamma'] as const)
    report.capabilities[name] = {
      supported: true,
      provider: 'windows',
      min: name === 'gamma' ? 0.3 : 0,
      max: name === 'gamma' ? 2.8 : 100
    }
  native.reports.set('display:one', report)
  native.gammaRanges.set('display:one', { min: 0.65, max: 1.85 })
  let contents: string | null = null
  const repository = new JsonProfileRepository({
    read: async () => contents,
    write: async (value) => {
      contents = value
    }
  })
  await repository.save(profile())
  const physical = new PhysicalDisplayClient(native, limits)
  const coordinator = new ActivationCoordinator(repository, physical, logger, limits)
  const preview = new PreviewSessionController(
    physical,
    {
      beginPreview: async () => [],
      cancelPreview: async () => undefined,
      confirmPreview: async () => undefined
    },
    () => undefined,
    undefined,
    limits,
    repository
  )
  const successful = {
    status: 'activated' as const,
    resolution: null,
    failures: [],
    deferredDisplayIds: []
  }
  const activation: ProductActivationPort = {
    state: { enabled: true, mode: { kind: 'automatic' }, currentTarget: null },
    chromaShiftState: {
      status: 'active',
      pendingOperation: null,
      intendedMode: { kind: 'automatic' },
      intendedTarget: null,
      transitionInProgress: false
    },
    selectManualProfile: async () => successful,
    enableAutomatic: async () => successful,
    restoreBaseline: async () => successful,
    pause: async () => successful,
    resume: async () => successful,
    retrySafetyCheck: async () => successful,
    reconcileAutomaticIntent: async () => undefined,
    refreshAfterConfigurationChange: async () => undefined
  }
  const product = new ProductController(
    repository,
    physical,
    activation,
    preview,
    { pick: async () => null, describe: async () => null },
    {
      get: async () => defaultUserPreferences,
      save: async (value) => value,
      apply: () => undefined
    },
    { refreshTray: async () => undefined, stateChanged: () => undefined },
    'test',
    limits
  )
  return { limits, path, native, physical, repository, coordinator, preview, product }
}

describe('learned gamma limits through the native seam', () => {
  for (const kind of ['preview', 'edit', 'override'] as const) {
    it(`keeps the starting gamma through editor open and ${kind} until a changed baseline is captured`, async () => {
      const { physical, native, product, repository, limits, preview } = await setup()
      await physical.captureBaseline('display:one')
      await physical.applyDisplaySettings('display:one', profile().displays[0]!.color)
      await physical.restoreDisplay('display:one')
      native.baselineHashes.set('display:one', 'new-calibration')
      native.gammaRanges.clear()
      native.calls.length = 0

      const opened = await product.openProfile('game')
      expect(opened.displays[0]!.color.gamma).toBe(2.5)
      expect((await product.getState()).gammaLimits!.displays).toEqual({})
      expect(native.calls).toEqual([])
      await preview.start(opened, kind, opened)
      expect(preview.state).toMatchObject({
        state: 'active',
        draft: { displays: [{ color: { gamma: 2.5 } }] }
      })
      expect((await repository.findById('game'))!.displays[0]!.color.gamma).toBe(2.5)
      expect(limits.current.displays['display:one']!.sdr!.brightness).toEqual({})
      expect(native.calls.filter((call) => call.operation === 'capture')).toHaveLength(1)
    })
  }

  it('requires session confirmation even when the persisted baseline hash still matches', async () => {
    const { physical, native, path, repository } = await setup()
    await physical.captureBaseline('display:one')
    await physical.applyDisplaySettings('display:one', profile().displays[0]!.color)
    await physical.restoreDisplay('display:one')
    const reloaded = new LearnedGammaLimits(path, logger)
    await reloaded.load()
    const freshClient = new PhysicalDisplayClient(native, reloaded)
    native.calls.length = 0
    expect((await reloaded.clampSavedProfile(repository, 'game'))!.displays[0]!.color.gamma).toBe(
      2.5
    )
    expect(reloaded.applicable.displays).toEqual({})
    expect(reloaded.clampProfile(profile()).displays[0]!.color.gamma).toBe(2.5)
    expect(native.calls).toEqual([])
    await freshClient.captureBaseline('display:one')
    expect((await reloaded.clampSavedProfile(repository, 'game'))!.displays[0]!.color.gamma).toBe(
      1.85
    )
    expect(reloaded.applicable.displays['display:one']).toBeDefined()
    await freshClient.restoreAllBaselines()
    expect(reloaded.applicable.displays).toEqual({})
    expect(reloaded.current.displays['display:one']!.sdr!.brightness['50']).toEqual({ max: 1.85 })
  })

  for (const unavailable of ['disconnected', 'hdr', 'unsupported'] as const) {
    it(`keeps saved intent and hides limits when an opened target is ${unavailable}`, async () => {
      const { physical, native, product, repository } = await setup()
      await physical.captureBaseline('display:one')
      await physical.applyDisplaySettings('display:one', profile().displays[0]!.color)
      if (unavailable === 'disconnected') native.disconnectedDisplayIds.add('display:one')
      if (unavailable === 'hdr') native.hdrDisplayIds.add('display:one')
      if (unavailable === 'unsupported')
        native.reports.get('display:one')!.capabilities.gamma.supported = false
      native.calls.length = 0
      expect((await product.openProfile('game')).displays[0]!.color.gamma).toBe(2.5)
      expect((await repository.findById('game'))!.displays[0]!.color.gamma).toBe(2.5)
      expect((await product.getState()).gammaLimits!.displays).toEqual({})
      expect(native.calls).toEqual([])
    })
  }

  it('learns after a concurrent Reset using the captured baseline without recapture', async () => {
    const { physical, limits, native } = await setup()
    await physical.captureBaseline('display:one')
    const capturedHash = limits.current.displays['display:one']!.sdr!.baselineHash
    await limits.reset('display:one')
    await limits.learn(
      'display:one',
      {
        end: 'max',
        value: 1.85,
        brightness: 50,
        colorMode: 'sdr',
        baselineHash: 'baseline:display:one'
      },
      capturedHash
    )
    expect(limits.current.displays['display:one']!.sdr!.brightness['50']).toEqual({ max: 1.85 })
    expect(native.calls.map((call) => call.operation)).toEqual(['capture'])
  })

  it('clamps imported legacy profiles after their existing migration', async () => {
    const { physical, limits } = await setup()
    await physical.captureBaseline('display:one')
    await physical.applyDisplaySettings('display:one', profile().displays[0]!.color)
    let imported = JSON.stringify({
      schemaVersion: 2,
      profiles: [
        {
          ...profile(),
          displays: [{ displayId: 'display:one', color: { gamma: 2.5, brightness: 50 } }]
        }
      ],
      settings: { defaultProfileId: null }
    })
    const repository = new JsonProfileRepository({
      read: async () => imported,
      write: async (value) => {
        imported = value
      }
    })
    const loaded = await limits.clampSavedProfile(repository, 'game')
    expect(loaded!.displays[0]!.color).toEqual({ ...createNeutralColorSettings(), gamma: 1.85 })
    expect(JSON.parse(imported).schemaVersion).toBe(3)
    expect((await repository.findById('game'))!.displays[0]!.color.gamma).toBe(1.85)
  })
  it('learns and persists on apply, quietly updates the profile, then clamps future applies', async () => {
    const { limits, path, native, repository, coordinator, physical } = await setup()
    const outcome = await coordinator.activate(null, { kind: 'manual', profileId: 'game' })
    expect(outcome.status).toBe('activated')
    expect(native.applied[0]!.settings.gamma).toBe(1.85)
    expect((await repository.findById('game'))!.displays[0]!.color.gamma).toBe(1.85)
    const reloaded = new LearnedGammaLimits(path, logger)
    await reloaded.load()
    expect(reloaded.current).toEqual(limits.current)
    const result = await physical.applyDisplaySettings('display:one', profile().displays[0]!.color)
    expect(result.learnedGammaLimit).toBeUndefined()
    expect(native.calls.at(-1)!.settings!.gamma).toBe(1.85)
    expect(native.calls.filter((call) => call.operation === 'restore')).toHaveLength(0)
  })

  for (const kind of ['preview', 'edit', 'override'] as const) {
    it(`clamps ${kind} and keeps unrelated draft changes and the saved reference intact`, async () => {
      const { limits, repository, preview } = await setup()
      const saved = (await repository.findById('game'))!
      const draft = {
        ...saved,
        name: 'Unsaved name',
        displays: saved.displays.map((target) => ({
          ...target,
          color: { ...target.color, hue: 33 }
        }))
      }
      await preview.start(draft, kind, saved)
      expect(limits.current.displays['display:one']!.sdr!.brightness['50']!.max).toBe(1.85)
      expect(preview.state).toMatchObject({
        state: 'active',
        draft: { name: 'Unsaved name', displays: [{ color: { gamma: 1.85, hue: 33 } }] }
      })
      expect(await repository.findById('game')).toMatchObject({
        name: 'game',
        displays: [{ color: { gamma: 1.85, hue: 0 } }]
      })
      if (kind !== 'preview') {
        expect(preview.state).toMatchObject({ unsavedChanges: true })
        const next = {
          ...draft,
          name: 'Still unsaved',
          displays: draft.displays.map((target) => ({
            ...target,
            color: { ...target.color, gamma: 2.7, hue: 70 }
          }))
        }
        await preview.update(saved.id, next.displays, next)
        expect(preview.unsavedDraft).toMatchObject({
          name: 'Still unsaved',
          displays: [{ color: { gamma: 1.85, hue: 70 } }]
        })
      }
    })
  }

  it('learns the lower end independently at each brightness and invalidates on a new captured baseline', async () => {
    const { limits, physical, native } = await setup()
    await physical.captureBaseline('display:one')
    await physical.applyDisplaySettings('display:one', profile(0.3).displays[0]!.color)
    const learned = limits.current.displays['display:one']!.sdr!
    expect(learned.brightness['50']).toEqual({ min: 0.65 })
    expect(limits.clampSettings('display:one', { brightness: 51, gamma: 0.3 }).gamma).toBe(0.3)
    native.baselineHashes.set('display:one', 'new-calibration')
    await physical.captureBaseline('display:one')
    expect(limits.current.displays['display:one']!.sdr!.brightness['50']).toEqual({ min: 0.65 })
    await physical.restoreDisplay('display:one')
    await physical.captureBaseline('display:one')
    expect(limits.current.displays['display:one']!.sdr!.brightness).toEqual({})
    expect(limits.current.displays['display:one']!.sdr!.baselineHash).not.toBe(learned.baselineHash)
  })

  it('quietly clamps on opening the editor without native calls; Reset keeps the permanent profile change', async () => {
    const { physical, native, product, repository, limits } = await setup()
    await physical.captureBaseline('display:one')
    await physical.applyDisplaySettings('display:one', profile().displays[0]!.color)
    native.calls.length = 0
    const opened = await product.openProfile('game')
    expect(opened.displays[0]!.color.gamma).toBe(1.85)
    await product.resetLearnedLimits('display:one')
    expect(limits.current.displays).toEqual({})
    expect((await repository.findById('game'))!.displays[0]!.color.gamma).toBe(1.85)
    expect(native.calls).toEqual([])
    const saved = await product.saveProfile({ ...profile(), name: 'User rename' })
    expect(saved.name).toBe('User rename')
  })

  it('retains invalid stored data and refuses load and reset rather than overwriting it', async () => {
    const { path } = await setup()
    const invalid = '{"schemaVersion":999,"displays":{}}'
    await writeFile(path, invalid)
    const limits = new LearnedGammaLimits(path, logger)
    await expect(limits.load()).rejects.toThrow()
    await expect(limits.reset('display:one')).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(invalid)
  })

  it('converges a physical display with several endpoints to their common learned range', async () => {
    const { native, limits } = await setup()
    native.displays = [testDisplay('display:one'), testDisplay('display:two')].map((display) => ({
      ...display,
      physicalId: 'display:panel'
    }))
    native.reports.set('display:two', {
      ...native.reports.get('display:one')!,
      displayId: 'display:two'
    })
    native.gammaRanges.set('display:two', { min: 0.7, max: 1.7 })
    const physical = new PhysicalDisplayClient(native, limits)
    await physical.captureBaseline('display:panel')
    const result = await physical.applyDisplaySettings(
      'display:panel',
      profile().displays[0]!.color
    )
    expect(result.applied.gamma).toBe(1.7)
    expect(native.currentSettings.get('display:one')!.gamma).toBe(1.7)
    expect(native.currentSettings.get('display:two')!.gamma).toBe(1.7)
    expect(limits.current.displays['display:panel']!.sdr!.brightness['50']!.max).toBe(1.7)
  })
})
