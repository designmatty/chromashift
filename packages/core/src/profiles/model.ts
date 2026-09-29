import { z } from 'zod'

const identifierSchema = z.string().trim().min(1)
const normalizedValueSchema = z.number().finite().min(0).max(100)

export const neutralColorSettings = {
  brightness: 50,
  contrast: 50,
  gamma: 1,
  saturation: 50,
  hue: 0,
  colorTemperature: 50
} as const

export interface GammaRange {
  min: number
  max: number
}

export function gammaRangeForBrightness(brightness: number): GammaRange {
  if (brightness < 7) return { min: 0.5, max: 2.8 }
  if (brightness < 30) return { min: 0.4, max: 2.8 }
  if (brightness < 87) return { min: 0.3, max: 2.8 }
  if (brightness < 90) return { min: 0.3, max: 2.7 }
  if (brightness < 92) return { min: 0.3, max: 2.6 }
  if (brightness < 97) return { min: 0.3, max: 2.5 }
  if (brightness < 100) return { min: 0.3, max: 2.4 }
  return { min: 0.3, max: 2.3 }
}

export function clampGammaForBrightness(gamma: number, brightness: number): number {
  const range = gammaRangeForBrightness(brightness)
  return Math.min(range.max, Math.max(range.min, gamma))
}

const completeColorSettingsSchema = z.object({
  brightness: normalizedValueSchema,
  contrast: normalizedValueSchema,
  gamma: z.number().finite().min(0.3).max(2.8),
  saturation: normalizedValueSchema,
  hue: normalizedValueSchema,
  colorTemperature: normalizedValueSchema
})

export interface CompleteColorSettings {
  brightness: number
  contrast: number
  gamma: number
  saturation: number
  hue: number
  colorTemperature: number
}

export type ColorSettings = CompleteColorSettings

export const colorSettingsSchema: z.ZodType<ColorSettings> = completeColorSettingsSchema
  .strict()
  .superRefine((settings, context) => {
    const range = gammaRangeForBrightness(settings.brightness)
    if (settings.gamma < range.min || settings.gamma > range.max) {
      context.addIssue({
        code: 'custom',
        message: `Gamma must be between ${range.min} and ${range.max} at ${settings.brightness}% brightness.`,
        path: ['gamma']
      })
    }
  })

export function createNeutralColorSettings(): CompleteColorSettings {
  return { ...neutralColorSettings }
}

export const applicationRuleSchema = z
  .object({
    executableName: z.string().trim().min(1),
    executablePath: z.string().trim().min(1).optional(),
    iconDataUrl: z.string().startsWith('data:image/').optional()
  })
  .strict()

export const profileDisplayTargetSchema = z
  .object({
    displayId: identifierSchema,
    color: colorSettingsSchema
  })
  .strict()

export const colorProfileSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    applications: z.array(applicationRuleSchema),
    displays: z.array(profileDisplayTargetSchema)
  })
  .strict()
  .superRefine((profile, context) => {
    const displayIds = new Set<string>()
    for (const [index, display] of profile.displays.entries()) {
      const normalizedId = display.displayId.toLowerCase()
      if (displayIds.has(normalizedId)) {
        context.addIssue({
          code: 'custom',
          message: `Display ${display.displayId} is assigned more than once.`,
          path: ['displays', index, 'displayId']
        })
      }
      displayIds.add(normalizedId)
    }
  })

export type ApplicationRule = z.infer<typeof applicationRuleSchema>
export type ProfileDisplayTarget = z.infer<typeof profileDisplayTargetSchema>
export type ColorProfile = z.infer<typeof colorProfileSchema>

export const colorSettingNames = [
  'brightness',
  'contrast',
  'gamma',
  'saturation',
  'hue',
  'colorTemperature'
] as const satisfies ReadonlyArray<keyof CompleteColorSettings>

export type ColorSettingName = (typeof colorSettingNames)[number]
