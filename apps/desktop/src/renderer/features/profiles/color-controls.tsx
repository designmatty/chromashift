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
  /** Short inline status shown beside the control when it is unavailable. */
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
    <Stack gap={compact ? 4 : 3}>
      {controls.map((control) => {
        const support = controlSupport(control.key, display, report)
        const value = color[control.key]
        const enabled = value !== undefined
        const rememberedValue = remembered[control.key] ?? control.initial
        const row = (
          <Box
            data-part="color-control"
            display={'flex'}
            gridTemplateColumns={
              compact ? undefined : { base: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }
            }
            alignItems="center"
            gap={compact ? 2 : 2}
            flexDirection={compact ? 'column' : 'row'}
            tabIndex={support.available ? undefined : 0}
          >
            <Flex h={compact ? '21px' : undefined} align="center" gap={3} width={'100%'}>
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
                {control.label}
              </Checkbox>
              {editable && !compact && support.available ? (
                <NumberInput.Root
                  ml="auto"
                  flex="none"
                  onValueChange={({ valueAsNumber: inputValue }) => {
                    if (!Number.isFinite(inputValue)) return
                    const nextValue = Math.min(control.max, Math.max(control.min, inputValue))
                    remembered[control.key] = nextValue
                    rememberedColorValues.set(key, remembered)
                    onChange({ ...color, [control.key]: nextValue }, { ...remembered })
                  }}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={String(value ?? rememberedValue)}
                  allowOverflow={false}
                  disabled={!enabled}
                  width="80px"
                  size="xs"
                >
                  <NumberInput.Control />
                  <NumberInput.Input
                    aria-label={`${control.label} value for ${display?.name ?? displayId}`}
                    fontFamily="mono"
                    fontVariantNumeric="tabular-nums"
                    bg={{ base: 'bg.subtle', _dark: 'bg.emphasized' }}
                  />
                </NumberInput.Root>
              ) : (
                <Text
                  ml="auto"
                  flex="none"
                  bg={compact || !enabled || !support.available ? 'transparent' : 'bg'}
                  color={!support.available ? 'fg/70' : 'inherit'}
                  fontFamily="mono"
                  fontSize={compact && enabled ? 'sm' : enabled ? 'sm' : 'xs'}
                  textAlign="right"
                >
                  {!support.available
                    ? support.status
                    : enabled
                      ? formatValue(control.key, value)
                      : 'Not overridden'}
                </Text>
              )}
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
          <Tooltip
            key={control.key}
            content={support.reason}
            positioning={{ placement: 'top-start' }}
          >
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
        const showValueBadge = support.available && value !== undefined
        const valueElement = (
          <Box
            as="dd"
            w={showValueBadge ? '60px' : 'auto'}
            px={showValueBadge ? '10px' : '0'}
            rounded="md"
            bg={showValueBadge ? 'bg.muted' : 'transparent'}
            fontFamily="mono"
            fontSize={showValueBadge ? 'md' : 'xs'}
            lineHeight="short"
            textAlign={showValueBadge ? 'center' : 'right'}
            whiteSpace="nowrap"
            tabIndex={support.available ? undefined : 0}
            _dark={{
              bg: showValueBadge ? 'bg.emphasized' : 'transparent'
            }}
          >
            {!support.available
              ? support.status
              : value === undefined
                ? 'Not overridden'
                : formatValue(control.key, value)}
          </Box>
        )
        return (
          <Flex data-part="color-summary-item" align="center" gap={3} key={control.key}>
            <Text
              as="dt"
              flex="1"
              overflow="hidden"
              color={!support.available || value === undefined ? 'fg.muted' : 'fg'}
              fontSize="md"
              fontWeight="500"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {control.label}
            </Text>
            {support.available ? (
              valueElement
            ) : (
              <Tooltip content={support.reason}>{valueElement}</Tooltip>
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
import { Box, Flex, Grid, NumberInput, Stack, Text } from '@chakra-ui/react'
