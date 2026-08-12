import {
  activeColorTargets,
  hasColorOverrides,
  type ColorProfile,
  type ColorSettingName,
  type ColorSettings,
  type DisplayColorTarget
} from '@chromashift/core'
import type {
  BaselineCaptureResult,
  Display,
  DisplayApplyResult,
  DisplayCapabilityReport,
  DisplayRestoreResult
} from '@chromashift/native-client'
import type { PreviewState } from '../shared/product-api.js'
import { describeError } from './structured-logger.js'

export interface PreviewNativePort {
  getDisplays(): Promise<Display[]>
  getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport>
  captureBaseline(displayId: string): Promise<BaselineCaptureResult>
  applyDisplaySettings(displayId: string, settings: ColorSettings): Promise<DisplayApplyResult>
  restoreDisplay(displayId: string): Promise<DisplayRestoreResult>
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

export class PreviewRestoreError extends Error {
  public readonly failures: readonly string[]

  public constructor(failures: readonly string[]) {
    super(`Some displays could not be restored. ${failures.join(' ')}`)
    this.name = 'PreviewRestoreError'
    this.failures = failures
  }
}

interface ActivePreview {
  profileId: string
  kind: 'preview' | 'edit' | 'override'
  /** Currently applied settings, keyed by lowercased display ID. */
  applied: Map<string, DisplayColorTarget>
  /** Every display written at any point in this session, for exact rollback. */
  touched: Map<string, string>
  /** Capability checks already passed, keyed by lowercased display ID. */
  validated: Map<string, Set<ColorSettingName>>
}

/**
 * One atomic profile-edit session spanning several displays. Each display previews
 * its own draft settings, switching the edited display keeps the rest of the draft,
 * and teardown restores every display the session touched before handing control
 * back to the activation controller.
 */
export class PreviewSessionController {
  #active: ActivePreview | null = null
  #operationTail: Promise<void> = Promise.resolve()

  public constructor(
    private readonly native: PreviewNativePort,
    private readonly activation: PreviewActivationPort,
    private readonly onStateChanged: (state: PreviewState) => void
  ) {}

  public get state(): PreviewState {
    if (this.#active === null) return { state: 'inactive' }
    return {
      state: 'active',
      profileId: this.#active.profileId,
      kind: this.#active.kind,
      targets: [...this.#active.applied.values()].map((target) => ({
        displayId: target.displayId,
        color: { ...target.color }
      }))
    }
  }

  public async start(profile: ColorProfile, kind: 'preview' | 'edit' | 'override'): Promise<void> {
    return this.#enqueue(() => this.#start(profile, kind))
  }

  async #start(profile: ColorProfile, kind: 'preview' | 'edit' | 'override'): Promise<void> {
    const targets = activeColorTargets(profile)
    if (this.#active !== null && this.#canReuseSession(profile.id, targets, kind)) {
      if (this.#active.kind === 'preview' && kind === 'edit') {
        this.#active.kind = 'edit'
        this.onStateChanged(this.state)
      }
      return
    }
    if (this.#active !== null) await this.#teardown()

    const validated = new Map<string, Set<ColorSettingName>>()
    if (kind === 'preview') this.#requirePreviewableDraft(profile, targets)
    await this.#validateTargets(targets, validated)
    await this.activation.beginPreview()

    const applied = new Map<string, DisplayColorTarget>()
    const touched = new Map<string, string>()
    try {
      for (const target of targets) {
        await this.native.captureBaseline(target.displayId)
        touched.set(target.displayId.toLowerCase(), target.displayId)
      }
      for (const target of targets) {
        await this.native.applyDisplaySettings(target.displayId, target.color)
        applied.set(target.displayId.toLowerCase(), target)
      }
    } catch (error) {
      for (const displayId of touched.values()) {
        try {
          await this.native.restoreDisplay(displayId)
        } catch {
          // Reported through the activation rollback below.
        }
      }
      await this.activation.cancelPreview()
      throw error
    }

    this.#active = { profileId: profile.id, kind, applied, touched, validated }
    this.onStateChanged(this.state)
  }

  public async update(profileId: string, targets: DisplayColorTarget[]): Promise<void> {
    return this.#enqueue(() => this.#update(profileId, targets))
  }

  async #update(profileId: string, targets: DisplayColorTarget[]): Promise<void> {
    const active = this.#requireActive(profileId)
    const desired = targets.filter((target) => hasColorOverrides(target.color))
    await this.#validateTargets(desired, active.validated)

    const desiredKeys = new Set(desired.map((target) => target.displayId.toLowerCase()))
    for (const [key, target] of [...active.applied]) {
      if (desiredKeys.has(key)) continue
      await this.native.restoreDisplay(target.displayId)
      active.applied.delete(key)
    }

    for (const target of desired) {
      const key = target.displayId.toLowerCase()
      const current = active.applied.get(key)
      if (current !== undefined && sameColorSettings(current.color, target.color)) continue
      if (current === undefined) {
        await this.native.captureBaseline(target.displayId)
        active.touched.set(key, target.displayId)
      }
      await this.native.applyDisplaySettings(target.displayId, target.color)
      active.applied.set(key, { displayId: target.displayId, color: { ...target.color } })
    }

    this.onStateChanged(this.state)
  }

  public async confirm(profileId: string): Promise<void> {
    return this.#enqueue(() => this.#complete(profileId, 'manual'))
  }

  public async completePreservingMode(profileId: string): Promise<void> {
    return this.#enqueue(() => this.#complete(profileId, 'preserve'))
  }

  async #complete(profileId: string, activation: 'manual' | 'preserve'): Promise<void> {
    this.#requireActive(profileId)
    const failures = await this.#restoreTouched()
    this.#active = null
    try {
      if (activation === 'manual') await this.activation.confirmPreview(profileId)
      else await this.activation.cancelPreview()
    } finally {
      this.onStateChanged(this.state)
    }
    if (failures.length > 0) throw new PreviewRestoreError(failures)
  }

  public async cancel(): Promise<void> {
    return this.#enqueue(async () => {
      const failures = await this.#teardown()
      if (failures.length > 0) throw new PreviewRestoreError(failures)
    })
  }

  public async cancelNonOverride(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#active !== null && this.#active.kind !== 'override') await this.#teardown()
    })
  }

  public async dispose(): Promise<void> {
    await this.#enqueue(() => this.#teardown())
  }

  /**
   * Restores every display this session wrote and returns control to the
   * activation controller, which reasserts the correct automatic/manual target.
   */
  async #teardown(): Promise<string[]> {
    if (this.#active === null) return []
    const failures = await this.#restoreTouched()
    this.#active = null
    try {
      await this.activation.cancelPreview()
    } finally {
      this.onStateChanged(this.state)
    }
    return failures
  }

  async #restoreTouched(): Promise<string[]> {
    if (this.#active === null) return []
    const failures: string[] = []
    for (const displayId of this.#active.touched.values()) {
      try {
        await this.native.restoreDisplay(displayId)
      } catch (error) {
        failures.push(`${displayId}: ${describeError(error).message}`)
      }
    }
    return failures
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation)
    this.#operationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  #requirePreviewableDraft(profile: ColorProfile, targets: DisplayColorTarget[]): void {
    if (profile.displays.length === 0) {
      throw new PreviewValidationError('Select at least one display before previewing.')
    }
    if (targets.length === 0) {
      throw new PreviewValidationError('Enable at least one color control before previewing.')
    }
  }

  /**
   * Capability and HDR gating is evaluated per display, so an unsupported control
   * on one display never blocks a different display's settings.
   */
  async #validateTargets(
    targets: readonly DisplayColorTarget[],
    validated: Map<string, Set<ColorSettingName>>
  ): Promise<void> {
    const pending = targets
      .map((target) => ({
        target,
        settings: settingNames(target.color).filter(
          (setting) => !validated.get(target.displayId.toLowerCase())?.has(setting)
        )
      }))
      .filter((entry) => entry.settings.length > 0)
    if (pending.length === 0) return

    const displays = await this.native.getDisplays()
    const displayMap = new Map(displays.map((display) => [display.id.toLowerCase(), display]))

    for (const { target, settings } of pending) {
      const key = target.displayId.toLowerCase()
      const display = displayMap.get(key)
      if (display === undefined) {
        throw new PreviewValidationError(`Display ${target.displayId} is no longer connected.`)
      }

      const report = await this.native.getDisplayCapabilityReport(display.id)
      for (const setting of settings) {
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

      const known = validated.get(key) ?? new Set<ColorSettingName>()
      for (const setting of settings) known.add(setting)
      validated.set(key, known)
    }
  }

  #requireActive(profileId: string): ActivePreview {
    if (this.#active === null) throw new PreviewValidationError('No preview is active.')
    if (this.#active.profileId.toLowerCase() !== profileId.toLowerCase()) {
      throw new PreviewValidationError('The active preview belongs to a different profile.')
    }
    return this.#active
  }

  #canReuseSession(
    profileId: string,
    targets: readonly DisplayColorTarget[],
    kind: ActivePreview['kind']
  ): boolean {
    if (this.#active === null) return false
    if (this.#active.profileId.toLowerCase() !== profileId.toLowerCase()) return false
    if (this.#active.kind !== kind && !(this.#active.kind === 'preview' && kind === 'edit')) {
      return false
    }
    if (this.#active.applied.size !== targets.length) return false
    return targets.every((target) => {
      const current = this.#active?.applied.get(target.displayId.toLowerCase())
      return current !== undefined && sameColorSettings(current.color, target.color)
    })
  }
}

function settingNames(color: ColorSettings): ColorSettingName[] {
  return Object.keys(color) as ColorSettingName[]
}

function sameColorSettings(left: ColorSettings, right: ColorSettings): boolean {
  const leftNames = settingNames(left)
  const rightNames = settingNames(right)
  return (
    leftNames.length === rightNames.length &&
    leftNames.every((setting) => left[setting] === right[setting])
  )
}

function formatSetting(setting: string): string {
  return setting.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
}
