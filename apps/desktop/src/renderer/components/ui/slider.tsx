import { Box, Slider as ChakraSlider } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '@/components/ui/tooltip'
import { useWheelAdjustment } from '@/hooks/use-wheel-adjustment'

interface SliderProps {
  value: number[]
  min: number
  max: number
  allowedMin?: number
  allowedMax?: number
  step: number
  disabled?: boolean
  neutral?: number
  track?: 'hue' | 'saturation'
  limitLabel?: string
  'aria-label'?: string
  'aria-valuetext'?: string
  onValueChange(values: number[]): void
}

export function Slider(props: SliderProps): React.JSX.Element {
  const allowedMin = props.allowedMin ?? props.min
  const allowedMax = props.allowedMax ?? props.max
  const span = props.max - props.min
  const lowerDisabled = span === 0 ? 0 : ((allowedMin - props.min) / span) * 100
  const upperDisabled = span === 0 ? 0 : ((props.max - allowedMax) / span) * 100
  const [limitOpen, setLimitOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  function change(values: number[]): void {
    if (
      values.some(
        (value) =>
          (lowerDisabled > 0 && value <= allowedMin) || (upperDisabled > 0 && value >= allowedMax)
      )
    ) {
      setLimitOpen(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setLimitOpen(false), 1800)
    }
    props.onValueChange(
      values.map((value) => Number(Math.min(allowedMax, Math.max(allowedMin, value)).toFixed(2)))
    )
  }
  const ref = useWheelAdjustment<HTMLDivElement>(!props.disabled, (direction) =>
    change(props.value.map((value) => value + direction * props.step))
  )
  const disabledStyle = {
    bgColor: 'bg.emphasized',
    backgroundImage:
      'repeating-linear-gradient(135deg, transparent 0px, transparent 3px, {colors.fg.muted} 3px, {colors.fg.muted} 4px)'
  }
  return (
    <Tooltip
      content={props.limitLabel}
      disabled={props.limitLabel === undefined}
      open={limitOpen}
      onOpenChange={({ open }) => setLimitOpen(open)}
    >
      <Box ref={ref} w="full" minW="0">
        <ChakraSlider.Root
          data-slot="slider"
          disabled={props.disabled}
          max={props.max}
          min={props.min}
          step={props.step}
          thumbAlignment="contain"
          value={props.value}
          w="full"
          _disabled={{
            opacity: 0.7
          }}
          aria-label={props['aria-label'] === undefined ? undefined : [props['aria-label']]}
          onValueChange={(details) => change(details.value)}
        >
          <ChakraSlider.Control>
            <ChakraSlider.Track
              h="20px"
              overflow="hidden"
              rounded="sm"
              bgColor={{ base: 'bg.muted', _dark: 'bg' }}
              backgroundImage={
                props.track === 'hue'
                  ? 'linear-gradient(to right, {colors.control.red}, {colors.control.yellow}, {colors.control.green}, {colors.control.cyan}, {colors.control.blue}, {colors.control.magenta}, {colors.control.red})'
                  : props.track === 'saturation'
                    ? 'linear-gradient(to right, {colors.fg.muted}, {colors.control.saturation})'
                    : undefined
              }
            >
              <ChakraSlider.Range
                bg={
                  props.track === undefined
                    ? { base: 'bg.inverted', _dark: 'colorPalette.600' }
                    : 'transparent'
                }
              />
              {lowerDisabled > 0 && (
                <Box
                  data-part="slider-disabled-lower"
                  position="absolute"
                  insetStart="0"
                  top="0"
                  width={`${lowerDisabled}%`}
                  height="full"
                  css={disabledStyle}
                  pointerEvents="none"
                />
              )}
              {upperDisabled > 0 && (
                <Box
                  data-part="slider-disabled-upper"
                  position="absolute"
                  insetEnd="0"
                  top="0"
                  width={`${upperDisabled}%`}
                  height="full"
                  css={disabledStyle}
                  pointerEvents="none"
                />
              )}
              {props.neutral !== undefined && (
                <Box
                  data-part="slider-neutral"
                  aria-hidden="true"
                  position="absolute"
                  top="0"
                  bottom="0"
                  left={`clamp(0px, ${((props.neutral - props.min) / span) * 100}%, calc(100% - 2px))`}
                  width="2px"
                  bg="fg"
                  opacity={0.7}
                  pointerEvents="none"
                />
              )}
            </ChakraSlider.Track>
            <ChakraSlider.Thumb
              index={0}
              aria-valuetext={props['aria-valuetext']}
              aria-valuemin={allowedMin}
              aria-valuemax={allowedMax}
              w="16px"
              h="26px"
              visibility={'visible !important'}
              borderColor={{ base: 'bg.inverted', _dark: 'transparent' }}
              rounded="sm"
              bg={{ base: 'bg', _dark: 'fg' }}
              _disabled={{
                borderColor: {
                  base: 'colorPalette.400',
                  _dark: 'transparent'
                }
              }}
            >
              <ChakraSlider.HiddenInput aria-valuemin={allowedMin} aria-valuemax={allowedMax} />
            </ChakraSlider.Thumb>
          </ChakraSlider.Control>
        </ChakraSlider.Root>
      </Box>
    </Tooltip>
  )
}
