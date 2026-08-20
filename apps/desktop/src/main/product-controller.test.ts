import { JsonProfileRepository, type ColorProfile } from '@chromashift/core'
import type { Display, DisplayCapabilityReport } from '@chromashift/native-client'
import { describe, expect, it } from 'vitest'
import { PreviewSessionController } from './preview-session-controller.js'
import {
  type ApplicationPickerPort,
  ProductConflictError,
  ProductController,
  type ProductActivationPort,
  type ProductNativePort,
  type ProductSettingsPort
} from './product-controller.js'

class MemoryStorage {
  public contents: string | null = null
  public read(): Promise<string | null> {
    return Promise.resolve(this.contents)
  }
  public write(contents: string): Promise<void> {
    this.contents = contents
    return Promise.resolve()
  }
}

const successfulOutcome = {
  status: 'activated' as const,
  resolution: null,
  failures: [],
  deferredDisplayIds: []
}

function controller(
  applicationPicker: ApplicationPickerPort = {
    pick: () => Promise.resolve(null),
    describe: () => Promise.resolve(null)
  },
  settings: ProductSettingsPort = {
    get: () =>
      Promise.resolve({
        launchAtStartup: false,
        launchBehavior: 'tray',
        closeBehavior: 'tray',
        theme: 'system'
      }),
    save: (value) => Promise.resolve(value),
    apply: () => undefined
  },
  nativeOverride?: ProductNativePort
): { product: ProductController; repository: JsonProfileRepository } {
  const repository = new JsonProfileRepository(new MemoryStorage())
  const native: ProductNativePort = nativeOverride ?? {
    getDisplays: () => Promise.resolve([]),
    getDisplayCapabilityReport: (): Promise<DisplayCapabilityReport> =>
      Promise.reject(new Error('No displays in this test.')),
    getForegroundApplication: () => Promise.resolve(null),
    getVisibleApplications: () => Promise.resolve([])
  }
  const activation: ProductActivationPort = {
    state: { enabled: true, mode: { kind: 'automatic' }, currentTarget: null },
    selectManualProfile: () => Promise.resolve(successfulOutcome),
    enableAutomatic: () => Promise.resolve(successfulOutcome),
    restoreBaseline: () => Promise.resolve(successfulOutcome),
    refreshAfterConfigurationChange: () => Promise.resolve()
  }
  const preview = new PreviewSessionController(
    {
      getDisplays: native.getDisplays,
      getDisplayCapabilityReport: native.getDisplayCapabilityReport,
      captureBaseline: () => Promise.reject(new Error('Not used.')),
      applyDisplaySettings: () => Promise.reject(new Error('Not used.')),
      restoreDisplay: () => Promise.reject(new Error('Not used.'))
    },
    {
      beginPreview: () => Promise.resolve(),
      cancelPreview: () => Promise.resolve(),
      confirmPreview: () => Promise.resolve()
    },
    () => undefined
  )
  return {
    repository,
    product: new ProductController(
      repository,
      native,
      activation,
      preview,
      applicationPicker,
      settings,
      { refreshTray: () => Promise.resolve(), stateChanged: () => undefined }
    )
  }
}

function display(hdr: boolean): Display {
  return {
    id: 'display:one',
    name: 'Test display',
    windowsDisplayName: '\\\\.\\DISPLAY1',
    monitorDevicePath: 'test-monitor-path',
    manufacturer: 'TEST',
    productCode: '1234',
    serialNumber: '5678',
    adapter: { id: 'adapter:one', name: 'Test GPU', vendor: 'nvidia', deviceId: 'device' },
    connection: 'DisplayPort',
    primary: true,
    hdr,
    advancedColorSupported: true,
    bitsPerColorChannel: 10,
    refreshRate: 144
  }
}

function capabilityReport(supported: boolean): DisplayCapabilityReport {
  const unavailable = {
    supported: false,
    provider: 'unknown' as const,
    reason: 'Unavailable while HDR is active.'
  }
  const available = {
    supported: true,
    provider: 'windows' as const,
    min: 0,
    max: 100,
    default: 50
  }
  return {
    displayId: 'display:one',
    capabilities: {
      brightness: supported ? available : unavailable,
      contrast: unavailable,
      gamma: unavailable,
      saturation: unavailable,
      hue: unavailable,
      colorTemperature: unavailable
    },
    nativeState: {
      nvidia: { saturation: { supported: false }, hue: { supported: false } },
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

describe('ProductController settings ownership', () => {
  it('preserves the latest main-owned window geometry across renderer updates', async () => {
    const saved: Parameters<ProductSettingsPort['save']>[0][] = []
    const current = {
      launchAtStartup: false,
      launchBehavior: 'tray' as const,
      closeBehavior: 'tray' as const,
      theme: 'system' as const,
      miniPanelPosition: { x: 20, y: 30 },
      windowBounds: { x: 100, y: 120, width: 1100, height: 720 },
      windowMaximized: true
    }
    const { product } = controller(undefined, {
      get: () => Promise.resolve(current),
      save: (settings) => {
        saved.push(settings)
        return Promise.resolve(settings)
      },
      apply: () => undefined
    })

    await product.updateSettings({
      launchAtStartup: true,
      launchBehavior: 'app',
      closeBehavior: 'shutdown',
      theme: 'dark',
      windowBounds: { x: 3000, y: 10, width: 900, height: 600 }
    })

    expect(saved).toEqual([
      {
        ...current,
        launchAtStartup: true,
        launchBehavior: 'app',
        closeBehavior: 'shutdown',
        theme: 'dark'
      }
    ])
  })
})

describe('ProductController Default profile', () => {
  it('does not allow the permanent Default profile to be deleted', async () => {
    const { product } = controller()
    await expect(product.deleteProfile('DEFAULT')).rejects.toBeInstanceOf(ProductConflictError)
  })

  it('allows Default to be renamed while keeping it enabled and free of application assignments', async () => {
    const { product, repository } = controller()
    const defaultProfile = await repository.findById('default')
    const edited: ColorProfile = {
      ...defaultProfile!,
      name: 'Renamed',
      enabled: false,
      applications: [{ executableName: 'game.exe' }]
    }

    await expect(product.saveProfile(edited)).resolves.toMatchObject({
      id: 'default',
      name: 'Renamed',
      enabled: true,
      applications: []
    })
  })
})

describe('ProductController application icons', () => {
  it('hydrates legacy application rules from their executable paths and caches the result', async () => {
    let iconReads = 0
    const { product, repository } = controller({
      pick: () => Promise.resolve(null),
      describe: () => Promise.resolve(null),
      resolveIcon: () => {
        iconReads += 1
        return Promise.resolve('data:image/png;base64,AA==')
      }
    })
    await repository.save({
      id: 'tarkov',
      name: 'Tarkov',
      enabled: true,
      applications: [
        {
          executableName: 'EscapeFromTarkov.exe',
          executablePath: 'C:\\Battlestate Games\\Escape From Tarkov\\EscapeFromTarkov.exe'
        }
      ],
      displays: []
    })

    const first = await product.getState()
    const second = await product.getStateForBroadcast()

    expect(
      first.configuration.profiles.find((profile) => profile.id === 'tarkov')?.applications[0]
    ).toMatchObject({ iconDataUrl: 'data:image/png;base64,AA==' })
    expect(
      second.configuration.profiles.find((profile) => profile.id === 'tarkov')?.applications[0]
    ).toMatchObject({ iconDataUrl: 'data:image/png;base64,AA==' })
    expect(iconReads).toBe(1)
  })
})

describe('ProductController hardware snapshots', () => {
  it('refreshes display and capability data after a topology transition invalidates the cache', async () => {
    let hdr = false
    let hardwareReads = 0
    const native: ProductNativePort = {
      getDisplays: () => {
        hardwareReads += 1
        return Promise.resolve([display(hdr)])
      },
      getDisplayCapabilityReport: () => Promise.resolve(capabilityReport(!hdr)),
      getForegroundApplication: () => Promise.resolve(null),
      getVisibleApplications: () => Promise.resolve([])
    }
    const { product } = controller(undefined, undefined, native)

    const initial = await product.getState()
    hdr = true
    const cached = await product.getStateForBroadcast()
    product.invalidateHardwareCache()
    const refreshed = await product.getStateForBroadcast()

    expect(initial.displays[0]?.hdr).toBe(false)
    expect(cached.displays[0]?.hdr).toBe(false)
    expect(refreshed.displays[0]?.hdr).toBe(true)
    expect(refreshed.capabilityReports['display:one']?.capabilities.brightness.supported).toBe(
      false
    )
    expect(hardwareReads).toBe(2)
  })
})
