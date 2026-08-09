import { z } from 'zod'

export const PROTOCOL_VERSION = 1

export const displayIdSchema = z.string().startsWith('display:')

const normalizedColorValueSchema = z.number().finite().min(0).max(100)

export const displaySettingsSchema = z
  .object({
    brightness: normalizedColorValueSchema.optional(),
    contrast: normalizedColorValueSchema.optional(),
    gamma: z.number().finite().min(0.5).max(2.8).optional(),
    saturation: normalizedColorValueSchema.optional(),
    hue: normalizedColorValueSchema.optional(),
    colorTemperature: normalizedColorValueSchema.optional()
  })
  .strict()

export const displayRequestSchema = z
  .object({
    displayId: displayIdSchema
  })
  .strict()

export const displayApplyRequestSchema = z
  .object({
    displayId: displayIdSchema,
    settings: displaySettingsSchema
  })
  .strict()

export const nativeRequestSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional()
})

export const nativeSuccessResponseSchema = z.object({
  id: z.string().min(1),
  ok: z.literal(true),
  result: z.unknown()
})

export const nativeErrorResponseSchema = z.object({
  id: z.string().min(1),
  ok: z.literal(false),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1)
  })
})

export const nativeResponseSchema = z.discriminatedUnion('ok', [
  nativeSuccessResponseSchema,
  nativeErrorResponseSchema
])

export const nativeEventSchema = z.object({
  event: z.string().min(1),
  data: z.unknown()
})

export const nativeMessageSchema = z.union([
  nativeResponseSchema,
  nativeEventSchema
])

export const systemInfoSchema = z.object({
  protocolVersion: z.number().int(),
  serviceVersion: z.string(),
  operatingSystem: z.string(),
  processId: z.number().int().positive(),
  providers: z.object({
    amd: z.object({
      libraryAvailable: z.boolean(),
      initialized: z.boolean(),
      version: z.string().nullable(),
      fullVersion: z.number().int().nonnegative().nullable(),
      displayCount: z.number().int().nonnegative(),
      runtimeValidation: z.string(),
      error: z.string().nullable().optional()
    })
  })
})

export const foregroundApplicationSchema = z.object({
  pid: z.number().int().positive(),
  executable: z.string().nullable(),
  path: z.string().nullable(),
  title: z.string(),
  monitorDeviceName: z.string().nullable()
})

export const foregroundCurrentResultSchema = z.object({
  application: foregroundApplicationSchema.nullable()
})

export const foregroundApplicationChangedDataSchema = z.object({
  application: foregroundApplicationSchema
})

export const displayAdapterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  vendor: z.enum(['nvidia', 'amd', 'intel', 'unknown']),
  deviceId: z.string()
})

export const displaySchema = z.object({
  id: displayIdSchema,
  name: z.string().min(1),
  windowsDisplayName: z.string().min(1),
  monitorDevicePath: z.string().min(1),
  manufacturer: z.string().nullable(),
  productCode: z.string().nullable(),
  serialNumber: z.string().nullable(),
  adapter: displayAdapterSchema,
  connection: z.string().min(1),
  primary: z.boolean(),
  hdr: z.boolean(),
  advancedColorSupported: z.boolean(),
  bitsPerColorChannel: z.number().int().nonnegative(),
  refreshRate: z.number().nonnegative()
})

export const displayListResultSchema = z.object({
  displays: z.array(displaySchema)
})

export const capabilitySchema = z.object({
  supported: z.boolean(),
  provider: z.enum(['windows', 'nvidia', 'amd', 'intel', 'unknown']),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  default: z.number().nullable().optional(),
  reason: z.string().nullable().optional()
})

export const displayCapabilitiesSchema = z.object({
  brightness: capabilitySchema,
  contrast: capabilitySchema,
  gamma: capabilitySchema,
  saturation: capabilitySchema,
  hue: capabilitySchema,
  colorTemperature: capabilitySchema
})

export const providerControlStateSchema = z.object({
  supported: z.boolean(),
  current: z.number().int().nullable().optional(),
  min: z.number().int().nullable().optional(),
  max: z.number().int().nullable().optional(),
  default: z.number().int().nullable().optional(),
  reason: z.string().nullable().optional()
})

export const nativeDisplayStateSchema = z.object({
  nvidia: z.object({
    saturation: providerControlStateSchema,
    hue: providerControlStateSchema
  }),
  amd: z.object({
    brightness: providerControlStateSchema,
    contrast: providerControlStateSchema,
    saturation: providerControlStateSchema,
    hue: providerControlStateSchema,
    colorTemperature: providerControlStateSchema,
    gammaRampHash: z.string().nullable().optional(),
    gammaReason: z.string().nullable().optional()
  })
})

export const displayCapabilitiesResultSchema = z.object({
  displayId: displayIdSchema,
  capabilities: displayCapabilitiesSchema,
  nativeState: nativeDisplayStateSchema
})

const gammaRampChannelSchema = z
  .array(z.number().int().min(0).max(65_535))
  .length(256)

export const gammaRampSchema = z.object({
  red: gammaRampChannelSchema,
  green: gammaRampChannelSchema,
  blue: gammaRampChannelSchema
})

export const windowsDisplayStateSchema = z.object({
  displayId: displayIdSchema,
  provider: z.literal('windows'),
  gammaRamp: gammaRampSchema,
  gammaRampHash: z.string().min(1)
})

export const amdDisplayStateSchema = z.object({
  displayId: displayIdSchema,
  provider: z.literal('amd'),
  gammaRampHash: z.string().min(1).optional(),
  brightness: z.number().int().optional(),
  contrast: z.number().int().optional(),
  saturation: z.number().int().optional(),
  hue: z.number().int().optional(),
  colorTemperature: z.number().int().optional()
})

export const displayStateSchema = z.discriminatedUnion('provider', [
  windowsDisplayStateSchema,
  amdDisplayStateSchema
])

export const baselineCaptureResultSchema = z.object({
  displayId: displayIdSchema,
  state: z.enum(['captured', 'alreadyCaptured']),
  gammaRampHash: z.string().min(1).optional(),
  nvidiaSaturation: z.number().int().optional(),
  nvidiaHue: z.number().int().optional(),
  amdBrightness: z.number().int().optional(),
  amdContrast: z.number().int().optional(),
  amdSaturation: z.number().int().optional(),
  amdHue: z.number().int().optional(),
  amdColorTemperature: z.number().int().optional(),
  amdGammaRampHash: z.string().min(1).optional()
})

export const displayApplyResultSchema = z.object({
  displayId: displayIdSchema,
  settings: displaySettingsSchema,
  applied: z.object({
    gammaRampHash: z.string().min(1).optional(),
    brightness: z.number().int().optional(),
    contrast: z.number().int().optional(),
    saturation: z.number().int().optional(),
    hue: z.number().int().optional(),
    colorTemperature: z.number().int().optional()
  })
})

const restoredDisplayResultSchema = z.object({
  displayId: displayIdSchema,
  restored: z.literal(true),
  gammaRampHash: z.string().min(1).optional()
})

const unrestoredDisplayResultSchema = z
  .object({
    displayId: displayIdSchema,
    restored: z.literal(false),
    reason: z.string().min(1).optional(),
    error: z.string().min(1).optional()
  })
  .refine((result) => result.reason !== undefined || result.error !== undefined, {
    message: 'An unrestored display requires a reason or error.'
  })

export const displayRestoreResultSchema = z.discriminatedUnion('restored', [
  restoredDisplayResultSchema,
  unrestoredDisplayResultSchema
])

export const restoreAllResultSchema = z.object({
  displays: z.array(displayRestoreResultSchema)
})

export type NativeRequest = z.infer<typeof nativeRequestSchema>
export type NativeResponse = z.infer<typeof nativeResponseSchema>
export type NativeEvent = z.infer<typeof nativeEventSchema>
export type SystemInfo = z.infer<typeof systemInfoSchema>
export type ForegroundApplication = z.infer<typeof foregroundApplicationSchema>
export type Display = z.infer<typeof displaySchema>
export type Capability = z.infer<typeof capabilitySchema>
export type DisplayCapabilities = z.infer<typeof displayCapabilitiesSchema>
export type DisplayCapabilityReport = z.infer<typeof displayCapabilitiesResultSchema>
export type DisplaySettings = z.infer<typeof displaySettingsSchema>
export type GammaRamp = z.infer<typeof gammaRampSchema>
export type DisplayState = z.infer<typeof displayStateSchema>
export type BaselineCaptureResult = z.infer<typeof baselineCaptureResultSchema>
export type DisplayApplyResult = z.infer<typeof displayApplyResultSchema>
export type DisplayRestoreResult = z.infer<typeof displayRestoreResultSchema>
export type RestoreAllResult = z.infer<typeof restoreAllResultSchema>
