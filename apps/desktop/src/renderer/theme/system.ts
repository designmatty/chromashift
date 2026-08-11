import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const config = defineConfig({
  cssVarsPrefix: 'chromashift',
  globalCss: {
    '*': {
      boxSizing: 'border-box'
    },
    'html, body, #root': {
      minHeight: '100%'
    },
    body: {
      margin: 0,
      overflowX: 'hidden',
      bg: 'bg',
      color: 'fg',
      fontFamily: 'body',
      fontSize: '12px'
    },
    'button:not(:disabled), [role="button"]:not([aria-disabled="true"])': {
      cursor: 'pointer'
    }
  },
  theme: {
    tokens: {
      fonts: {
        body: { value: "'Inter Variable', 'Segoe UI Variable', sans-serif" },
        heading: { value: "'Inter Variable', 'Segoe UI Variable', sans-serif" }
      },
      colors: {
        brand: {
          50: { value: '#fff1f7' },
          100: { value: '#ffe4f0' },
          200: { value: '#fecddf' },
          300: { value: '#fda4c7' },
          400: { value: '#fb6fa8' },
          500: { value: '#ec478f' },
          600: { value: '#d62f79' },
          700: { value: '#b82064' },
          800: { value: '#991d54' },
          900: { value: '#801c49' },
          950: { value: '#4e0928' }
        }
      }
    },
    semanticTokens: {
      colors: {
        brand: {
          solid: { value: { _light: '{colors.brand.600}', _dark: '{colors.brand.500}' } },
          contrast: { value: 'white' },
          fg: { value: { _light: '{colors.brand.700}', _dark: '{colors.brand.300}' } },
          muted: { value: { _light: '{colors.brand.50}', _dark: '{colors.brand.950}' } },
          subtle: { value: { _light: '{colors.brand.100}', _dark: '{colors.brand.900}' } },
          emphasized: { value: { _light: '{colors.brand.200}', _dark: '{colors.brand.800}' } },
          focusRing: { value: { _light: '{colors.brand.500}', _dark: '{colors.brand.400}' } }
        }
      }
    }
  }
})

export const system = createSystem(defaultConfig, config)
