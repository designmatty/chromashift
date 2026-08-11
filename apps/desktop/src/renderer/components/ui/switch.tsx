import { Switch as ChakraSwitch } from '@chakra-ui/react'

interface SwitchProps {
  checked: boolean
  disabled?: boolean
  'aria-label'?: string
  onCheckedChange?(checked: boolean): void
}

export function Switch({
  checked,
  disabled,
  onCheckedChange,
  ...props
}: SwitchProps): React.JSX.Element {
  return (
    <ChakraSwitch.Root
      checked={checked}
      colorPalette="brand"
      disabled={disabled}
      size="sm"
      onCheckedChange={(details) => onCheckedChange?.(details.checked)}
      {...props}
    >
      <ChakraSwitch.HiddenInput />
      <ChakraSwitch.Control>
        <ChakraSwitch.Thumb />
      </ChakraSwitch.Control>
    </ChakraSwitch.Root>
  )
}
