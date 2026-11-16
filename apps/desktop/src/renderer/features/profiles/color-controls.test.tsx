import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createNeutralColorSettings } from '@chromashift/core'
import { describe, expect, it } from 'vitest'
import type { DisplayCapabilityReport } from '@chromashift/native-client/protocol'
import type { ProductState } from '@shared/product-api'
import { system } from '@/theme/system'
import { ColorControls } from '@/features/profiles/color-controls'

type Capabilities = Record<
  'brightness' | 'contrast' | 'gamma' | 'saturation' | 'hue' | 'colorTemperature',
  { supported: boolean; provider: string; reason?: string }
>

const windows = { supported: true, provider: 'windows' }
const nvidia = { supported: true, provider: 'nvidia' }
const sdrOnly = {
  supported: false,
  provider: 'unknown',
  reason: 'Windows gamma ramps are SDR-only. This control applies when HDR is off.'
}
const noProvider = {
  supported: false,
  provider: 'unknown',
  reason: 'No verified provider is available.'
}
const amdUnderHdr = {
  supported: false,
  provider: 'unknown',
  reason: 'AMD display controls are disabled until ADLX behavior is verified under HDR.'
}

/** The disabled flag of each slider, keyed by its data-control row. */
function sliderStates(html: string): Record<string, boolean> {
  const states: Record<string, boolean> = {}
  for (const row of html.split('data-part="color-control"').slice(1)) {
    const control = /data-control="([a-zA-Z]+)"/.exec(row)?.[1]
    const slider = /<div\b[^>]*data-slot="slider"[^>]*>/.exec(row)?.[0]
    if (control !== undefined && slider !== undefined)
      states[control] = slider.includes('data-disabled=""')
  }
  return states
}

describe('color controls in both panels', () => {
  for (const compact of [false, true]) {
    const render = (
      hdr: boolean,
      capabilities: Capabilities,
      status: 'active' | 'safetyBlocked' = 'active'
    ) => {
      const display = { id: 'display:test', name: 'Test display', hdr }
      const product = {
        displays: [display],
        capabilityReports: { [display.id]: { capabilities } },
        chromaShift: { status }
      } as unknown as ProductState
      // Decode the apostrophe so the copy assertions match the visible text.
      return renderToStaticMarkup(
        <ChakraProvider value={system}>
          <ColorControls
            displayId={display.id}
            product={product}
            color={{ ...createNeutralColorSettings(), brightness: 30, saturation: 85, hue: 10 }}
            editable
            onChange={() => undefined}
            compact={compact}
          />
        </ChakraProvider>
      ).replaceAll('&#x27;', "'")
    }

    it(`enables NVIDIA saturation and hue under HDR and keeps the ramp controls for SDR, compact=${compact}`, () => {
      const html = render(true, {
        brightness: sdrOnly,
        contrast: sdrOnly,
        gamma: sdrOnly,
        saturation: nvidia,
        hue: nvidia,
        colorTemperature: noProvider
      })
      expect(html).toContain(
        'HDR is on. Saturation and hue apply now; brightness, contrast and gamma apply when HDR is off.'
      )
      expect(html).not.toContain("isn't supported yet")
      // Disabled controls keep their target values.
      expect(html).toContain('30%')
      expect(html).toContain('85%')
      expect(sliderStates(html)).toEqual({
        brightness: true,
        contrast: true,
        gamma: true,
        saturation: false,
        hue: false
      })
      expect(
        render(true, {
          brightness: sdrOnly,
          contrast: sdrOnly,
          gamma: sdrOnly,
          saturation: nvidia,
          hue: noProvider,
          colorTemperature: noProvider
        })
      ).toContain(
        'HDR is on. Saturation applies now; brightness, contrast and gamma apply when HDR is off.'
      )
      const blocked = render(
        true,
        {
          brightness: sdrOnly,
          contrast: sdrOnly,
          gamma: sdrOnly,
          saturation: nvidia,
          hue: nvidia,
          colorTemperature: noProvider
        },
        'safetyBlocked'
      )
      expect(blocked).toContain(
        'HDR is on. Restoration needs confirmation. Use Retry to restore original settings.'
      )
      expect(blocked).not.toContain('apply now')
    })

    it(`keeps the ramp controls disabled under HDR even with a stale SDR report, compact=${compact}`, () => {
      const html = render(true, {
        brightness: windows,
        contrast: windows,
        gamma: windows,
        saturation: nvidia,
        hue: nvidia,
        colorTemperature: noProvider
      })
      expect(sliderStates(html)).toMatchObject({ brightness: true, contrast: true, gamma: true })
    })

    it(`keeps today's notice and disables every control on an AMD display under HDR, compact=${compact}`, () => {
      const amd = {
        brightness: amdUnderHdr,
        contrast: amdUnderHdr,
        gamma: amdUnderHdr,
        saturation: amdUnderHdr,
        hue: amdUnderHdr,
        colorTemperature: amdUnderHdr
      }
      const html = render(true, amd)
      expect(html).toContain(
        "HDR is on and isn't supported yet. This display stays at its original settings. Values below apply when HDR is off."
      )
      expect(html).toContain('85%')
      const states = sliderStates(html)
      // Neutral color temperature stays hidden when unsupported.
      expect(Object.values(states)).toHaveLength(5)
      expect(Object.values(states).every(Boolean)).toBe(true)
      const blocked = render(true, amd, 'safetyBlocked')
      expect(blocked).toContain(
        "HDR is on and isn't supported yet. Restoration needs confirmation. Use Retry to restore original settings."
      )
      expect(blocked).not.toContain('This display stays at its original settings.')
    })

    it(`shows no HDR notice and enables supported controls in SDR, compact=${compact}`, () => {
      const html = render(false, {
        brightness: windows,
        contrast: windows,
        gamma: windows,
        saturation: nvidia,
        hue: nvidia,
        colorTemperature: noProvider
      })
      expect(html).not.toContain('HDR is on')
      expect(sliderStates(html)).toEqual({
        brightness: false,
        contrast: false,
        gamma: false,
        saturation: false,
        hue: false
      })
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
