import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import { describe, expect, it, vi } from 'vitest'
import type { ProductState } from '@shared/product-api'
import { system } from '@/theme/system'
import { MiniDisplaySelect } from '@/features/mini-panel/mini-panel'
import { DisplayControls } from '@/features/profiles/display-controls'

const displays = [
  {
    id: 'display:hdr',
    name: 'Odyssey G60SD',
    hdr: true,
    primary: true,
    adapter: { name: 'NVIDIA' },
    connection: 'DisplayPort'
  },
  {
    id: 'display:sdr',
    name: 'VG278',
    hdr: false,
    primary: false,
    adapter: { name: 'NVIDIA' },
    connection: 'DisplayPort'
  }
] as unknown as ProductState['displays']

const badge = /<span\b[^>]*data-part="hdr-badge"[^>]*>HDR<\/span>/

/** The markup of one display tab button. Tabs render before their panels. */
function tab(html: string, displayId: string): string {
  const id = html.indexOf(`data-display-id="${displayId}"`)
  const markup = html.slice(html.lastIndexOf('<button', id), html.indexOf('</button>', id))
  expect(markup).toContain('data-part="display-tab"')
  return markup
}

describe('HDR badge in both panels', () => {
  it('marks only the HDR display tab, before its name and the Primary badge', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
    const profile: ColorProfile = {
      id: 'gaming',
      name: 'Gaming',
      enabled: true,
      applications: [],
      displays: [{ displayId: 'display:hdr', color: createNeutralColorSettings() }]
    }
    const html = renderToStaticMarkup(
      <ChakraProvider value={system}>
        <DisplayControls
          profile={profile}
          product={{ displays, capabilityReports: {} } as unknown as ProductState}
          editing
          onChange={() => undefined}
        />
      </ChakraProvider>
    )
    const hdr = tab(html, 'display:hdr')
    expect(hdr).toMatch(badge)
    expect(hdr.search(badge)).toBeLessThan(hdr.indexOf('Odyssey G60SD'))
    expect(hdr.indexOf('Odyssey G60SD')).toBeLessThan(hdr.indexOf('Primary'))
    // The badge text is the only accessible name, so the tab reads "HDR" once.
    expect(hdr.match(/HDR/g)).toHaveLength(1)
    expect(hdr).not.toMatch(/aria-label="[^"]*HDR/)
    expect(tab(html, 'display:sdr')).not.toContain('hdr-badge')
  })

  it.each(['display:hdr', 'display:sdr'])(
    'marks the HDR display in the mini display select trigger and options, selected=%s',
    (selectedId) => {
      const html = renderToStaticMarkup(
        <ChakraProvider value={system}>
          <MiniDisplaySelect
            displays={displays}
            selectedId={selectedId}
            onSelect={() => undefined}
          />
        </ChakraProvider>
      )
      const trigger = html.slice(
        html.indexOf('data-part="trigger"'),
        html.indexOf('</button>', html.indexOf('data-part="trigger"'))
      )
      expect(badge.test(trigger)).toBe(selectedId === 'display:hdr')
      const options = html.split('role="option"').slice(1)
      expect(options).toHaveLength(2)
      expect(options[0]).toMatch(badge)
      expect(options[0]!.match(/HDR/g)).toHaveLength(1)
      expect(options[1]).not.toContain('hdr-badge')
    }
  )
})
