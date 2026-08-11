import { Portal, Tooltip as ChakraTooltip } from '@chakra-ui/react'
import type { ReactElement, ReactNode } from 'react'

export function Tooltip({
  children,
  label
}: {
  children: ReactElement
  label: ReactNode
}): React.JSX.Element {
  return (
    <ChakraTooltip.Root closeDelay={0} openDelay={350} positioning={{ placement: 'top' }}>
      <ChakraTooltip.Trigger asChild>{children}</ChakraTooltip.Trigger>
      <Portal>
        <ChakraTooltip.Positioner>
          <ChakraTooltip.Content>
            {label}
            <ChakraTooltip.Arrow />
          </ChakraTooltip.Content>
        </ChakraTooltip.Positioner>
      </Portal>
    </ChakraTooltip.Root>
  )
}
