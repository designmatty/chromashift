import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { system } from '@/theme/system'
import { SettingsPanel } from '@/features/settings/settings-panel'
import { ShortcutsPanel } from '@/features/settings/shortcuts-panel'
import type { ProductState } from '@shared/product-api'

function product(launchAtStartup: boolean): ProductState {
  return {
    version: 'test',
    displays: [],
    capabilityReports: {},
    foregroundApplication: null,
    preview: { state: 'inactive' },
    activation: { enabled: true, mode: { kind: 'automatic' }, currentTarget: null },
    chromaShift: {
      status: 'active',
      intendedMode: { kind: 'automatic' },
      intendedTarget: null,
      pendingOperation: null,
      transitionInProgress: false
    },
    settings: {
      schemaVersion: 3,
      launchAtStartup,
      launchBehavior: 'app',
      closeBehavior: 'tray',
      theme: 'system',
      notificationsEnabled: false,
      shortcutBindings: []
    },
    configuration: {
      schemaVersion: 3,
      settings: { defaultProfileId: 'default' },
      profiles: [
        { id: 'game', name: 'Game', enabled: true, applications: [], displays: [] },
        { id: 'default', name: 'Default', enabled: true, applications: [], displays: [] }
      ]
    }
  }
}

it.each([false, true])(
  'disables Startup window only when login launch is off: %s',
  (launchAtStartup) => {
    const html = renderToStaticMarkup(
      <ChakraProvider value={system}>
        <SettingsPanel product={product(launchAtStartup)} onError={() => undefined} />
      </ChakraProvider>
    )
    const trigger = html.match(/<button[^>]*aria-label="Startup window"[^>]*>/)![0]
    expect(trigger.includes('disabled=""')).toBe(!launchAtStartup)
    expect(html).toContain('Launch at startup')
    expect(html).toContain('Open app panel')
    expect(html.match(/<button[^>]*aria-label="Close behavior"[^>]*>/)![0]).not.toContain(
      'disabled=""'
    )
  }
)

it('groups shortcuts with Default first and an unassigned End preview action', () => {
  const html = renderToStaticMarkup(
    <ChakraProvider value={system}>
      <ShortcutsPanel product={product(false)} onError={() => undefined} />
    </ChakraProvider>
  )
  const headings = [...html.matchAll(/<h2[^>]*>(Safety|Control|Navigation|Profiles)<\/h2>/g)].map(
    (match) => match[1]
  )
  expect(headings).toEqual(['Safety', 'Control', 'Navigation', 'Profiles'])
  expect(html.indexOf('aria-label="Default shortcut"')).toBeLessThan(
    html.indexOf('aria-label="Game shortcut"')
  )
  expect(html).toContain('aria-label="End preview shortcut"')
  expect(html).toContain('Switches to the profile in Manual mode.')
  expect(html).not.toContain('Select this profile')
  expect(html).toContain('Fixed safety shortcut')
  expect([...html.matchAll(/data-part="shortcut-key"/g)]).toHaveLength(4)
})
