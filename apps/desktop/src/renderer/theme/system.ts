import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const config = defineConfig({
  cssVarsPrefix: 'chromashift',
  globalCss: {
    '*::-webkit-scrollbar-track': {
      background: '{colors.gray.solid/20}',
      borderRadius: 'full'
    },
    '*::-webkit-scrollbar-thumb': {
      background: '{colors.gray.solid/30}',
      borderRadius: 'full',
      '&:hover': {
        background: '{colors.gray.solid/50}'
      }
    },
    '*::-webkit-scrollbar': {
      width: '0.25rem'
    },
    '*& ::-webkit-scrollbar-button': {
      display: 'none',
      width: 0,
      height: 0
    },

    'html *, html *::before, html *::after': {
      boxSizing: 'border-box',
      '@media (prefers-reduced-motion: reduce)': {
        animationDuration: '0.01ms !important',
        transition: 'none !important'
      }
    },
    'html, body, #root': {
      width: '100%',
      height: '100%',
      minHeight: '100%',
      bg: 'transparent',
      overflow: 'hidden'
    },
    body: {
      margin: 0,
      fontSize: '14px',
      userSelect: 'none'
    },
    'button, input, select': {
      font: 'inherit'
    },
    'button:not(:disabled), [role="button"]:not([aria-disabled="true"])': {
      cursor: 'pointer'
    }
  },
  theme: {
    tokens: {
      fonts: {
        body: { value: "'Geist Variable', 'Segoe UI Variable', sans-serif" },
        heading: { value: "'Geist Variable', 'Segoe UI Variable', sans-serif" },
        mono: { value: "'Geist Mono Variable', ui-monospace, 'Cascadia Mono', monospace" }
      },
      colors: {}
    },
    semanticTokens: {
      colors: {
        gray: {
          50: { value: '#F1F1F3' },
          100: { value: '#E3E3E8' },
          200: { value: '#C8C8D0' },
          300: { value: '#AFAFBB' },
          400: { value: '#9393A4' },
          500: { value: '#78788C' },
          600: { value: '#606071' },
          700: { value: '#4B4B58' },
          800: { value: '#34343D' },
          900: { value: '#1C1C21' },
          950: { value: '#111114' }
        }
      }
    }
  }
})

export const system = createSystem(defaultConfig, config)
