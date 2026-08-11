import { Slider as ChakraSlider } from '@chakra-ui/react'

interface SliderProps {
  value: number[]
  min: number
  max: number
  step: number
  disabled?: boolean
  onValueChange(values: number[]): void
}

export function Slider(props: SliderProps): React.JSX.Element {
  return (
    <ChakraSlider.Root
      colorPalette="brand"
      data-slot="slider"
      disabled={props.disabled}
      max={props.max}
      min={props.min}
      step={props.step}
      thumbAlignment="center"
      value={props.value}
      onValueChange={(details) => props.onValueChange(details.value)}
    >
      <ChakraSlider.Control>
        <ChakraSlider.Track data-slot="slider-track">
          <ChakraSlider.Range data-slot="slider-range" />
        </ChakraSlider.Track>
        <ChakraSlider.Thumb data-slot="slider-thumb" index={0}>
          <ChakraSlider.HiddenInput />
        </ChakraSlider.Thumb>
      </ChakraSlider.Control>
    </ChakraSlider.Root>
  )
}
