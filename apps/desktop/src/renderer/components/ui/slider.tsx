import { Box, Slider as ChakraSlider } from '@chakra-ui/react'

interface SliderProps {
  value: number[]
  min: number
  max: number
  allowedMin?: number
  allowedMax?: number
  step: number
  disabled?: boolean
  'aria-label'?: string
  onValueChange(values: number[]): void
}

export function Slider(props: SliderProps): React.JSX.Element {
  const allowedMin = props.allowedMin ?? props.min
  const allowedMax = props.allowedMax ?? props.max
  const span = props.max - props.min
  const lowerDisabled = span === 0 ? 0 : ((allowedMin - props.min) / span) * 100
  const upperDisabled = span === 0 ? 0 : ((props.max - allowedMax) / span) * 100
  return (
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
      onValueChange={(details) =>
        props.onValueChange(
          details.value.map((value) => Math.min(allowedMax, Math.max(allowedMin, value)))
        )
      }
    >
      <ChakraSlider.Control>
        <ChakraSlider.Track
          h="20px"
          overflow="hidden"
          rounded="sm"
          bg={{ base: 'bg.muted', _dark: 'bg' }}
        >
          <ChakraSlider.Range bg={{ base: 'bg.inverted', _dark: 'colorPalette.600' }} />
          {lowerDisabled > 0 && (
            <Box
              data-part="slider-disabled-lower"
              position="absolute"
              insetStart="0"
              top="0"
              width={`${lowerDisabled}%`}
              height="full"
              bg="fg.muted"
              opacity="0.55"
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
              bg="fg.muted"
              opacity="0.55"
              pointerEvents="none"
            />
          )}
        </ChakraSlider.Track>
        <ChakraSlider.Thumb
          index={0}
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
  )
}
