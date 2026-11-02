import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
import { ErrorBoundary } from '@/app/error-boundary'
import { Root } from '@/app/root'
import { Provider } from '@/components/ui/provider'
import { applyColorScheme, initialColorScheme } from '@/lib/color-scheme'

const root = document.getElementById('root')
if (root === null) throw new Error('Renderer root element is missing')

// Theme the loading screens before product state (and useProductTheme) is available.
const colorScheme = initialColorScheme(location.search)
if (colorScheme !== null) applyColorScheme(document.documentElement, colorScheme)

createRoot(root).render(
  <StrictMode>
    <Provider>
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </Provider>
  </StrictMode>
)
