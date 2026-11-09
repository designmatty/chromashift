import {
  clampProfileGamma,
  displayLimitsSchema,
  effectiveGammaRange,
  emptyDisplayLimits,
  type ColorProfile,
  type DisplayLimits,
  type ProfileRepository
} from '@chromashift/core'
import type { DisplayApplyResult, DisplaySettings } from '@chromashift/native-client'
import { SettingsSliceStore } from '@main/settings-slice-store.js'
import type { StructuredLogger } from '@main/structured-logger.js'

/** Product data only. The native owner supplies hashes of immutable captured ramps. */
export class LearnedGammaLimits {
  readonly #store: SettingsSliceStore<DisplayLimits>

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

  public async observeBaseline(displayId: string, baselineHash: string): Promise<void> {
    const key = displayId.toLowerCase()
    if (this.current.displays[key]?.sdr?.baselineHash === baselineHash) return
    await this.#store.update((current) => ({
      ...current,
      displays: {
        ...current.displays,
        [key]: { ...current.displays[key], sdr: { baselineHash, brightness: {} } }
      }
    }))
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
      this.current.displays[displayId.toLowerCase()],
      settings.brightness ?? 50
    )
    return { ...settings, gamma: Math.min(range.max, Math.max(range.min, settings.gamma)) }
  }

  public clampProfile(profile: ColorProfile): ColorProfile {
    return clampProfileGamma(profile, this.current)
  }

  public async clampSavedProfile(
    repository: ProfileRepository,
    profileId: string
  ): Promise<ColorProfile | null> {
    // The updater reads the latest profile inside the serialized repository writer.
    // It changes gamma only; renderer metadata and other saved edits stay intact.
    if (repository.update === undefined)
      throw new Error('Serialized profile updates are unavailable.')
    return repository.update(profileId, (profile) => this.clampProfile(profile))
  }
}
