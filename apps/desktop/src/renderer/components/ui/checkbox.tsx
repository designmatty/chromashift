import { Checkbox as ChakraCheckbox } from '@chakra-ui/react'
import type { ReactNode } from 'react'

interface CheckboxProps {
  checked?: boolean
  children?: ReactNode
  disabled?: boolean
  'aria-label'?: string
  onCheckedChange?(checked: boolean): void
}

export function Checkbox({
  checked = false,
  children,
  disabled = false,
  onCheckedChange,
  ...props
}: CheckboxProps): React.JSX.Element {
  return (
    <ChakraCheckbox.Root
      checked={checked}
      disabled={disabled}
      size="lg"
      flex={children === undefined ? 'none' : '1'}
      gap={2}
      opacity="1"
      onCheckedChange={(details) => onCheckedChange?.(details.checked === true)}
      {...props}
    >
      <ChakraCheckbox.HiddenInput />
      <ChakraCheckbox.Control data-slot="checkbox" boxSize="5" rounded="sm">
        <ChakraCheckbox.Indicator />
      </ChakraCheckbox.Control>
      {children !== undefined && (
        <ChakraCheckbox.Label
          flex="1"
          overflow="hidden"
          color={checked ? 'fg' : 'fg.muted'}
          fontWeight="500"
        >
          {children}
        </ChakraCheckbox.Label>
      )}
    </ChakraCheckbox.Root>
  )
}
