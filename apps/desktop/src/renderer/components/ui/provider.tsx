import { ChakraProvider } from '@chakra-ui/react'
import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'
import { system } from '@/theme/system'

export function Provider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ChakraProvider value={system}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        disableTransitionOnChange
        enableSystem
        storageKey="chromashift-color-mode"
      >
        {children}
      </ThemeProvider>
    </ChakraProvider>
  )
}
