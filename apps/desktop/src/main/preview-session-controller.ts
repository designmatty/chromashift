import type { ColorProfile, ColorSettings } from '@chromashift/core'
import type {
  BaselineCaptureResult,
  Display,
  DisplayApplyResult,
  DisplayCapabilityReport
} from '@chromashift/native-client'
import type { PreviewState } from '../shared/product-api.js'

export interface PreviewNativePort {
  getDisplays(): Promise<Display[]>
  getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport>
  captureBaseline(displayId: string): Promise<BaselineCaptureResult>
  applyDisplaySettings(displayId: string, settings: ColorSettings): Promise<DisplayApplyResult>
}

export interface PreviewActivationPort {
  beginPreview(): Promise<void>
  cancelPreview(): Promise<void>
  confirmPreview(profileId: string): Promise<void>
}

export class PreviewValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PreviewValidationError'
  }
}

interface ActivePreview {
  profileId: string
  kind: 'preview' | 'edit' | 'override'
  color: ColorSettings
  displayIds: string[]
  validatedSettings: Array<keyof ColorSettings>
}

export class PreviewSessionController {
  #active: ActivePreview | null = null
  #operationTail: Promise<void> = Promise.resolve()

  public constructor(
    private readonly native: PreviewNativePort,
    private readonly activation: PreviewActivationPort,
    private readonly onStateChanged: (state: PreviewState) => void
  ) {}

  public get state(): PreviewState {
    return this.#active === null
      ? { state: 'inactive' }
      : {
          state: 'active',
          profileId: this.#active.profileId,
          kind: this.#active.kind,
          color: { ...this.#active.color },
          displayIds: [...this.#active.displayIds]
        }
  }

  public async start(
    profile: ColorProfile,
    kind: 'preview' | 'edit' | 'override'
  ): Promise<void> {
    return this.#enqueue(() => this.#start(profile, kind))
  }

  async #start(
    profile: ColorProfile,
    kind: 'preview' | 'edit' | 'override'
  ): Promise<void> {
    if (this.#active !== null) await this.#cancel()
    const displayIds = profile.displays.map((target) => target.displayId)
    const settingNames = Object.keys(profile.color) as Array<keyof ColorSettings>
    await this.#validate(displayIds, profile.color, kind !== 'preview')
    await this.activation.beginPreview()

    try {
      for (const displayId of displayIds) await this.native.captureBaseline(displayId)
      for (const displayId of displayIds) {
        await this.native.applyDisplaySettings(displayId, profile.color)
      }
    } catch (error) {
      await this.activation.cancelPreview()
      throw error
    }

    this.#setActive(profile.id, kind, profile.color, displayIds, settingNames)
  }

  public async update(
    profileId: string,
    color: ColorSettings,
    displayIds: string[]
  ): Promise<void> {
    return this.#enqueue(() => this.#update(profileId, color, displayIds))
  }

  async #update(
    profileId: string,
    color: ColorSettings,
    displayIds: string[]
  ): Promise<void> {
    const active = this.#requireActive(profileId)
    if (!sameDisplayIds(active.displayIds, displayIds)) {
      const kind = active.kind
      await this.#cancel()
      await this.#start({
        id: profileId,
        name: 'Display preview',
        enabled: true,
        color,
        applications: [],
        displays: displayIds.map((displayId) => ({ displayId }))
      }, kind)
      return
    }
    const settingNames = Object.keys(color) as Array<keyof ColorSettings>
    if (settingNames.length > 0 &&
      settingNames.some((setting) => !active.validatedSettings.includes(setting))) {
      await this.#validate(displayIds, color)
    }
    for (const displayId of displayIds) await this.native.applyDisplaySettings(displayId, color)
    this.#setActive(profileId, active.kind, color, displayIds, settingNames)
  }

  public async confirm(profileId: string): Promise<void> {
    return this.#enqueue(() => this.#confirm(profileId))
  }

  async #confirm(profileId: string): Promise<void> {
    this.#requireActive(profileId)
    this.#clearActive()
    try {
      await this.activation.confirmPreview(profileId)
    } finally {
      this.onStateChanged(this.state)
    }
  }

  public async completePreservingMode(profileId: string): Promise<void> {
    return this.#enqueue(() => this.#completePreservingMode(profileId))
  }

  async #completePreservingMode(profileId: string): Promise<void> {
    this.#requireActive(profileId)
    this.#clearActive()
    try {
      await this.activation.cancelPreview()
    } finally {
      this.onStateChanged(this.state)
    }
  }

  public async cancel(): Promise<void> {
    return this.#enqueue(() => this.#cancel())
  }

  public async cancelNonOverride(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#active?.kind !== 'override') await this.#cancel()
    })
  }

  async #cancel(): Promise<void> {
    if (this.#active === null) return
    this.#clearActive()
    try {
      await this.activation.cancelPreview()
    } finally {
      this.onStateChanged(this.state)
    }
  }

  public async dispose(): Promise<void> {
    await this.cancel()
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation)
    this.#operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  async #validate(
    displayIds: string[],
    color: ColorSettings,
    allowEmpty = false
  ): Promise<void> {
    if (displayIds.length === 0) {
      throw new PreviewValidationError('Select at least one display before previewing.')
    }
    const settingNames = Object.keys(color) as Array<keyof ColorSettings>
    if (settingNames.length === 0 && !allowEmpty) {
      throw new PreviewValidationError('Enable at least one color control before previewing.')
    }

    const displays = await this.native.getDisplays()
    const displayMap = new Map(displays.map((display) => [display.id, display]))
    for (const displayId of displayIds) {
      const display = displayMap.get(displayId)
      if (display === undefined) {
        throw new PreviewValidationError(`Display ${displayId} is no longer connected.`)
      }
      const report = await this.native.getDisplayCapabilityReport(displayId)
      for (const setting of settingNames) {
        const capability = report.capabilities[setting]
        if (!capability.supported) {
          throw new PreviewValidationError(
            `${display.name} cannot preview ${formatSetting(setting)}: ${capability.reason ?? 'unsupported by the active provider'}.`
          )
        }
        if (
          display.hdr &&
          capability.provider === 'windows' &&
          (setting === 'brightness' || setting === 'contrast' || setting === 'gamma')
        ) {
          throw new PreviewValidationError(
            `${formatSetting(setting)} is disabled for ${display.name} because Windows gamma controls are unsafe while HDR is active.`
          )
        }
      }
    }
  }

  #setActive(
    profileId: string,
    kind: ActivePreview['kind'],
    color: ColorSettings,
    displayIds: string[],
    validatedSettings: Array<keyof ColorSettings>
  ): void {
    this.#active = {
      profileId,
      kind,
      color: { ...color },
      displayIds: [...displayIds],
      validatedSettings: [...validatedSettings]
    }
    this.onStateChanged(this.state)
  }

  #requireActive(profileId: string): ActivePreview {
    if (this.#active === null) throw new PreviewValidationError('No preview is active.')
    if (this.#active.profileId.toLowerCase() !== profileId.toLowerCase()) {
      throw new PreviewValidationError('The active preview belongs to a different profile.')
    }
    return this.#active
  }

  #clearActive(): void {
    this.#active = null
  }
}

function sameDisplayIds(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = left.map((value) => value.toLowerCase()).sort()
  const normalizedRight = right.map((value) => value.toLowerCase()).sort()
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function formatSetting(setting: string): string {
  return setting.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
}
