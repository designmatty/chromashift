import { z } from 'zod'

export const PROTOCOL_VERSION = 1

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
  id: z.string().startsWith('display:'),
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
  displayId: z.string().startsWith('display:'),
  capabilities: displayCapabilitiesSchema,
  nativeState: nativeDisplayStateSchema
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
