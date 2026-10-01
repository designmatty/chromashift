import { Box, Flex, IconButton, NumberInput, Stack, Text } from '@chakra-ui/react'
import { Palette } from 'lucide-react'
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
import type { ProductState } from '../../../shared/product-api.js'

type VisibleColorKey = Exclude<keyof CompleteColorSettings, 'colorTemperature'>

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
  key: VisibleColorKey
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
  }
]

export interface ControlSupport {
  available: boolean
  status: string
  reason: string
}

export function controlSupport(
  key: VisibleColorKey,
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

  const capability = report?.capabilities[key]
  if (capability === undefined || !capability.supported) {
    return {
      available: false,
      status: 'unavailable',
      reason: capability?.reason ?? 'Unsupported by the active provider.'
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
      reason: 'Windows gamma controls are unsafe while HDR is active.'
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

  function change(key: VisibleColorKey, nextValue: number): void {
    const next = { ...completeColor, [key]: nextValue }
    if (key === 'brightness') {
      next.gamma = clampGammaForBrightness(next.gamma, next.brightness)
    }
    onChange(next)
  }

  return (
    <Stack gap={compact ? 4 : 3}>
      {controls.map((control) => {
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
            <Flex h={compact ? '21px' : undefined} align="center" gap={3} width="100%">
              <Box aria-hidden="true" color={support.available ? 'fg.muted' : 'fg/70'}>
                {control.icon}
              </Box>
              <Text color={support.available ? 'inherit' : 'fg/70'}>{control.label}</Text>
              {editable && overridden && (
                <Tooltip content={`Reset ${control.label.toLowerCase()} to neutral`}>
                  <IconButton
                    size="2xs"
                    variant="ghost"
                    aria-label={`Reset ${control.label.toLowerCase()} to neutral`}
                    onClick={() => change(control.key, control.neutral)}
                  >
                    <Text aria-hidden="true" fontSize="lg" lineHeight="1">
                      ↺
                    </Text>
                  </IconButton>
                </Tooltip>
              )}
              {!compact && support.available ? (
                <NumberInput.Root
                  ml="auto"
                  flex="none"
                  min={allowedMin}
                  max={allowedMax}
                  step={control.step}
                  value={String(value)}
                  allowOverflow={false}
                  disabled={!editable}
                  width="80px"
                  size="xs"
                  onValueChange={({ valueAsNumber }) => {
                    if (!Number.isFinite(valueAsNumber)) return
                    change(control.key, Math.min(allowedMax, Math.max(allowedMin, valueAsNumber)))
                  }}
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
                  color={!support.available ? 'fg/70' : 'inherit'}
                  fontFamily="mono"
                  fontSize={support.available ? 'sm' : 'xs'}
                  textAlign="right"
                >
                  {support.available ? formatValue(control.key, value) : support.status}
                </Text>
              )}
            </Flex>
            <Slider
              value={[value]}
              min={control.min}
              max={control.max}
              allowedMin={allowedMin}
              allowedMax={allowedMax}
              step={control.step}
              disabled={!editable || !support.available}
              aria-label={`${control.label} for ${display?.name ?? displayId}`}
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

function formatValue(key: VisibleColorKey, value: number): string {
  return key === 'gamma'
    ? value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    : `${Math.round(value)}%`
}
