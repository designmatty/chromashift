import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '@/app/error-boundary'
import { Root } from '@/app/root'
import { Provider } from '@/components/ui/provider'
import './styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Renderer root element is missing')

createRoot(root).render(
  <StrictMode>
    <Provider>
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </Provider>
  </StrictMode>
)
