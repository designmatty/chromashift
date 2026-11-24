import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createNeutralColorSettings } from '@chromashift/core'
import { describe, expect, it } from 'vitest'
import type { Display, DisplayCapabilityReport } from '@chromashift/native-client/protocol'
import type { ProductState } from '@shared/product-api'
import { system } from '@/theme/system'
import { ColorControls, controlSupport } from '@/features/profiles/color-controls'

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
const amd = { supported: true, provider: 'amd' }
const noNvidia = {
  supported: false,
  provider: 'unknown',
  reason: 'Display is not connected to an NVIDIA adapter.'
}

/** An Intel display under HDR: no HDR provider, so nothing applies. */
const intelHdr = {
  brightness: sdrOnly,
  contrast: sdrOnly,
  gamma: sdrOnly,
  saturation: noNvidia,
  hue: noNvidia,
  colorTemperature: noProvider
}

/** An AMD display under HDR: every ADLX control applies; gamma stays SDR-only (#122). */
const amdHdr = {
  brightness: amd,
  contrast: amd,
  gamma: sdrOnly,
  saturation: amd,
  hue: amd,
  colorTemperature: amd
}

/**
 * The HDR notice's text. It must be a warning Alert that keeps the polite
 * status role and appears once, above the color controls.
 */
function hdrAlert(html: string): string {
  const matches = [...html.matchAll(/<div\b[^>]*data-part="hdr-notice"[^>]*>/g)]
  expect(matches).toHaveLength(1)
  const root = matches[0]![0]
  expect(root).toContain('role="status"')
  expect(root).toContain('chakra-alert__root')
  // status="warning" resolves the alert's color palette to orange.
  const cssClass = /\b(css-[a-z0-9]+)/.exec(root)?.[1]
  const rules = html.match(new RegExp(`\\.${cssClass}\\{[^}]*\\}`, 'g')) ?? []
  expect(rules.join('')).toContain('orange')
  const start = matches[0]!.index
  expect(start).toBeLessThan(html.indexOf('data-part="color-control"'))
  const firstRow = html.lastIndexOf('<', html.indexOf('data-part="color-control"'))
  const notice = html.slice(start, firstRow)
  // The status icon comes before the title.
  expect(notice.indexOf('<svg')).toBeGreaterThan(-1)
  expect(notice.indexOf('<svg')).toBeLessThan(notice.indexOf('chakra-alert__title'))
  return notice
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
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

describe('control support under HDR', () => {
  const display = { id: 'display:test', name: 'Test display', hdr: true } as Display
  const reportFor = (capabilities: Capabilities) =>
    ({ displayId: display.id, capabilities }) as unknown as DisplayCapabilityReport

  it('disables the ramp controls with "Disabled while HDR is on."', () => {
    const report = reportFor({
      brightness: windows,
      contrast: windows,
      gamma: windows,
      saturation: nvidia,
      hue: nvidia,
      colorTemperature: noProvider
    })
    for (const key of ['brightness', 'contrast', 'gamma'] as const)
      expect(controlSupport(key, display, report)).toEqual({
        available: false,
        status: 'unavailable',
        reason: 'Disabled while HDR is on.'
      })
    expect(controlSupport('saturation', display, report).available).toBe(true)
    // A control that never applies on this display keeps its own reason.
    expect(controlSupport('colorTemperature', display, report).reason).toBe(
      'No verified provider is available.'
    )
  })

  it('uses the same reason for every control when nothing applies under HDR', () => {
    const report = reportFor(intelHdr)
    for (const key of ['saturation', 'hue', 'colorTemperature'] as const)
      expect(controlSupport(key, display, report).reason).toBe('Disabled while HDR is on.')
  })

  it('keeps AMD ADLX controls, including brightness and contrast, available and disables only gamma', () => {
    const report = reportFor(amdHdr)
    for (const key of ['brightness', 'contrast', 'saturation', 'hue', 'colorTemperature'] as const)
      expect(controlSupport(key, display, report).available).toBe(true)
    expect(controlSupport('gamma', display, report)).toEqual({
      available: false,
      status: 'unavailable',
      reason: 'Disabled while HDR is on.'
    })
  })

  it('withholds a stale Windows ramp report and a gamma report from any provider under HDR', () => {
    const report = reportFor({ ...amdHdr, brightness: windows, gamma: amd })
    expect(controlSupport('brightness', display, report).available).toBe(false)
    expect(controlSupport('gamma', display, report).available).toBe(false)
    expect(controlSupport('contrast', display, report).available).toBe(true)
  })
})

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

    it(`enables NVIDIA saturation and hue under HDR with a short warning, compact=${compact}`, () => {
      const nvidiaHdr = {
        brightness: sdrOnly,
        contrast: sdrOnly,
        gamma: sdrOnly,
        saturation: nvidia,
        hue: nvidia,
        colorTemperature: noProvider
      }
      const html = render(true, nvidiaHdr)
      expect(hdrAlert(html)).toBe(
        "ChromaShift isn't fully compatible with HDR. Some controls are disabled while HDR is on."
      )
      expect(html).not.toContain('apply now')
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
      expect(hdrAlert(render(true, { ...nvidiaHdr, hue: noProvider }))).toBe(
        "ChromaShift isn't fully compatible with HDR. Some controls are disabled while HDR is on."
      )
      expect(hdrAlert(render(true, nvidiaHdr, 'safetyBlocked'))).toBe(
        "ChromaShift isn't fully compatible with HDR. Restoration needs confirmation. Use Retry to restore original settings."
      )
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

    it(`warns that HDR is unsupported and disables every control on an Intel display, compact=${compact}`, () => {
      const html = render(true, intelHdr)
      expect(hdrAlert(html)).toBe(
        "ChromaShift doesn't support HDR on this display yet. It stays at its original settings while HDR is on."
      )
      expect(html).toContain('85%')
      const states = sliderStates(html)
      // Neutral color temperature stays hidden when unsupported.
      expect(Object.values(states)).toHaveLength(5)
      expect(Object.values(states).every(Boolean)).toBe(true)
      expect(hdrAlert(render(true, intelHdr, 'safetyBlocked'))).toBe(
        "ChromaShift doesn't support HDR on this display yet. Restoration needs confirmation. Use Retry to restore original settings."
      )
    })

    it(`disables only gamma on an AMD display under HDR, compact=${compact}`, () => {
      const html = render(true, amdHdr)
      expect(hdrAlert(html)).toBe(
        "ChromaShift isn't fully compatible with HDR. Some controls are disabled while HDR is on."
      )
      expect(sliderStates(html)).toMatchObject({
        brightness: false,
        contrast: false,
        gamma: true,
        saturation: false,
        hue: false
      })
    })

    it(`shows no HDR warning and enables supported controls in SDR, compact=${compact}`, () => {
      const html = render(false, {
        brightness: windows,
        contrast: windows,
        gamma: windows,
        saturation: nvidia,
        hue: nvidia,
        colorTemperature: noProvider
      })
      expect(html).not.toContain('data-part="hdr-notice"')
      expect(html).not.toContain('HDR')
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
