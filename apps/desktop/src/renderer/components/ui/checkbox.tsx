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
      size="sm"
      minW="0"
      flex={children === undefined ? 'none' : '1'}
      gap="10px"
      opacity="1"
      onCheckedChange={(details) => onCheckedChange?.(details.checked === true)}
      {...props}
    >
      <ChakraCheckbox.HiddenInput />
      <ChakraCheckbox.Control
        data-slot="checkbox"
        boxSize="20px"
        borderWidth="1px"
        borderColor={checked ? 'checkbox.checkedBg' : 'border'}
        rounded="4px"
        bg={checked ? 'checkbox.checkedBg' : 'checkbox.bg'}
        color={checked ? 'checkbox.checkedFg' : 'checkbox.bg'}
        outline="none"
        boxShadow="none"
        _focusVisible={{ outline: 'none', boxShadow: 'none' }}
      >
        <ChakraCheckbox.Indicator />
      </ChakraCheckbox.Control>
      {children !== undefined && (
        <ChakraCheckbox.Label minW="0" opacity="1">
          {children}
        </ChakraCheckbox.Label>
      )}
    </ChakraCheckbox.Root>
  )
}
