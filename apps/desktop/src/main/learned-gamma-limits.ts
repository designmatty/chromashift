import {
  displayLimitsSchema,
  effectiveGammaRange,
  effectiveGammaBrightness,
  emptyDisplayLimits,
  type ColorProfile,
  type DisplayLimits,
  type ProfileRepository
} from '@chromashift/core'
import type {
  Display,
  DisplayApplyResult,
  DisplayCapabilityReport,
  DisplaySettings
} from '@chromashift/native-client'
import { SettingsSliceStore } from '@main/settings-slice-store.js'
import type { StructuredLogger } from '@main/structured-logger.js'

interface GammaLimitDisplaySource {
  getDisplays(): Promise<Display[]>
  getDisplayCapabilityReport(displayId: string): Promise<DisplayCapabilityReport>
}

/** Product data only. The native owner supplies hashes of immutable captured ramps. */
export class LearnedGammaLimits {
  readonly #store: SettingsSliceStore<DisplayLimits>
  readonly #confirmedBaselines = new Map<string, string>()
  #brightnessSupport = new Map<string, boolean>()
  #displaySource?: GammaLimitDisplaySource

  public constructor(
    filePath: string,
    private readonly logger: StructuredLogger
  ) {
    this.#store = new SettingsSliceStore(filePath, displayLimitsSchema, emptyDisplayLimits)
  }

  public get current(): DisplayLimits {
    return this.#store.current
  }
  public load(): Promise<DisplayLimits> {
    return this.#store.load()
  }

  public setDisplaySource(source: GammaLimitDisplaySource): void {
    this.#displaySource = source
  }

  /** Only current, writable SDR displays with an immutable baseline may use saved limits. */
  public get applicable(): DisplayLimits {
    return {
      schemaVersion: 1,
      displays: Object.fromEntries(
        Object.entries(this.current.displays).filter(
          ([id, modes]) =>
            this.#brightnessSupport.has(id) &&
            modes.sdr !== undefined &&
            this.#confirmedBaselines.get(id) === modes.sdr.baselineHash
        )
      )
    }
  }

  public async refreshApplicability(): Promise<void> {
    this.#brightnessSupport.clear()
    if (this.#displaySource === undefined) return
    const displays = await this.#displaySource.getDisplays()
    const support = new Map<string, boolean>()
    for (const display of displays) {
      if (display.hdr) continue
      const report = await this.#displaySource.getDisplayCapabilityReport(display.id)
      if (report.capabilities.gamma.supported)
        support.set(display.id.toLowerCase(), report.capabilities.brightness.supported)
    }
    this.#brightnessSupport = support
  }

  public forgetBaseline(displayId: string): void {
    this.#confirmedBaselines.delete(displayId.toLowerCase())
  }

  public forgetAllBaselines(): void {
    this.#confirmedBaselines.clear()
  }

  public async observeBaseline(displayId: string, baselineHash: string): Promise<void> {
    const key = displayId.toLowerCase()
    this.#confirmedBaselines.delete(key)
    if (this.current.displays[key]?.sdr?.baselineHash === baselineHash) {
      this.#confirmedBaselines.set(key, baselineHash)
      return
    }
    await this.#store.update((current) => ({
      ...current,
      displays: {
        ...current.displays,
        [key]: { ...current.displays[key], sdr: { baselineHash, brightness: {} } }
      }
    }))
    this.#confirmedBaselines.set(key, baselineHash)
    this.logger.write({
      level: 'information',
      eventName: 'GammaLimitsBaselineChanged',
      displayId,
      baselineHash
    })
  }

  public async learn(
    displayId: string,
    limit: NonNullable<DisplayApplyResult['learnedGammaLimit']>,
    baselineHash: string
  ): Promise<void> {
    const key = displayId.toLowerCase()
    await this.#store.update((current) => {
      // Reset may race an in-flight apply. A later accepted result starts fresh
      // learning against the already captured baseline, without another capture.
      const mode = current.displays[key]?.sdr ?? { baselineHash, brightness: {} }
      if (mode.baselineHash !== baselineHash)
        throw new Error('The captured baseline changed while learning gamma limits.')
      const brightness = String(limit.brightness)
      const previous = mode.brightness[brightness] ?? {}
      const value =
        limit.end === 'min'
          ? Math.max(previous.min ?? 0.3, limit.value)
          : Math.min(previous.max ?? 2.8, limit.value)
      return {
        ...current,
        displays: {
          ...current.displays,
          [key]: {
            ...current.displays[key],
            sdr: {
              ...mode,
              brightness: { ...mode.brightness, [brightness]: { ...previous, [limit.end]: value } }
            }
          }
        }
      }
    })
    this.logger.write({ level: 'information', eventName: 'GammaLimitLearned', displayId, ...limit })
  }

  public async reset(displayId: string): Promise<void> {
    await this.#store.update((current) => {
      delete current.displays[displayId.toLowerCase()]
      return current
    })
    this.logger.write({ level: 'information', eventName: 'GammaLimitsReset', displayId })
  }

  public clampSettings(displayId: string, settings: DisplaySettings): DisplaySettings {
    if (settings.gamma === undefined) return { ...settings }
    const range = effectiveGammaRange(
      this.applicable.displays[displayId.toLowerCase()],
      effectiveGammaBrightness(
        settings.brightness,
        this.#brightnessSupport.get(displayId.toLowerCase())
      )
    )
    return { ...settings, gamma: Math.min(range.max, Math.max(range.min, settings.gamma)) }
  }

  public clampProfile(profile: ColorProfile): ColorProfile {
    const applicable = this.applicable
    return {
      ...profile,
      displays: profile.displays.map((target) => {
        const key = target.displayId.toLowerCase()
        const brightness = effectiveGammaBrightness(
          target.color.brightness,
          this.#brightnessSupport.get(key)
        )
        if (applicable.displays[key]?.sdr?.brightness[String(brightness)] === undefined)
          return target
        return {
          ...target,
          color: {
            ...target.color,
            gamma: this.clampSettings(target.displayId, target.color).gamma!
          }
        }
      })
    }
  }

  public async clampSavedProfile(
    repository: ProfileRepository,
    profileId: string
  ): Promise<ColorProfile | null> {
    // The updater reads the latest profile inside the serialized repository writer.
    // It changes gamma only; renderer metadata and other saved edits stay intact.
    if (repository.update === undefined)
      throw new Error('Serialized profile updates are unavailable.')
    await this.refreshApplicability()
    return repository.update(profileId, (profile) => this.clampProfile(profile))
  }
}
