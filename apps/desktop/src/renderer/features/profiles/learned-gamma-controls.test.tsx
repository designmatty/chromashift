import { ChakraProvider } from '@chakra-ui/react'
import { createNeutralColorSettings } from '@chromashift/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { system } from '@/theme/system'
import { ColorControls } from '@/features/profiles/color-controls'
import { usePreviewDraft } from '@/features/profiles/use-preview-draft'
import type { ProductState } from '@shared/product-api'

// SSR cannot open a portalled tooltip. Retain its passed explanation for the
// component contract; the display-free smoke checks real hover and themes.
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ content, children }: { content: React.ReactNode; children: React.ReactNode }) => (
    <span data-tooltip={typeof content === 'string' ? content : undefined}>{children}</span>
  )
}))

function state(): ProductState {
  const available = { supported: true, provider: 'windows' }
  return {
    displays: [{ id: 'display:one', name: 'One', hdr: false }],
    capabilityReports: {
      'display:one': {
        capabilities: Object.fromEntries(
          ['brightness', 'contrast', 'gamma', 'saturation', 'hue', 'colorTemperature'].map(
            (key) => [key, available]
          )
        )
      }
    },
    gammaLimits: {
      schemaVersion: 1,
      displays: {
        'display:one': {
          sdr: {
            baselineHash: 'original',
            brightness: { '50': { max: 1.85 } }
          }
        }
      }
    }
  } as unknown as ProductState
}

describe('learned gamma feedback', () => {
  for (const compact of [false, true]) {
    it(`uses native brightness 50 for unsupported brightness intent 37, compact=${compact}`, () => {
      const product = state()
      product.capabilityReports['display:one']!.capabilities.brightness = {
        supported: false,
        provider: 'unknown'
      }
      const color = { ...createNeutralColorSettings(), brightness: 37, gamma: 1.85 }
      const html = renderToStaticMarkup(
        <ChakraProvider value={system}>
          <ColorControls
            displayId="display:one"
            product={product}
            color={color}
            editable
            compact={compact}
            onChange={() => undefined}
          />
        </ChakraProvider>
      )
      expect(html).toContain('Limited to 1.85 on this display')
      expect(html).toContain('data-gamma-min="0.3" data-gamma-max="1.85"')
      expect(html).toContain('at brightness 50%')
      expect(color.brightness).toBe(37)
    })
  }
  for (const compact of [false, true])
    for (const theme of ['dark', 'light']) {
      it(`shows the limit, explanation and narrowed bounds in ${theme}, compact=${compact}`, () => {
        const product = state()
        const render = () =>
          renderToStaticMarkup(
            <ChakraProvider value={system}>
              <div className={theme}>
                <ColorControls
                  displayId="display:one"
                  product={product}
                  color={{ ...createNeutralColorSettings(), gamma: 1.85 }}
                  editable
                  compact={compact}
                  onChange={() => undefined}
                />
              </div>
            </ChakraProvider>
          )
        const html = render()
        expect(html).toContain('Limited to 1.85 on this display')
        expect(html).toContain('Windows rejected a stronger gamma curve on this display.')
        expect(html).toContain('data-gamma-min="0.3" data-gamma-max="1.85"')
        expect(html).toContain('data-part="slider-disabled-upper"')
        product.gammaLimits!.displays = {}
        expect(render()).not.toContain('gamma-limit-note')
        expect(render()).toContain('data-gamma-min="0.3" data-gamma-max="2.8"')
      })
    }

  it.each([true, false])(
    'rebases only gamma in a dirty renderer draft, brightness supported=%s',
    (brightnessSupported) => {
      const product = state()
      product.capabilityReports['display:one']!.capabilities.brightness = {
        supported: brightnessSupported,
        provider: 'windows'
      }
      const saved = {
        id: 'game',
        name: 'Saved',
        enabled: true,
        applications: [],
        displays: [
          { displayId: 'display:one', color: { ...createNeutralColorSettings(), gamma: 1.85 } }
        ]
      }
      const changed = {
        ...saved,
        name: 'Unsaved name',
        displays: [
          {
            displayId: 'display:one',
            color: {
              ...createNeutralColorSettings(),
              brightness: brightnessSupported ? 50 : 37,
              gamma: 2.5,
              hue: 45
            }
          }
        ]
      }
      function Draft(): React.JSX.Element {
        const state = usePreviewDraft({
          kind: 'edit',
          session: { state: 'inactive' },
          enabled: false,
          initialDraft: () => changed,
          initialDirty: () => true,
          savedProfile: saved,
          gammaLimits: product.gammaLimits,
          capabilityReports: product.capabilityReports,
          onError: () => undefined
        })
        return <div>{JSON.stringify({ draft: state.draft, dirty: state.dirty })}</div>
      }
      const html = renderToStaticMarkup(<Draft />)
      expect(html).toContain('Unsaved name')
      expect(html).toContain('&quot;gamma&quot;:1.85')
      expect(html).toContain('&quot;hue&quot;:45')
      expect(html).toContain(`&quot;brightness&quot;:${brightnessSupported ? 50 : 37}`)
      expect(html).toContain('&quot;dirty&quot;:true')
      expect(changed.displays[0]!.color.gamma).toBe(2.5)
    }
  )
})
