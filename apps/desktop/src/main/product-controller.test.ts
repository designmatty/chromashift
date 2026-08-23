import { JsonProfileRepository, type ColorProfile } from '@chromashift/core'
import type { Display, DisplayCapabilityReport } from '@chromashift/native-client'
import { describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../shared/product-api.js'
import { PreviewSessionController } from './preview-session-controller.js'
import { defaultAppSettings } from './app-settings.js'
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
        ...defaultAppSettings
      }),
    save: (value) => Promise.resolve(value),
    apply: () => undefined
  },
  nativeOverride?: ProductNativePort
): {
  product: ProductController
  repository: JsonProfileRepository
  activation: ProductActivationPort
} {
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
    chromaShiftState: {
      status: 'active',
      pendingOperation: null,
      intendedMode: { kind: 'automatic' },
      intendedTarget: null,
      transitionInProgress: false
    },
    selectManualProfile: () => Promise.resolve(successfulOutcome),
    enableAutomatic: () => Promise.resolve(successfulOutcome),
    restoreBaseline: () => Promise.resolve(successfulOutcome),
    pause: () => Promise.resolve(successfulOutcome),
    resume: () => Promise.resolve(successfulOutcome),
    retrySafetyCheck: () => Promise.resolve(successfulOutcome),
    reconcileAutomaticIntent: () => Promise.resolve(),
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
    activation,
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
      ...defaultAppSettings,
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
      ...defaultAppSettings,
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

  it('rolls shortcut registration back when settings persistence fails', async () => {
    const rollback = vi.fn()
    const { product } = controller(undefined, {
      get: () => Promise.resolve(defaultAppSettings),
      save: () => Promise.reject(new Error('Disk full.')),
      apply: () => undefined,
      prepareShortcuts: (bindings) => ({ bindings: [...bindings], rollback })
    })

    await expect(
      product.updateSettings({
        ...defaultAppSettings,
        shortcutBindings: [{ action: { kind: 'defaultProfile' }, accelerator: 'Control+Shift+D' }]
      })
    ).rejects.toThrow('Disk full')
    expect(rollback).toHaveBeenCalledOnce()
  })
})

describe('ProductController profile shortcut lifecycle', () => {
  it('requires confirmation before disabling a bound profile and removes the binding when confirmed', async () => {
    let settings: AppSettings = {
      ...defaultAppSettings,
      shortcutBindings: [
        { action: { kind: 'profile' as const, profileId: 'gaming' }, accelerator: 'Control+G' }
      ]
    }
    const { product, repository } = controller(undefined, {
      get: () => Promise.resolve(settings),
      save: (next) => {
        settings = next
        return Promise.resolve(next)
      },
      apply: () => undefined,
      prepareShortcuts: (bindings) => ({ bindings: [...bindings], rollback: () => undefined })
    })
    const profile = await repository.save({
      id: 'gaming',
      name: 'Gaming',
      enabled: true,
      applications: [],
      displays: []
    })

    await expect(product.saveProfile({ ...profile, enabled: false })).rejects.toThrow(
      'Turning off Gaming requires removing its Control+G shortcut.'
    )
    await expect(product.saveProfile({ ...profile, enabled: false }, true)).resolves.toMatchObject({
      enabled: false
    })
    expect(settings.shortcutBindings).toEqual([])
  })

  it('removes a direct binding as part of profile deletion', async () => {
    let settings: AppSettings = {
      ...defaultAppSettings,
      shortcutBindings: [
        { action: { kind: 'profile' as const, profileId: 'gaming' }, accelerator: 'Control+G' }
      ]
    }
    const { product, repository } = controller(undefined, {
      get: () => Promise.resolve(settings),
      save: (next) => {
        settings = next
        return Promise.resolve(next)
      },
      apply: () => undefined,
      prepareShortcuts: (bindings) => ({ bindings: [...bindings], rollback: () => undefined })
    })
    await repository.save({
      id: 'gaming',
      name: 'Gaming',
      enabled: true,
      applications: [],
      displays: []
    })

    await product.deleteProfile('gaming')

    expect(settings.shortcutBindings).toEqual([])
  })

  it('reconciles a disabled manual target through the status-safe path', async () => {
    const { product, repository, activation } = controller()
    const profile = await repository.save({
      id: 'gaming',
      name: 'Gaming',
      enabled: true,
      applications: [],
      displays: []
    })
    activation.state.mode = { kind: 'manual', profileId: 'gaming' }
    const reconcile = vi.spyOn(activation, 'reconcileAutomaticIntent')
    const enable = vi.spyOn(activation, 'enableAutomatic')

    await product.saveProfile({ ...profile, enabled: false })

    expect(reconcile).toHaveBeenCalledOnce()
    expect(enable).not.toHaveBeenCalled()
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
