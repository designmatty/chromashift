import { randomUUID } from 'node:crypto'
import {
  DEFAULT_PROFILE_ID,
  type ColorProfile,
  type DisplayColorTarget,
  type ProfileConfiguration,
  type ProfileRepository
} from '@chromashift/core'
import type {
  Display,
  DisplayCapabilityReport,
  ForegroundApplication
} from '@chromashift/native-client'
import type { ApplicationSelection, AppSettings, ProductState } from '../shared/product-api.js'
import type { ActivationOutcome } from './activation-coordinator.js'
import type { ActivationControllerState } from './automatic-activation-controller.js'
import type { PreviewSessionController } from './preview-session-controller.js'

export interface ProductNativePort {
  getDisplays(): Promise<Display[]>
  getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport>
  getForegroundApplication(): Promise<ForegroundApplication | null>
  getVisibleApplications(): Promise<ForegroundApplication[]>
}

export interface ProductActivationPort {
  readonly state: ActivationControllerState
  selectManualProfile(profileId: string): Promise<ActivationOutcome>
  enableAutomatic(): Promise<ActivationOutcome>
  restoreBaseline(): Promise<ActivationOutcome>
  refreshAfterConfigurationChange(): Promise<void>
}

export interface ApplicationPickerPort {
  pick(): Promise<ApplicationSelection | null>
  describe(application: ForegroundApplication): Promise<ApplicationSelection | null>
  resolveIcon?(executablePath: string): Promise<string | null>
}

export interface ProductSettingsPort {
  get(): Promise<AppSettings>
  save(settings: AppSettings): Promise<AppSettings>
  apply(settings: AppSettings): void
}

export interface ProductRefreshPort {
  refreshTray(): Promise<void>
  stateChanged(): void
}

export class ProductController {
  #hardwareCache: {
    displays: Display[]
    capabilityReports: Record<string, DisplayCapabilityReport>
  } | null = null
  #applicationIconCache = new Map<string, Promise<string | null>>()

  public constructor(
    private readonly repository: ProfileRepository,
    private readonly native: ProductNativePort,
    private readonly activation: ProductActivationPort,
    private readonly preview: PreviewSessionController,
    private readonly applicationPicker: ApplicationPickerPort,
    private readonly settings: ProductSettingsPort,
    private readonly refresh: ProductRefreshPort,
    private readonly version: string = '0.0.0'
  ) {}

  public async getState(): Promise<ProductState> {
    const displays = await this.native.getDisplays()
    const capabilityReports = Object.fromEntries(
      await Promise.all(
        displays.map(async (display) => [
          display.id,
          await this.native.getDisplayCapabilityReport(display.id)
        ])
      )
    )
    this.#hardwareCache = { displays, capabilityReports }
    return this.#composeState(displays, capabilityReports)
  }

  public async getStateForBroadcast(): Promise<ProductState> {
    if (this.#hardwareCache === null) return this.getState()
    return this.#composeState(this.#hardwareCache.displays, this.#hardwareCache.capabilityReports)
  }

  async #composeState(
    displays: Display[],
    capabilityReports: Record<string, DisplayCapabilityReport>
  ): Promise<ProductState> {
    const configuration = await this.#configurationWithApplicationIcons()
    return {
      version: this.version,
      configuration,
      displays,
      capabilityReports,
      activation: this.activation.state,
      foregroundApplication: await this.native.getForegroundApplication(),
      preview: this.preview.state,
      settings: await this.settings.get()
    }
  }

  async #configurationWithApplicationIcons(): Promise<ProfileConfiguration> {
    const configuration = await this.repository.getConfiguration()
    if (this.applicationPicker.resolveIcon === undefined) return configuration

    const profiles = await Promise.all(
      configuration.profiles.map(async (profile) => ({
        ...profile,
        applications: await Promise.all(
          profile.applications.map(async (application) => {
            if (application.iconDataUrl !== undefined || application.executablePath === undefined) {
              return application
            }
            const iconDataUrl = await this.#resolveApplicationIcon(application.executablePath)
            return iconDataUrl === null ? application : { ...application, iconDataUrl }
          })
        )
      }))
    )
    return { ...configuration, profiles }
  }

  #resolveApplicationIcon(executablePath: string): Promise<string | null> {
    const key = executablePath.toLowerCase()
    const cached = this.#applicationIconCache.get(key)
    if (cached !== undefined) return cached
    const pending = this.applicationPicker.resolveIcon!(executablePath).catch(() => null)
    this.#applicationIconCache.set(key, pending)
    return pending
  }

  public async createProfile(name: string): Promise<ColorProfile> {
    const profile = await this.repository.save({
      id: randomUUID(),
      name,
      enabled: true,
      applications: [],
      displays: []
    })
    await this.#configurationChanged()
    return profile
  }

  public async saveProfile(profile: ColorProfile): Promise<ColorProfile> {
    const isDefault = profile.id.toLowerCase() === DEFAULT_PROFILE_ID
    const saved = await this.repository.save(
      isDefault ? { ...profile, id: DEFAULT_PROFILE_ID, enabled: true, applications: [] } : profile
    )
    if (
      !saved.enabled &&
      this.activation.state.mode.kind === 'manual' &&
      this.activation.state.mode.profileId.toLowerCase() === saved.id.toLowerCase()
    ) {
      await this.activation.enableAutomatic()
    }
    await this.#configurationChanged()
    return saved
  }

  public async duplicateProfile(profileId: string): Promise<ColorProfile> {
    const source = await this.repository.findById(profileId)
    if (source === null) throw new ProductNotFoundError(`Profile ${profileId} does not exist.`)
    const duplicate = await this.repository.duplicate(profileId, {
      id: randomUUID(),
      name: `${source.name} Copy`
    })
    await this.#configurationChanged()
    return duplicate
  }

  public async deleteProfile(profileId: string): Promise<boolean> {
    if (profileId.toLowerCase() === DEFAULT_PROFILE_ID) {
      throw new ProductConflictError('The Default profile cannot be deleted.')
    }
    if (
      this.preview.state.state === 'active' &&
      this.preview.state.profileId.toLowerCase() === profileId.toLowerCase()
    ) {
      await this.preview.cancel()
    }
    const deleted = await this.repository.delete(profileId)
    if (!deleted) throw new ProductNotFoundError(`Profile ${profileId} does not exist.`)
    if (
      this.activation.state.mode.kind === 'manual' &&
      this.activation.state.mode.profileId.toLowerCase() === profileId.toLowerCase()
    ) {
      await this.activation.enableAutomatic()
    }
    await this.#configurationChanged()
    return true
  }

  public async reorderProfiles(profileIds: readonly string[]): Promise<void> {
    const profiles = await this.repository.list()
    const defaultProfile = profiles.find(
      (profile) => profile.id.toLowerCase() === DEFAULT_PROFILE_ID
    )
    if (defaultProfile === undefined || profileIds[0]?.toLowerCase() !== DEFAULT_PROFILE_ID) {
      throw new ProductConflictError('The Default profile must remain first.')
    }
    if (this.repository.reorder === undefined) {
      throw new ProductConflictError('Profile reordering is unavailable.')
    }
    await this.repository.reorder(profileIds)
    await this.#configurationChanged()
  }

  public async setDefaultProfile(profileId: string | null): Promise<void> {
    if (profileId !== DEFAULT_PROFILE_ID) {
      throw new ProductConflictError('The Default profile is the permanent catch-all profile.')
    }
    await this.repository.setDefaultProfileId(DEFAULT_PROFILE_ID)
    await this.#configurationChanged()
  }

  public async activateProfile(profileId: string): Promise<void> {
    assertSuccessfulOutcome(await this.activation.selectManualProfile(profileId))
    await this.refresh.refreshTray()
    this.refresh.stateChanged()
  }

  public async enableAutomatic(): Promise<void> {
    assertSuccessfulOutcome(await this.activation.enableAutomatic())
    await this.refresh.refreshTray()
    this.refresh.stateChanged()
  }

  public async restoreBaseline(): Promise<void> {
    assertSuccessfulOutcome(await this.activation.restoreBaseline())
    await this.refresh.refreshTray()
    this.refresh.stateChanged()
  }

  public pickApplication(): Promise<ApplicationSelection | null> {
    return this.applicationPicker.pick()
  }

  public async listApplications(): Promise<ApplicationSelection[]> {
    const selections = await Promise.all(
      (await this.native.getVisibleApplications()).map((application) =>
        this.applicationPicker.describe(application)
      )
    )
    return selections.filter((selection): selection is ApplicationSelection => selection !== null)
  }

  public async updateSettings(settings: AppSettings): Promise<AppSettings> {
    const saved = await this.settings.save(settings)
    this.settings.apply(saved)
    this.refresh.stateChanged()
    return saved
  }

  public async startPreview(
    profile: ColorProfile,
    kind: 'preview' | 'edit' | 'override'
  ): Promise<void> {
    await this.preview.start(profile, kind)
    this.refresh.stateChanged()
  }

  public async updatePreview(profileId: string, targets: DisplayColorTarget[]): Promise<void> {
    await this.preview.update(profileId, targets)
    this.refresh.stateChanged()
  }

  public async confirmPreview(
    profile: ColorProfile,
    activation: 'manual' | 'preserve'
  ): Promise<ColorProfile> {
    const saved = await this.saveProfile(profile)
    if (activation === 'manual') await this.preview.confirm(profile.id)
    else await this.preview.completePreservingMode(profile.id)
    await this.refresh.refreshTray()
    this.refresh.stateChanged()
    return saved
  }

  public async cancelPreview(): Promise<void> {
    await this.preview.cancel()
    this.refresh.stateChanged()
  }

  async #configurationChanged(): Promise<void> {
    await this.activation.refreshAfterConfigurationChange()
    await this.refresh.refreshTray()
    this.refresh.stateChanged()
  }
}

export class ProductNotFoundError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ProductNotFoundError'
  }
}

export class ProductConflictError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ProductConflictError'
  }
}

function assertSuccessfulOutcome(outcome: ActivationOutcome): void {
  if (outcome.status !== 'failed' && outcome.status !== 'partialFailure') return
  throw new Error(
    outcome.failures.map((failure) => failure.message).join(' ') ||
      `Display activation ended with ${outcome.status}.`
  )
}
