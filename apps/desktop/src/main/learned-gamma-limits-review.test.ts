import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createNeutralColorSettings,
  JsonProfileRepository,
  type ColorProfile
} from '@chromashift/core'
import { afterEach, expect, it } from 'vitest'
import { LearnedGammaLimits } from '@main/learned-gamma-limits.js'
import { PhysicalDisplayClient } from '@main/physical-display-client.js'
import { ActivationCoordinator } from '@main/activation-coordinator.js'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import {
  FakeNativeDisplayPort,
  testDisplay,
  testCapabilityReport
} from '@main/testing/fake-native-display.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const logger = { write() {} }
const target = (displayId = 'display:one', gamma = 2.5) => ({
  displayId,
  color: { ...createNeutralColorSettings(), gamma }
})
const profile = (displays = [target()]): ColorProfile => ({
  id: 'game',
  name: 'Game',
  enabled: true,
  applications: [],
  displays
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-review92-'))
  directories.push(directory)
  const limits = new LearnedGammaLimits(join(directory, 'display-limits.json'), logger)
  await limits.load()
  const native = Object.assign(new FakeNativeDisplayPort(0, [testDisplay('display:one')]), {
    getForegroundApplication: async () => null,
    getVisibleApplications: async () => []
  })
  const report = testCapabilityReport('display:one')
  for (const key of ['brightness', 'contrast', 'gamma'] as const)
    report.capabilities[key] = { supported: true, provider: 'windows' }
  native.reports.set('display:one', report)
  const physical = new PhysicalDisplayClient(native, limits)
  let contents: string | null = null
  const repository = new JsonProfileRepository({
    read: async () => contents,
    write: async (value) => {
      contents = value
    }
  })
  const coordinator = new ActivationCoordinator(repository, physical, logger, limits)
  return { native, physical, repository, coordinator, limits }
}

async function learnMax(s: Awaited<ReturnType<typeof setup>>) {
  s.native.gammaRanges.set('display:one', { min: 0.3, max: 1.85 })
  await s.physical.captureBaseline('display:one')
  await s.physical.applyDisplaySettings('display:one', target().color)
  s.native.gammaRanges.delete('display:one')
}

it('does not permanently clamp an unopened profile against a previous-session baseline', async () => {
  const s = await setup()
  await learnMax(s)
  await s.physical.restoreDisplay('display:one')
  s.native.baselineHashes.set('display:one', 'new-calibration')
  await s.repository.save(profile())
  // ProductController.openProfile delegates directly to this method before capture.
  await s.limits.clampSavedProfile(s.repository, 'game')
  await s.coordinator.activate(null, { kind: 'manual', profileId: 'game' })
  expect(s.limits.current.displays['display:one']!.sdr!.brightness).toEqual({})
  expect((await s.repository.findById('game'))!.displays[0]!.color.gamma).toBe(2.5)
})

it('keeps a disconnected display target unchanged while applying another display', async () => {
  const s = await setup()
  await learnMax(s)
  s.native.disconnectedDisplayIds.add('display:one')
  s.native.displays.push(testDisplay('display:two'))
  s.native.reports.set('display:two', {
    ...s.native.reports.get('display:one')!,
    displayId: 'display:two'
  })
  await s.repository.save(profile([target('display:two'), target('display:one')]))
  const result = await s.coordinator.activate(null, { kind: 'manual', profileId: 'game' })
  expect(result.status).toBe('activated')
  expect(result.deferredDisplayIds).toContain('display:one')
  expect((await s.repository.findById('game'))!.displays[1]!.color.gamma).toBe(2.5)
})

it('preserves unsupported gamma intent when applying a saturation-capable display', async () => {
  const s = await setup()
  await learnMax(s)
  s.native.reports.get('display:one')!.capabilities.gamma = {
    supported: false,
    provider: 'unknown'
  }
  await s.repository.save(profile())
  const result = await s.coordinator.activate(null, { kind: 'manual', profileId: 'game' })
  expect(result.status).toBe('activated')
  expect(s.native.calls.at(-1)!.settings!.gamma).toBeUndefined()
  expect((await s.repository.findById('game'))!.displays[0]!.color.gamma).toBe(2.5)
})

it('updates the displayed gamma after learning from a newly added preview target', async () => {
  const s = await setup()
  const empty = profile([])
  await s.repository.save(empty)
  const preview = new PreviewSessionController(
    s.physical,
    { beginPreview: async () => [], cancelPreview: async () => {}, confirmPreview: async () => {} },
    () => {},
    undefined,
    s.limits,
    s.repository
  )
  await preview.start(empty, 'edit', empty)
  s.native.gammaRanges.set('display:one', { min: 0.3, max: 1.85 })
  const changed = profile()
  await preview.update('game', changed.displays, changed)
  expect(preview.state).toMatchObject({
    state: 'active',
    draft: { displays: [{ color: { gamma: 1.85 } }] }
  })
})

it('keys learning and lookup consistently at brightness 37 without leaking into 80', async () => {
  const s = await setup()
  s.native.gammaRanges.set('display:one', { min: 0.3, max: 1.85 })
  await s.physical.captureBaseline('display:one')
  await s.physical.applyDisplaySettings('display:one', { ...target().color, brightness: 37 })
  expect(s.limits.clampSettings('display:one', { brightness: 37, gamma: 2.5 }).gamma).toBe(1.85)
  expect(s.limits.clampSettings('display:one', { brightness: 80, gamma: 2.5 }).gamma).toBe(2.5)
})

it('uses effective brightness when mixed endpoints cannot apply stored brightness', async () => {
  const s = await setup()
  s.native.displays = [
    { ...testDisplay('display:one'), physicalId: 'display:panel' },
    {
      ...testDisplay('display:two'),
      physicalId: 'display:panel',
      adapter: { ...testDisplay('display:two').adapter, vendor: 'amd' }
    }
  ]
  const amdReport = structuredClone(s.native.reports.get('display:one')!)
  amdReport.displayId = 'display:two'
  amdReport.capabilities.brightness = { supported: false, provider: 'unknown' }
  amdReport.capabilities.gamma = { supported: true, provider: 'amd' }
  s.native.reports.set('display:two', amdReport)
  s.native.gammaRanges.set('display:one', { min: 0.3, max: 1.85 })
  const requested = profile([
    { ...target('display:panel'), color: { ...target().color, brightness: 37 } }
  ])
  await s.repository.save(requested)
  const outcome = await s.coordinator.activate(null, { kind: 'manual', profileId: 'game' })
  expect(outcome.status).toBe('activated')
  expect(
    s.native.calls.find((call) => call.operation === 'apply')!.settings!.brightness
  ).toBeUndefined()
  expect(s.limits.current.displays['display:panel']!.sdr!.brightness['50']).toEqual({ max: 1.85 })
  expect((await s.repository.findById('game'))!.displays[0]!.color.gamma).toBe(1.85)
})
