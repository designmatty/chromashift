import { JsonProfileRepository, type ColorProfile } from '@chromashift/core'
import type { DisplayCapabilityReport } from '@chromashift/native-client'
import { describe, expect, it } from 'vitest'
import { PreviewSessionController } from './preview-session-controller.js'
import {
  ProductConflictError,
  ProductController,
  type ProductActivationPort,
  type ProductNativePort
} from './product-controller.js'

class MemoryStorage {
  public contents: string | null = null
  public read(): Promise<string | null> { return Promise.resolve(this.contents) }
  public write(contents: string): Promise<void> { this.contents = contents; return Promise.resolve() }
}

const successfulOutcome = { status: 'activated' as const, resolution: null, failures: [] }

function controller(): { product: ProductController; repository: JsonProfileRepository } {
  const repository = new JsonProfileRepository(new MemoryStorage())
  const native: ProductNativePort = {
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
      applyDisplaySettings: () => Promise.reject(new Error('Not used.'))
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
      { pick: () => Promise.resolve(null), describe: () => Promise.resolve(null) },
      {
        get: () => Promise.resolve({ launchAtStartup: false, launchBehavior: 'tray', closeBehavior: 'tray', theme: 'system' }),
        save: (settings) => Promise.resolve(settings),
        apply: () => undefined
      },
      { refreshTray: () => Promise.resolve(), stateChanged: () => undefined }
    )
  }
}

describe('ProductController Default profile', () => {
  it('does not allow the permanent Default profile to be deleted', async () => {
    const { product } = controller()
    await expect(product.deleteProfile('DEFAULT')).rejects.toBeInstanceOf(ProductConflictError)
  })

  it('keeps Default enabled and free of application assignments when edited', async () => {
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
      name: 'Default profile',
      enabled: true,
      applications: []
    })
  })
})
