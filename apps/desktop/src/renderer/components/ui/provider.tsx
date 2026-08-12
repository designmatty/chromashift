import { ChakraProvider } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { system } from '@/theme/system'

export function Provider({ children }: { children: ReactNode }): React.JSX.Element {
  return <ChakraProvider value={system}>{children}</ChakraProvider>
}
