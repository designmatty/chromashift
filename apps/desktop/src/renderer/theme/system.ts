import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const config = defineConfig({
  cssVarsPrefix: 'chromashift',
  globalCss: {
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
      minHeight: '100%'
    },
    'html:has([data-part="mini-panel"]), body:has([data-part="mini-panel"])': {
      overflow: 'hidden',
      bg: 'transparent'
    },
    body: {
      margin: 0,
      overflow: 'hidden',
      bg: 'bg',
      color: 'fg',
      fontFamily: 'body',
      fontSize: '14px'
    },
    'button, input, select': {
      font: 'inherit'
    },
    svg: {
      width: '20px',
      height: '20px',
      strokeWidth: '2'
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
        // Exact surface palette from the approved Figma light and dark frames.
        // Both conditions are explicit so these values replace Chakra's built-in
        // bg/fg/border semantic tokens in either color mode.
        bg: {
          DEFAULT: { value: { _light: '#ebf1f7', _dark: '#111114' } },
          subtle: { value: { _light: '#f9fafb', _dark: '#141418' } },
          muted: { value: { _light: '#f3f4f6', _dark: '#111114' } },
          panel: { value: { _light: '#ffffff', _dark: '#1c1c21' } },
          emphasized: { value: { _light: '#f3f4f6', _dark: '#2b2b33' } },
          settingsRow: { value: { _light: '#ebf1f7', _dark: '#111114' } },
          select: { value: { _light: '#ffffff', _dark: '#0f0f12' } },
          frame: {
            value: {
              _light: 'rgba(235, 241, 247, 0.8)',
              _dark: 'rgba(17, 17, 20, 0.8)'
            }
          }
        },
        fg: {
          DEFAULT: { value: { _light: '#111827', _dark: '#ffffff' } },
          muted: { value: { _light: '#40444d', _dark: '#9090a5' } },
          subtle: { value: { _light: '#666666', _dark: '#9090a5' } }
        },
        border: {
          DEFAULT: { value: { _light: '#e5e7eb', _dark: '#2b2b33' } },
          subtle: { value: { _light: '#f3f4f6', _dark: '#111114' } },
          emphasized: { value: { _light: '#111827', _dark: '#565666' } }
        },
        control: {
          active: { value: { _light: '#f3f4f6', _dark: '#565666' } }
        },
        badge: {
          primaryBg: { value: { _light: '#dbeafe', _dark: '#2d4b80' } },
          primaryFg: { value: { _light: '#1e3a8a', _dark: '#ffffff' } }
        },
        checkbox: {
          bg: { value: { _light: '#ffffff', _dark: '#111114' } },
          checkedBg: { value: { _light: '#111827', _dark: '#ffffff' } },
          checkedFg: { value: { _light: '#ffffff', _dark: '#111114' } }
        },
        slider: {
          fill: { value: { _light: '#111827', _dark: '#565666' } },
          track: { value: { _light: '#e5e7eb', _dark: '#111114' } },
          compactTrack: { value: { _light: '#edeef1', _dark: '#111114' } },
          thumb: { value: { _light: '#ffffff', _dark: '#ffffff' } },
          thumbBorder: { value: { _light: '#111827', _dark: 'transparent' } }
        },
        status: {
          errorBg: {
            value: {
              _light: 'color-mix(in oklch, var(--chromashift-colors-fg-error) 16%, #ebf1f7)',
              _dark: 'color-mix(in oklch, var(--chromashift-colors-fg-error) 16%, #111114)'
            }
          }
        },
        override: {
          bg: { value: '#ffffff' },
          fg: { value: '#111114' },
          actionBg: { value: '#111114' },
          actionFg: { value: '#ffffff' }
        },
        accent: {
          active: { value: '#ff8a1f' }
        }
      }
    }
  }
})

export const system = createSystem(defaultConfig, config)
