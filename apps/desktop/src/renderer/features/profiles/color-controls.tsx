import { Box, Flex, IconButton, Stack, Text } from '@chakra-ui/react'
import { Palette, Thermometer } from 'lucide-react'
import {
  clampGammaForBrightness,
  createNeutralColorSettings,
  gammaRangeForBrightness,
  type ColorSettings,
  type CompleteColorSettings
} from '@chromashift/core'
import type { Display, DisplayCapabilityReport } from '@chromashift/native-client/protocol'
import { Slider } from '@/components/ui/slider'
import { Tooltip } from '@/components/ui/tooltip'
import type { ProductState } from '@shared/product-api.js'

import { ControlValue } from '@/features/profiles/control-value'
import {
  formatValue,
  showColorTemperature,
  type ColorControlKey
} from '@/features/profiles/control-values'

function ControlIcon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

const controls: Array<{
  key: ColorControlKey
  label: string
  min: number
  max: number
  step: number
  neutral: number
  icon: React.ReactNode
}> = [
  {
    key: 'brightness',
    label: 'Brightness',
    min: 0,
    max: 100,
    step: 1,
    neutral: 50,
    icon: (
      <ControlIcon>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
      </ControlIcon>
    )
  },
  {
    key: 'contrast',
    label: 'Contrast',
    min: 0,
    max: 100,
    step: 1,
    neutral: 50,
    icon: (
      <ControlIcon>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 18a6 6 0 0 0 0-12v12z" />
      </ControlIcon>
    )
  },
  {
    key: 'gamma',
    label: 'Gamma',
    min: 0.3,
    max: 2.8,
    step: 0.05,
    neutral: 1,
    icon: (
      <ControlIcon>
        <path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0" />
      </ControlIcon>
    )
  },
  {
    key: 'saturation',
    label: 'Saturation',
    min: 0,
    max: 100,
    step: 1,
    neutral: 50,
    icon: (
      <ControlIcon>
        <path d="M12 2S6 9 6 14a6 6 0 0 0 12 0c0-5-6-12-6-12Z" />
      </ControlIcon>
    )
  },
  {
    key: 'hue',
    label: 'Hue',
    min: 0,
    max: 100,
    step: 1,
    neutral: 0,
    icon: <Palette size={18} />
  },
  {
    key: 'colorTemperature',
    label: 'Color temperature',
    min: 0,
    max: 100,
    step: 1,
    neutral: 50,
    icon: <Thermometer size={18} />
  }
]

export interface ControlSupport {
  available: boolean
  status: string
  reason: string
}

export function controlSupport(
  key: ColorControlKey,
  display: Display | undefined,
  report: DisplayCapabilityReport | undefined
): ControlSupport {
  if (display === undefined) {
    return {
      available: false,
      status: 'disconnected',
      reason: 'This display is not connected.'
    }
  }

  if (display.hdr) {
    return {
      available: false,
      status: 'unavailable',
      reason: 'HDR is on. These values apply when HDR is turned off.'
    }
  }

  const capability = report?.capabilities[key]
  if (capability === undefined || !capability.supported) {
    return {
      available: false,
      status: 'unavailable',
      reason: capability?.reason ?? 'Unsupported by the active provider.'
    }
  }

  return { available: true, status: '', reason: '' }
}

export function ColorControls({
  displayId,
  color,
  product,
  editable,
  onChange,
  compact = false
}: {
  displayId: string
  color: ColorSettings
  product: ProductState
  editable: boolean
  onChange(color: CompleteColorSettings): void
  compact?: boolean
}): React.JSX.Element {
  const display = product.displays.find((item) => item.id === displayId)
  const report = product.capabilityReports[displayId]
  const completeColor: CompleteColorSettings = { ...createNeutralColorSettings(), ...color }

  function change(key: ColorControlKey, nextValue: number): void {
    const next = { ...completeColor, [key]: nextValue }
    if (key === 'brightness') {
      next.gamma = clampGammaForBrightness(next.gamma, next.brightness)
    }
    onChange(next)
  }

  return (
    <Stack gap={compact ? 4 : 3}>
      {display?.hdr && (
        <Text role="status" fontSize="xs" color="fg.muted">
          {product.chromaShift?.status === 'safetyBlocked'
            ? "HDR is on and isn't supported yet. Restoration needs confirmation. Use Retry to restore original settings."
            : "HDR is on and isn't supported yet. This display stays at its original settings. Values below apply when HDR is off."}
        </Text>
      )}
      {controls
        .filter(
          (control) =>
            control.key !== 'colorTemperature' || showColorTemperature(completeColor, report)
        )
        .map((control) => {
          const support = controlSupport(control.key, display, report)
          const value = completeColor[control.key]
          const overridden = value !== control.neutral
          const gammaRange = gammaRangeForBrightness(completeColor.brightness)
          const allowedMin = control.key === 'gamma' ? gammaRange.min : control.min
          const allowedMax = control.key === 'gamma' ? gammaRange.max : control.max
          const row = (
            <Box
              data-part="color-control"
              data-control={control.key}
              display="flex"
              alignItems="center"
              gap={2}
              flexDirection={compact ? 'column' : 'row'}
              tabIndex={support.available ? undefined : 0}
            >
              <Flex
                h={compact ? '21px' : undefined}
                align="center"
                gap={2}
                width={compact ? '100%' : '280px'}
                flexShrink={0}
              >
                <Box aria-hidden="true" color={support.available ? 'fg.muted' : 'fg/70'}>
                  {control.icon}
                </Box>
                <Text
                  flex="none"
                  whiteSpace="nowrap"
                  color={support.available ? 'inherit' : 'fg/70'}
                >
                  {control.label}
                </Text>
                <Box flex="1" minW="0" display="flex" alignItems="center">
                  {editable && overridden && (
                    <Tooltip content="Reset to neutral">
                      <IconButton
                        size="2xs"
                        variant="ghost"
                        aria-label="Reset to neutral"
                        onClick={() => change(control.key, control.neutral)}
                      >
                        <Text aria-hidden="true" fontSize="lg" lineHeight="1">
                          ↺
                        </Text>
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
                <ControlValue
                  pointerOnly={compact}
                  control={control.key}
                  value={value}
                  min={allowedMin}
                  max={allowedMax}
                  step={control.step}
                  disabled={!editable || !support.available}
                  label={`${control.label} value for ${display?.name ?? displayId}`}
                  onChange={(next) => change(control.key, next)}
                />
              </Flex>
              <Slider
                value={[value]}
                min={control.min}
                max={control.max}
                allowedMin={allowedMin}
                allowedMax={allowedMax}
                step={control.step}
                neutral={control.neutral}
                track={
                  control.key === 'hue'
                    ? 'hue'
                    : control.key === 'saturation'
                      ? 'saturation'
                      : undefined
                }
                limitLabel={
                  control.key === 'gamma'
                    ? `Min ${allowedMin.toFixed(2)}, max ${allowedMax.toFixed(2)} at brightness ${completeColor.brightness}%`
                    : undefined
                }
                disabled={!editable || !support.available}
                aria-label={`${control.label} for ${display?.name ?? displayId}`}
                aria-valuetext={formatValue(control.key, value)}
                onValueChange={(values) => {
                  const next = values[0]
                  if (next !== undefined) change(control.key, next)
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
