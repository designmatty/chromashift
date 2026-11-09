import { z } from 'zod'
import { gammaRangeForBrightness, type ColorProfile, type GammaRange } from './model.js'

export const learnedGammaRangeSchema = z
  .object({
    min: z.number().finite().min(0.3).max(1).optional(),
    max: z.number().finite().min(1).max(2.8).optional()
  })
  .strict()
  .refine((range) => range.min !== undefined || range.max !== undefined)

const brightnessKeySchema = z.string().refine((key) => {
  const value = Number(key)
  return Number.isFinite(value) && value >= 0 && value <= 100 && String(value) === key
})

export const gammaLimitsForModeSchema = z
  .object({
    baselineHash: z.string().min(1),
    brightness: z.record(brightnessKeySchema, learnedGammaRangeSchema)
  })
  .strict()
  .superRefine((mode, context) => {
    for (const [brightness, learned] of Object.entries(mode.brightness)) {
      const initial = gammaRangeForBrightness(Number(brightness))
      if ((learned.min ?? initial.min) < initial.min || (learned.max ?? initial.max) > initial.max)
        context.addIssue({
          code: 'custom',
          message: 'Learned limits must narrow the starting envelope.'
        })
    }
  })

export const displayGammaLimitsSchema = z
  .object({ sdr: gammaLimitsForModeSchema.optional(), hdr: gammaLimitsForModeSchema.optional() })
  .strict()

/** A new runtime-owned slice. Absence is the v1 starting state; no profile migration. */
export const displayLimitsSchema = z
  .object({
    schemaVersion: z.literal(1),
    displays: z.record(z.string().startsWith('display:'), displayGammaLimitsSchema)
  })
  .strict()

export type DisplayLimits = z.infer<typeof displayLimitsSchema>
export type DisplayGammaLimits = z.infer<typeof displayGammaLimitsSchema>
export type LearnedGammaRange = z.infer<typeof learnedGammaRangeSchema>
export const emptyDisplayLimits: DisplayLimits = { schemaVersion: 1, displays: {} }

export function effectiveGammaRange(
  limits: DisplayGammaLimits | undefined,
  brightness: number,
  mode: 'sdr' | 'hdr' = 'sdr'
): GammaRange {
  const initial = gammaRangeForBrightness(brightness)
  const learned = limits?.[mode]?.brightness[String(brightness)]
  return {
    min: Math.max(initial.min, learned?.min ?? initial.min),
    max: Math.min(initial.max, learned?.max ?? initial.max)
  }
}

export function clampProfileGamma(profile: ColorProfile, limits: DisplayLimits): ColorProfile {
  return {
    ...profile,
    displays: profile.displays.map((target) => {
      const range = effectiveGammaRange(
        limits.displays[target.displayId.toLowerCase()],
        target.color.brightness
      )
      return {
        ...target,
        color: {
          ...target.color,
          gamma: Math.min(range.max, Math.max(range.min, target.color.gamma))
        }
      }
    })
  }
}
