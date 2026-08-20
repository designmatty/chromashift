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
import { PhysicalDisplayClient } from './physical-display-client.js'

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
      gamma: { ...supported, min: 0.5, max: 2.8 },
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
    await client.applyDisplaySettings(physicalId, { saturation: 75 })
    await client.restoreDisplay(physicalId)

    expect(native.captured).toEqual(['display:dp', 'display:hdmi'])
    expect(native.applied).toEqual([
      { displayId: 'display:dp', settings: { saturation: 75 } },
      { displayId: 'display:hdmi', settings: { saturation: 75 } }
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
