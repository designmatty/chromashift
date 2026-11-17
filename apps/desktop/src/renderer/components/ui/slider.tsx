import { Box, Slider as ChakraSlider } from '@chakra-ui/react'
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
  // The allowed range is shown by the hatched track ends; the gamma limit text
  // lives only on the shield beside the gamma label (#89 owner decision).
  function change(values: number[]): void {
    props.onValueChange(
      values.map((value) => Number(Math.min(allowedMax, Math.max(allowedMin, value)).toFixed(2)))
    )
  }
  const ref = useWheelAdjustment<HTMLDivElement>(!props.disabled, (direction) =>
    change(props.value.map((value) => value + direction * props.step))
  )
  const disabledStyle = {
    bgColor: 'bg.muted',
    backgroundImage:
      'repeating-linear-gradient(135deg, transparent 0px, transparent 5px, {colors.border.emphasized} 5px, {colors.border.emphasized} 6px)'
  }
  return (
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
          opacity: 0.7,
          // Drop the hue and saturation track colors; neutral tracks are unaffected.
          filter: 'grayscale(1)'
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
                ? 'linear-gradient(to right, {colors.red.solid}, {colors.yellow.solid}, {colors.green.solid}, {colors.cyan.solid}, {colors.blue.solid}, {colors.purple.solid}, {colors.red.solid})'
                : props.track === 'saturation'
                  ? {
                      base: 'linear-gradient(to right, {colors.fg.muted}, {colors.orange.solid})',
                      _dark: 'linear-gradient(to right, {colors.fg.muted}, {colors.pink.500})'
                    }
                  : undefined
            }
          >
            <ChakraSlider.Range
              bg={
                props.track === undefined
                  ? { base: 'bg.inverted', _dark: 'colorPalette.600' }
                  : 'transparent'
              }
              // A lit top edge on the plain fill. Hue and saturation keep their
              // gradients untouched.
              shadow={
                props.track === undefined ? 'inset 0 1px 0 0 {colors.whiteAlpha.300}' : undefined
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
              // A two-tone line centered where the contained 16px thumb sits at
              // the neutral value. The fg core with a bg halo keeps contrast on
              // the fill, the empty track, hatching, and the hue gradient.
              <Box
                data-part="slider-neutral"
                aria-hidden="true"
                position="absolute"
                top="0"
                bottom="0"
                left={`calc(8px + (100% - 16px) * ${span === 0 ? 0 : (props.neutral - props.min) / span})`}
                transform="translateX(-50%)"
                width="2px"
                bg="fg"
                boxShadow="0 0 0 1px {colors.bg}"
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
            // Chakra's focus-visible ring replaces this shadow while focused.
            shadow="raised"
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
  )
}
