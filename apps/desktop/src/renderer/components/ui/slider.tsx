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
      thumbAlignment="center"
      value={props.value}
      w="full"
      opacity={props.disabled ? '0.7' : '1'}
      aria-label={props['aria-label'] === undefined ? undefined : [props['aria-label']]}
      onValueChange={(details) => props.onValueChange(details.value)}
    >
      <ChakraSlider.Control>
        <ChakraSlider.Track
          h="25px"
          overflow="hidden"
          rounded="4px"
          bg={props.compact ? 'slider.compactTrack' : 'slider.track'}
        >
          <ChakraSlider.Range h="25px" bg="slider.fill" />
        </ChakraSlider.Track>
        <ChakraSlider.Thumb
          index={0}
          w="16px"
          h="25px"
          borderWidth="1px"
          borderColor="slider.thumbBorder"
          rounded="4px"
          bg="slider.thumb"
          boxShadow="none"
        >
          <ChakraSlider.HiddenInput />
        </ChakraSlider.Thumb>
      </ChakraSlider.Control>
    </ChakraSlider.Root>
  )
}
