import type { ColorProfile, ColorSettings } from '@chromashift/core'
import type { Display, DisplayCapabilityReport } from '@chromashift/native-client/protocol'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Tooltip } from '@/components/ui/tooltip'
import type { ProductState } from '../../../shared/product-api.js'

type ColorKey = keyof ColorSettings

const controls: Array<{
  key: ColorKey
  label: string
  min: number
  max: number
  step: number
  initial: number
}> = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 100, step: 1, initial: 50 },
  { key: 'contrast', label: 'Contrast', min: 0, max: 100, step: 1, initial: 50 },
  { key: 'gamma', label: 'Gamma', min: 0.5, max: 2.8, step: 0.05, initial: 1 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 100, step: 1, initial: 50 },
  { key: 'hue', label: 'Hue', min: 0, max: 100, step: 1, initial: 0 },
  { key: 'colorTemperature', label: 'Color temperature', min: 0, max: 100, step: 1, initial: 50 }
]

/**
 * Slider positions for controls the user has switched off, so re-enabling a
 * control restores the number it last showed. Keyed per profile and display
 * because each display owns its own settings.
 */
export const rememberedColorValues = new Map<string, ColorSettings>()

function rememberKey(profileId: string, displayId: string): string {
  return `${profileId.toLowerCase()}::${displayId.toLowerCase()}`
}

export function resetRememberedColorValues(profile: ColorProfile | null): void {
  if (profile === null) return
  for (const target of profile.displays) {
    rememberedColorValues.set(rememberKey(profile.id, target.displayId), {
      ...target.lastColorValues,
      ...target.color
    })
  }
}

export interface ControlSupport {
  available: boolean
  /** Short inline status shown in the value slot when the control is unavailable. */
  status: string
  reason: string
  provider: string
}

export function controlSupport(
  key: ColorKey,
  display: Display | undefined,
  report: DisplayCapabilityReport | undefined
): ControlSupport {
  if (display === undefined) {
    return {
      available: false,
      status: 'disconnected',
      reason: 'This display is not connected.',
      provider: ''
    }
  }

  const capability = report?.capabilities[key]
  if (capability === undefined || !capability.supported) {
    return {
      available: false,
      status: 'unavailable',
      reason: capability?.reason ?? 'Unsupported by the active provider.',
      provider: ''
    }
  }

  if (
    display.hdr &&
    capability.provider === 'windows' &&
    (key === 'brightness' || key === 'contrast' || key === 'gamma')
  ) {
    return {
      available: false,
      status: 'unavailable',
      reason: 'Windows gamma controls are unsafe while HDR is active.',
      provider: capability.provider
    }
  }

  return { available: true, status: '', reason: '', provider: capability.provider }
}

export function ColorControls({
  profileId,
  displayId,
  color,
  lastColorValues,
  product,
  editable,
  onChange,
  compact = false
}: {
  profileId: string
  displayId: string
  color: ColorSettings
  lastColorValues: ColorSettings | undefined
  product: ProductState
  editable: boolean
  onChange(color: ColorSettings, lastColorValues: ColorSettings): void
  compact?: boolean
}): React.JSX.Element {
  const display = product.displays.find((item) => item.id === displayId)
  const report = product.capabilityReports[displayId]
  const key = rememberKey(profileId, displayId)
  const remembered = { ...lastColorValues, ...rememberedColorValues.get(key) }
  for (const control of controls) {
    const value = color[control.key]
    if (value !== undefined) remembered[control.key] = value
  }
  rememberedColorValues.set(key, remembered)

  return (
    <Stack gap="12px" px={compact ? '10px' : '0'}>
      {controls.map((control) => {
        const support = controlSupport(control.key, display, report)
        const value = color[control.key]
        const enabled = value !== undefined
        const rememberedValue = remembered[control.key] ?? control.initial
        const row = (
          <Box
            data-part="color-control"
            minW="0"
            h={compact ? '56px' : '25px'}
            display={compact ? 'block' : 'grid'}
            gridTemplateColumns={
              compact ? undefined : { base: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }
            }
            alignItems="center"
            gap="10px"
            tabIndex={support.available ? undefined : 0}
          >
            <Flex
              minW="0"
              h={compact ? '21px' : undefined}
              mb={compact ? '10px' : '0'}
              align="center"
              gap="10px"
            >
              <Checkbox
                checked={enabled}
                disabled={!editable || !support.available}
                onCheckedChange={(checked) => {
                  const next = { ...color }
                  if (checked) {
                    next[control.key] = remembered[control.key] ?? control.initial
                  } else {
                    if (value !== undefined) remembered[control.key] = value
                    delete next[control.key]
                  }
                  rememberedColorValues.set(key, remembered)
                  onChange(next, { ...remembered })
                }}
              >
                <Text
                  as="strong"
                  minW="0"
                  flex="1"
                  overflow="hidden"
                  color={enabled ? 'fg' : 'fg.muted'}
                  fontSize="16px"
                  fontWeight="500"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {control.label}
                </Text>
              </Checkbox>
              <Text
                as="span"
                w={compact || !enabled || !support.available ? 'auto' : '60px'}
                flex="none"
                px={compact || !enabled || !support.available ? '0' : '10px'}
                py={compact || !enabled || !support.available ? '0' : '2px'}
                rounded="6px"
                bg={compact || !enabled || !support.available ? 'transparent' : 'bg.emphasized'}
                color={!support.available ? 'fg' : 'inherit'}
                fontFamily="mono"
                fontSize={compact && enabled ? '16px' : enabled ? '16px' : '12px'}
                textAlign="right"
                fontVariantNumeric="tabular-nums"
              >
                {!support.available
                  ? support.status
                  : enabled
                    ? formatValue(control.key, value)
                    : editable && !compact
                      ? formatValue(control.key, rememberedValue)
                      : 'Not overridden'}
              </Text>
            </Flex>
            <Slider
              value={[value ?? rememberedValue]}
              min={control.min}
              max={control.max}
              step={control.step}
              compact={compact}
              disabled={!editable || !enabled || !support.available}
              aria-label={`${control.label} for ${display?.name ?? displayId}`}
              onValueChange={(values) => {
                const next = values[0]
                if (next === undefined) return
                remembered[control.key] = next
                rememberedColorValues.set(key, remembered)
                onChange({ ...color, [control.key]: next }, { ...remembered })
              }}
            />
          </Box>
        )
        return support.available ? (
          <Box key={control.key}>{row}</Box>
        ) : (
          <Tooltip key={control.key} label={support.reason}>
            {row}
          </Tooltip>
        )
      })}
    </Stack>
  )
}

export function ColorSummary({
  color,
  displayId,
  product
}: {
  color: ColorSettings
  displayId: string
  product: ProductState
}): React.JSX.Element {
  const display = product.displays.find((item) => item.id === displayId)
  const report = product.capabilityReports[displayId]

  return (
    <Grid
      as="dl"
      data-part="color-summary"
      m="0"
      templateColumns={{ base: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }}
      gap="16px 12px"
    >
      {controls.map((control) => {
        const support = controlSupport(control.key, display, report)
        const value = color[control.key]
        const valueElement = (
          <Box
            as="dd"
            w={value === undefined ? 'auto' : '60px'}
            m="0"
            px={value === undefined ? '0' : '10px'}
            py={value === undefined ? '0' : '2px'}
            rounded="6px"
            bg={value === undefined ? 'transparent' : 'bg.emphasized'}
            fontFamily="mono"
            fontSize={value === undefined ? '12px' : '16px'}
            textAlign="right"
            fontVariantNumeric="tabular-nums"
            tabIndex={support.available ? undefined : 0}
          >
            {!support.available
              ? support.status
              : value === undefined
                ? 'Not overridden'
                : formatValue(control.key, value)}
          </Box>
        )
        return (
          <Flex
            data-part="color-summary-item"
            minW="0"
            h="21px"
            align="center"
            gap="10px"
            key={control.key}
          >
            <Text
              as="dt"
              minW="0"
              flex="1"
              overflow="hidden"
              color={value === undefined ? 'fg.muted' : 'fg'}
              fontSize="16px"
              fontWeight="500"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {control.label}
            </Text>
            {support.available ? (
              valueElement
            ) : (
              <Tooltip label={support.reason}>{valueElement}</Tooltip>
            )}
          </Flex>
        )
      })}
    </Grid>
  )
}

function formatValue(key: ColorKey, value: number): string {
  return key === 'gamma'
    ? value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    : `${Math.round(value)}%`
}
import { Box, Flex, Grid, Stack, Text } from '@chakra-ui/react'
