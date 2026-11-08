import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createNeutralColorSettings } from '@chromashift/core'
import { describe, expect, it } from 'vitest'
import type { DisplayCapabilityReport } from '@chromashift/native-client/protocol'
import type { ProductState } from '@shared/product-api'
import { system } from '@/theme/system'
import { ColorControls } from '@/features/profiles/color-controls'

describe('color controls in both panels', () => {
  for (const compact of [false, true]) {
    it(`explains HDR, preserves target values and disables all inputs, compact=${compact}`, () => {
      const display = { id: 'display:test', name: 'Test display', hdr: true }
      // Even a stale SDR capability report must not enable vendor controls in HDR.
      const supported = { supported: true, provider: 'nvidia' }
      const product = {
        displays: [display],
        capabilityReports: {
          [display.id]: {
            capabilities: {
              brightness: supported,
              contrast: supported,
              gamma: supported,
              saturation: supported,
              hue: supported,
              colorTemperature: supported
            }
          }
        },
        chromaShift: { status: 'active' }
      } as unknown as ProductState
      const render = () =>
        renderToStaticMarkup(
          <ChakraProvider value={system}>
            <ColorControls
              displayId={display.id}
              product={product}
              color={{ ...createNeutralColorSettings(), brightness: 30, saturation: 85 }}
              editable
              onChange={() => undefined}
              compact={compact}
            />
          </ChakraProvider>
        )
      const hdr = render()
      expect(hdr).toContain('HDR is on')
      expect(hdr).toContain('Values below apply when HDR is off.')
      expect(hdr).toContain('30%')
      expect(hdr).toContain('85%')
      const sliders = [...hdr.matchAll(/<div\b[^>]*data-slot="slider"[^>]*>/g)]
      expect(sliders).toHaveLength(6)
      expect(sliders.every(([input]) => input.includes('data-disabled=""'))).toBe(true)
      product.chromaShift.status = 'safetyBlocked'
      expect(render()).toContain('Restoration needs confirmation.')
      expect(render()).not.toContain('This display stays at its original settings.')
      display.hdr = false
      expect(render()).not.toContain('HDR is on')
    })

    it(`shows and disables non-neutral unsupported temperature with a neutral action, compact=${compact}`, () => {
      const display = { id: 'display:test', name: 'Test display', hdr: false }
      const report = {
        displayId: display.id,
        capabilities: { colorTemperature: { supported: false, provider: 'unknown' } }
      } as DisplayCapabilityReport
      const product = {
        displays: [display],
        capabilityReports: { [display.id]: report }
      } as ProductState
      const render = (temperature: number): string =>
        renderToStaticMarkup(
          <ChakraProvider value={system}>
            <ColorControls
              displayId={display.id}
              product={product}
              color={{ ...createNeutralColorSettings(), colorTemperature: temperature }}
              editable
              onChange={() => undefined}
              compact={compact}
            />
          </ChakraProvider>
        )
      expect(render(50)).not.toContain('data-control="colorTemperature"')
      const html = render(63)
      const temperature = html.slice(html.indexOf('data-control="colorTemperature"'))
      expect(temperature).toContain('Reset to neutral')
      expect(temperature).toContain('63%')
      expect(temperature).toContain('disabled=""')
      const values = [...html.matchAll(/<([a-z]+)\b[^>]*data-part="color-value"[^>]*>/g)]
      expect(values).toHaveLength(6)
      expect(values.every((match) => match[1] === (compact ? 'p' : 'button'))).toBe(true)
      expect(html.match(/data-part="slider-neutral"/g)).toHaveLength(6)
      report.capabilities.colorTemperature = { supported: true, provider: 'amd' }
      expect(render(50)).toContain('data-control="colorTemperature"')
    })
  }
})
