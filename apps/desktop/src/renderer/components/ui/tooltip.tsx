import { Portal, Tooltip as ChakraTooltip } from '@chakra-ui/react'
import type { ReactElement, ReactNode } from 'react'

type TooltipIds = Partial<{
  trigger: string
  content: string
  arrow: string
  positioner: string
}>

export function Tooltip({
  children,
  ids,
  label
}: {
  children: ReactElement
  ids?: TooltipIds
  label: ReactNode
}): React.JSX.Element {
  return (
    <ChakraTooltip.Root
      closeDelay={0}
      ids={ids}
      openDelay={350}
      positioning={{ placement: 'top', gutter: 8 }}
    >
      <ChakraTooltip.Trigger asChild>{children}</ChakraTooltip.Trigger>
      <Portal>
        <ChakraTooltip.Positioner>
          <ChakraTooltip.Content
            px="8px"
            py="5px"
            rounded="6px"
            bg="fg"
            color="bg.panel"
            fontFamily="body"
            fontSize="12px"
            fontWeight="500"
            boxShadow="none"
          >
            {label}
            <ChakraTooltip.Arrow>
              <ChakraTooltip.ArrowTip />
            </ChakraTooltip.Arrow>
          </ChakraTooltip.Content>
        </ChakraTooltip.Positioner>
      </Portal>
    </ChakraTooltip.Root>
  )
}
