import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNeutralColorSettings, JsonProfileRepository } from '@chromashift/core'
import { describe, expect, it } from 'vitest'
import type {
  BaselineCaptureResult,
  Display,
  DisplayApplyResult,
  DisplayCapabilityReport,
  DisplayRestoreResult,
  DisplaySettings,
  RestoreAllResult
} from '@chromashift/native-client'
import { ActivationCoordinator } from '@main/activation-coordinator.js'
import { LearnedGammaLimits } from '@main/learned-gamma-limits.js'
import { PhysicalDisplayClient } from '@main/physical-display-client.js'
import {
  FakeNativeDisplayPort,
  nvidiaCapabilityReport,
  testCapabilityReport,
  testDisplay
} from '@main/testing/fake-native-display.js'

const physicalId = 'display:physical-g60'

function endpoint(id: string, connection: string, options: Partial<Display> = {}): Display {
  return {
    id,
    physicalId,
    name: 'Odyssey G60SD',
    windowsDisplayName: '\\\\.\\DISPLAY1',
    monitorDevicePath: `path:${id}`,
    manufacturer: 'SAM',
    productCode: connection === 'HDMI' ? '75C2' : '75CB',
    serialNumber: 'HNAY301023',
    adapter: { id: 'adapter:one', name: 'NVIDIA', vendor: 'nvidia', deviceId: 'gpu' },
    connection,
    primary: connection === 'DisplayPort',
    hdr: false,
    advancedColorSupported: true,
    bitsPerColorChannel: 10,
    refreshRate: connection === 'DisplayPort' ? 360 : 240,
    ...options
  }
}

function report(displayId: string, saturationSupported = true): DisplayCapabilityReport {
  const supported = { supported: true as const, provider: 'windows' as const, min: 0, max: 100 }
  return {
    displayId,
    capabilities: {
      brightness: supported,
      contrast: supported,
      gamma: { ...supported, min: 0.3, max: 2.8 },
      saturation: saturationSupported
        ? { supported: true, provider: 'nvidia', min: 0, max: 100 }
        : { supported: false, provider: 'nvidia', reason: 'Unavailable over this endpoint.' },
      hue: { supported: true, provider: 'nvidia', min: 0, max: 100 },
      colorTemperature: { supported: false, provider: 'unknown', reason: 'Unsupported.' }
    },
    nativeState: {
      nvidia: {
        saturation: { supported: saturationSupported },
        hue: { supported: true }
      },
      amd: {
        brightness: { supported: false },
        contrast: { supported: false },
        saturation: { supported: false },
        hue: { supported: false },
        colorTemperature: { supported: false }
      }
    }
  }
}

class FakeEndpointClient {
  public displays = [endpoint('display:dp', 'DisplayPort'), endpoint('display:hdmi', 'HDMI')]
  public captured: string[] = []
  public applied: Array<{ displayId: string; settings: DisplaySettings }> = []
  public restored: string[] = []
  public restoreAllResult: RestoreAllResult = { displays: [] }

  public getDisplays(): Promise<Display[]> {
    return Promise.resolve(this.displays)
  }

  public getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport> {
    return Promise.resolve(report(displayId, displayId !== 'display:hdmi'))
  }

  public getForegroundApplication(): Promise<null> {
    return Promise.resolve(null)
  }

  public getVisibleApplications(): Promise<[]> {
    return Promise.resolve([])
  }

  public captureBaseline(displayId: string): Promise<BaselineCaptureResult> {
    this.captured.push(displayId)
    return Promise.resolve({ displayId, state: 'captured' })
  }

  public applyDisplaySettings(
    displayId: string,
    settings: DisplaySettings
  ): Promise<DisplayApplyResult> {
    this.applied.push({ displayId, settings })
    return Promise.resolve({ displayId, settings, applied: {} })
  }

  public restoreDisplay(displayId: string): Promise<DisplayRestoreResult> {
    this.restored.push(displayId)
    return Promise.resolve({ displayId, restored: true })
  }

  public restoreAllBaselines(): Promise<RestoreAllResult> {
    return Promise.resolve(this.restoreAllResult)
  }
}

describe('PhysicalDisplayClient', () => {
  it('groups simultaneous DP and HDMI endpoints into one physical display', async () => {
    const native = new FakeEndpointClient()
    const client = new PhysicalDisplayClient(native)

    await expect(client.getDisplays()).resolves.toEqual([
      expect.objectContaining({
        id: physicalId,
        physicalId,
        endpointIds: ['display:dp', 'display:hdmi'],
        connection: 'DisplayPort + HDMI',
        primary: true,
        refreshRate: 360
      })
    ])
  })

  it('fans capture, apply, and restore out to every endpoint baseline', async () => {
    const native = new FakeEndpointClient()
    const client = new PhysicalDisplayClient(native)

    await client.captureBaseline(physicalId)
    await client.applyDisplaySettings(physicalId, { hue: 75 })
    await client.restoreDisplay(physicalId)

    expect(native.captured).toEqual(['display:dp', 'display:hdmi'])
    expect(native.applied).toEqual([
      { displayId: 'display:dp', settings: { hue: 75 } },
      { displayId: 'display:hdmi', settings: { hue: 75 } }
    ])
    expect(native.restored).toEqual(['display:dp', 'display:hdmi'])
  })

  it('uses the safe capability intersection across current endpoints', async () => {
    const client = new PhysicalDisplayClient(new FakeEndpointClient())

    const result = await client.getDisplayCapabilityReport(physicalId)

    expect(result.displayId).toBe(physicalId)
    expect(result.capabilities.brightness.supported).toBe(true)
    expect(result.capabilities.saturation).toMatchObject({
      supported: false,
      provider: 'nvidia',
      reason: 'Unavailable over this endpoint.'
    })
  })

  it('filters settings not supported by every endpoint', async () => {
    const native = new FakeEndpointClient()
    const client = new PhysicalDisplayClient(native)

    await client.applyDisplaySettings(physicalId, {
      hue: 20,
      saturation: 75,
      colorTemperature: 60
    })

    expect(native.applied).toEqual([
      { displayId: 'display:dp', settings: { hue: 20 } },
      { displayId: 'display:hdmi', settings: { hue: 20 } }
    ])
  })

  it('omits the neutral Windows gamma tuple to preserve the captured ramp', async () => {
    const native = new FakeEndpointClient()
    const client = new PhysicalDisplayClient(native)

    await client.applyDisplaySettings(physicalId, {
      brightness: 50,
      contrast: 50,
      gamma: 1
    })

    expect(native.applied).toEqual([
      { displayId: 'display:dp', settings: {} },
      { displayId: 'display:hdmi', settings: {} }
    ])
  })

  it('maps endpoint restore-all results back to the physical profile target', async () => {
    const native = new FakeEndpointClient()
    const client = new PhysicalDisplayClient(native)
    await client.getDisplays()
    native.restoreAllResult = {
      displays: [
        { displayId: 'display:dp', restored: true },
        { displayId: 'display:hdmi', restored: true }
      ]
    }

    await expect(client.restoreAllBaselines()).resolves.toEqual({
      displays: [{ displayId: physicalId, restored: true }]
    })
  })

  it('retains disconnected endpoint ownership while another connection remains active', async () => {
    const native = new FakeEndpointClient()
    const client = new PhysicalDisplayClient(native)
    await client.captureBaseline(physicalId)
    native.displays = [native.displays[0]!]

    await client.restoreDisplay(physicalId)

    expect(native.restored).toEqual(['display:dp', 'display:hdmi'])
  })

  it('keeps endpoints separate when native identity cannot trust a serial', async () => {
    const native = new FakeEndpointClient()
    native.displays = native.displays.map((display) => ({
      ...display,
      physicalId: display.id,
      serialNumber: null
    }))
    const client = new PhysicalDisplayClient(native)

    const displays = await client.getDisplays()

    expect(displays.map((display) => display.id)).toEqual(['display:dp', 'display:hdmi'])
  })
})

// #78: a preview replacement recaptures displays it already holds.
it('keeps endpoint baselines and learned limits through repeated physical capture and partial restore', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-physical-capture-'))
  try {
    const panel = 'display:physical'
    const first = { ...testDisplay('display:one'), physicalId: panel }
    const second = { ...testDisplay('display:two'), physicalId: panel }
    const native = new FakeNativeDisplayPort(0, [first, second])
    for (const display of [first, second]) {
      const capabilities = testCapabilityReport(display.id)
      capabilities.capabilities.gamma = { supported: true, provider: 'windows', min: 0.3, max: 2.8 }
      native.reports.set(display.id, capabilities)
    }
    const originals = new Map([
      [first.id, { ...createNeutralColorSettings(), brightness: 44 }],
      [second.id, { ...createNeutralColorSettings(), brightness: 47 }]
    ])
    for (const [id, color] of originals) native.currentSettings.set(id, color)
    const limits = new LearnedGammaLimits(join(directory, 'limits.json'), {
      write: () => undefined
    })
    await limits.load()
    const physical = new PhysicalDisplayClient(
      {
        getDisplays: () => native.getDisplays(),
        getDisplayCapabilityReport: (id) => native.getDisplayCapabilityReport(id),
        getForegroundApplication: async () => null,
        getVisibleApplications: async () => [],
        captureBaseline: (id) => native.captureBaseline(id),
        applyDisplaySettings: (id, settings) => native.applyDisplaySettings(id, settings),
        restoreDisplay: (id) => native.restoreDisplay(id),
        restoreAllBaselines: () => native.restoreAllBaselines()
      },
      limits
    )
    await physical.captureBaseline(panel)
    // One endpoint rejects part of the range, so both converge on its learned maximum.
    native.gammaRanges.set(second.id, { min: 0.3, max: 1.5 })
    await physical.applyDisplaySettings(panel, { ...createNeutralColorSettings(), gamma: 1.8 })
    const learned = structuredClone(limits.applicable)
    expect(learned.displays[panel]?.sdr?.brightness['50']?.max).toBe(1.5)

    await expect(physical.captureBaseline(panel)).resolves.toMatchObject({
      state: 'alreadyCaptured'
    })
    expect(limits.applicable).toEqual(learned)
    expect(native.baselineCaptures).toHaveLength(2)

    // A partial restore releases only the confirmed endpoint. Recapture reads
    // Original there and keeps the held baseline for the endpoint that failed.
    native.failRestoreDisplayIds.add(second.id)
    await expect(physical.restoreDisplay(panel)).rejects.toThrow('Restore failed')
    await expect(physical.captureBaseline(panel)).resolves.toMatchObject({ state: 'captured' })
    expect(limits.applicable).toEqual(learned)
    for (const capture of native.baselineCaptures) {
      expect(capture.settings).toEqual(originals.get(capture.displayId))
    }
    native.failRestoreDisplayIds.clear()
    await physical.restoreDisplay(panel)
    for (const [id, color] of originals) expect(native.currentSettings.get(id)).toEqual(color)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('starts fresh learned limits when a panel moves to another GPU with the same original ramp (#119)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-physical-move-'))
  try {
    const panel = 'display:physical'
    // Windows can report an empty device ID; the vendor still separates the keys.
    const nvidia = testDisplay('display:one')
    const onNvidia = { ...nvidia, physicalId: panel, adapter: { ...nvidia.adapter, deviceId: '' } }
    const native = new FakeNativeDisplayPort(0, [onNvidia])
    const capabilities = testCapabilityReport(onNvidia.id)
    capabilities.capabilities.gamma = { supported: true, provider: 'windows', min: 0.3, max: 2.8 }
    native.reports.set(onNvidia.id, capabilities)
    native.baselineHashes.set(onNvidia.id, 'identity-ramp')
    const limits = new LearnedGammaLimits(join(directory, 'limits.json'), {
      write: () => undefined
    })
    await limits.load()
    const physical = new PhysicalDisplayClient(
      {
        getDisplays: () => native.getDisplays(),
        getDisplayCapabilityReport: (id) => native.getDisplayCapabilityReport(id),
        getForegroundApplication: async () => null,
        getVisibleApplications: async () => [],
        captureBaseline: (id) => native.captureBaseline(id),
        applyDisplaySettings: (id, settings) => native.applyDisplaySettings(id, settings),
        restoreDisplay: (id) => native.restoreDisplay(id),
        restoreAllBaselines: () => native.restoreAllBaselines()
      },
      limits
    )
    await physical.captureBaseline(panel)
    native.gammaRanges.set(onNvidia.id, { min: 0.3, max: 1.5 })
    await physical.applyDisplaySettings(panel, { ...createNeutralColorSettings(), gamma: 1.8 })
    expect(limits.applicable.displays[panel]?.sdr?.brightness['50']?.max).toBe(1.5)
    await physical.restoreDisplay(panel)

    // The same panel, with the same identity ramp, now on an AMD output.
    native.displays = [
      {
        ...onNvidia,
        adapter: {
          id: 'adapter:amd',
          name: 'AMD Radeon(TM) Graphics',
          vendor: 'amd',
          deviceId: ''
        }
      }
    ]
    await physical.captureBaseline(panel)
    expect(limits.applicable.displays[panel]?.sdr?.brightness['50']).toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('HDR fan-out across endpoints (#89)', () => {
  const dp = 'display:dp'
  const hdmi = 'display:hdmi'
  const color = { ...createNeutralColorSettings(), brightness: 30, saturation: 80, hue: 10 }

  function coordinatorFor(native: FakeNativeDisplayPort): ActivationCoordinator {
    for (const id of [dp, hdmi]) native.reports.set(id, nvidiaCapabilityReport(id))
    const repository = new JsonProfileRepository({
      read: async () =>
        JSON.stringify({
          schemaVersion: 3,
          profiles: [
            {
              id: 'default',
              name: 'Default',
              enabled: true,
              applications: [],
              displays: [{ displayId: physicalId, color }]
            }
          ],
          settings: { defaultProfileId: 'default' }
        }),
      write: async () => undefined
    })
    // The shared fake models HDR capture and apply; foreground reads are unused here.
    const endpoints = Object.assign(native, {
      getForegroundApplication: async () => null,
      getVisibleApplications: async () => []
    })
    return new ActivationCoordinator(repository, new PhysicalDisplayClient(endpoints), {
      write: () => undefined
    })
  }

  it('withholds the ramp controls from every endpoint while one endpoint is HDR', async () => {
    const native = new FakeNativeDisplayPort(0, [
      endpoint(dp, 'DisplayPort', { hdr: true }),
      endpoint(hdmi, 'HDMI')
    ])
    await expect(coordinatorFor(native).activate(null)).resolves.toMatchObject({
      status: 'activated',
      failures: []
    })
    expect(native.applied).toEqual([
      { displayId: dp, settings: { saturation: 80, hue: 10 } },
      { displayId: hdmi, settings: { saturation: 80, hue: 10 } }
    ])
  })

  it('restores every endpoint and writes nothing when an Intel endpoint turns HDR', async () => {
    const native = new FakeNativeDisplayPort(0, [
      endpoint(dp, 'DisplayPort'),
      endpoint(hdmi, 'HDMI')
    ])
    native.intelDisplayIds.add(hdmi)
    const coordinator = coordinatorFor(native)
    await coordinator.activate(null)
    expect(native.applied.map((entry) => entry.displayId)).toEqual([dp, hdmi])

    native.hdrDisplayIds.add(hdmi)
    await coordinator.resetForDisplayTransition()
    const before = native.calls.length
    await expect(coordinator.activate(null)).resolves.toMatchObject({
      deferredDisplayIds: [physicalId],
      failures: []
    })
    expect(native.calls.slice(before)).toEqual([
      { operation: 'restore', displayId: dp },
      { operation: 'restore', displayId: hdmi }
    ])
  })
})
