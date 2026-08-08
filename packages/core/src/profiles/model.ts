import { z } from 'zod'

const identifierSchema = z.string().trim().min(1)
const normalizedValueSchema = z.number().finite().min(0).max(100)

export const colorSettingsSchema = z
  .object({
    brightness: normalizedValueSchema.optional(),
    contrast: normalizedValueSchema.optional(),
    gamma: z.number().finite().min(0.5).max(2).optional(),
    saturation: normalizedValueSchema.optional(),
    hue: normalizedValueSchema.optional(),
    colorTemperature: normalizedValueSchema.optional()
  })
  .strict()

export const applicationRuleSchema = z
  .object({
    executableName: z.string().trim().min(1),
    executablePath: z.string().trim().min(1).optional()
  })
  .strict()

export const profileDisplayTargetSchema = z
  .object({
    displayId: identifierSchema
  })
  .strict()

export const colorProfileSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    color: colorSettingsSchema,
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

export type ColorSettings = z.infer<typeof colorSettingsSchema>
export type ApplicationRule = z.infer<typeof applicationRuleSchema>
export type ProfileDisplayTarget = z.infer<typeof profileDisplayTargetSchema>
export type ColorProfile = z.infer<typeof colorProfileSchema>
