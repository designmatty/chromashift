import { Checkbox as ChakraCheckbox } from '@chakra-ui/react'
import type { ReactNode } from 'react'

interface CheckboxProps {
  checked?: boolean
  children?: ReactNode
  className?: string
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
      colorPalette="brand"
      disabled={disabled}
      size="sm"
      onCheckedChange={(details) => onCheckedChange?.(details.checked === true)}
      {...props}
    >
      <ChakraCheckbox.HiddenInput />
      <ChakraCheckbox.Control
        data-checked={checked ? '' : undefined}
        data-slot="checkbox"
        data-unchecked={checked ? undefined : ''}
      >
        <ChakraCheckbox.Indicator />
      </ChakraCheckbox.Control>
      {children !== undefined && <ChakraCheckbox.Label>{children}</ChakraCheckbox.Label>}
    </ChakraCheckbox.Root>
  )
}
