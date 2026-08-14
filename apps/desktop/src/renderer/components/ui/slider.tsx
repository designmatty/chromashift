import { Slider as ChakraSlider } from '@chakra-ui/react'

interface SliderProps {
  value: number[]
  min: number
  max: number
  step: number
  disabled?: boolean
  compact?: boolean
  'aria-label'?: string
  onValueChange(values: number[]): void
}

export function Slider(props: SliderProps): React.JSX.Element {
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
      onValueChange={(details) => props.onValueChange(details.value)}
    >
      <ChakraSlider.Control>
        <ChakraSlider.Track
          h="20px"
          overflow="hidden"
          rounded="sm"
          bg={{ base: 'bg.muted', _dark: 'bg' }}
        >
          <ChakraSlider.Range bg={{ base: 'bg.inverted', _dark: 'colorPalette.600' }} />
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
          <ChakraSlider.HiddenInput />
        </ChakraSlider.Thumb>
      </ChakraSlider.Control>
    </ChakraSlider.Root>
  )
}
