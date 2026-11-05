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
