import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import type { ProductState } from '@shared/product-api'
import { system } from '@/theme/system'
import { ProfileDetail } from '@/features/profiles/profile-detail'

// Keep tooltip content inspectable without opening a browser portal.
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({
    content,
    disabled,
    children
  }: {
    content: string
    disabled?: boolean
    children: React.ReactNode
  }) => (
    <span data-tooltip={content} data-tooltip-disabled={disabled}>
      {children}
    </span>
  )
}))

afterEach(() => vi.unstubAllGlobals())

function profile(names: string[], id = 'game'): ColorProfile {
  return {
    id,
    name: 'Game',
    enabled: true,
    displays: [],
    applications: names.map((executableName) => ({ executableName }))
  }
}

describe('profile detail', () => {
  function render(
    id: string,
    bound = true,
    names: string[] = [],
    comparison: 'clean' | 'draft' | 'saved' = 'clean'
  ): string {
    vi.stubGlobal('localStorage', { getItem: () => null })
    const product = {
      displays:
        comparison === 'clean'
          ? []
          : [
              {
                id: 'display:one',
                name: 'Display',
                hdr: false,
                primary: true,
                adapter: { name: 'Test adapter' },
                connection: 'DisplayPort'
              }
            ],
      capabilityReports: {
        'display:one': {
          capabilities: Object.fromEntries(
            ['brightness', 'contrast', 'gamma', 'saturation', 'hue', 'colorTemperature'].map(
              (key) => [key, { supported: true, provider: 'nvidia' }]
            )
          )
        }
      },
      chromaShift: { status: 'active' },
      settings: {
        shortcutBindings: bound
          ? [
              {
                accelerator: 'Control+G',
                action:
                  id === 'default' ? { kind: 'defaultProfile' } : { kind: 'profile', profileId: id }
              }
            ]
          : []
      }
    } as unknown as ProductState
    return renderToStaticMarkup(
      <ChakraProvider value={system}>
        <ProfileDetail
          profile={{
            ...profile(names, id),
            displays:
              comparison === 'clean'
                ? []
                : [
                    {
                      displayId: 'display:one',
                      color: { ...createNeutralColorSettings(), brightness: 61 }
                    }
                  ],
            applications: names.map((executableName) => ({
              executableName,
              executablePath: `C:\\Apps\\${executableName}`
            }))
          }}
          product={product}
          busy={false}
          dirty={comparison !== 'clean'}
          compare={{
            showingSaved: comparison === 'saved',
            savedProfile: {
              ...profile(names, id),
              displays: [
                {
                  displayId: 'display:one',
                  color: { ...createNeutralColorSettings(), brightness: 54 }
                }
              ]
            },
            onPress: vi.fn(),
            onRelease: vi.fn(async () => undefined)
          }}
          onChange={vi.fn()}
          onCancel={vi.fn()}
          onSave={vi.fn()}
          onCopy={vi.fn()}
          onDelete={vi.fn()}
          onToggleEnabled={vi.fn()}
          onError={vi.fn()}
        />
      </ChakraProvider>
    )
  }

  it('shows compare only for dirty drafts and displays disabled saved controls while held', () => {
    expect(render('game')).not.toContain('Hold to compare with saved')
    const draft = render('game', true, [], 'draft')
    expect(draft).toContain('aria-label="Hold to compare with saved"')
    expect(draft).toContain('aria-pressed="false"')
    expect(draft).not.toContain('Showing saved values')
    const saved = render('game', true, [], 'saved')
    expect(saved).toContain('aria-pressed="true"')
    expect(saved).not.toContain('compare-saved-indicator')
    expect(saved).toContain('data-comparing="true"')
    expect(saved).toContain('Showing saved values')
    const controls = saved.slice(saved.indexOf('data-part="profile-color-controls"'))
    expect(controls).toContain('54%')
    expect(controls).not.toContain('61%')
    const sliders = [...controls.matchAll(/<div\b[^>]*data-slot="slider"[^>]*>/g)]
    expect(sliders).toHaveLength(6)
    expect(sliders.every(([slider]) => slider.includes('data-disabled=""'))).toBe(true)
  })

  it('puts Triggers above display controls and shows the configured profile shortcut in the header', () => {
    const html = render('game')
    expect(html.indexOf('data-part="profile-triggers"')).toBeLessThan(
      html.indexOf('data-part="profile-color-controls"')
    )
    expect(html).toContain('>Triggers</h2>')
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    expect(header).toContain('data-accelerator="Control+G"')
    // The hotkey leads the header action group on the right.
    const hotkey = header.indexOf('data-part="shortcut-display"')
    expect(hotkey).toBeGreaterThan(header.indexOf('data-part="profile-header-actions"'))
    expect(header).toContain('data-part="profile-hotkey"')
    expect(header).toContain('More profile actions')
    expect(render('game', false)).not.toContain('data-part="shortcut-display"')
  })

  it('keeps trigger actions beside the heading and uses compact wrapping executable chips', () => {
    const html = render('game', true, ['game.exe', 'other.exe'])
    const triggers = html.slice(
      html.indexOf('data-part="profile-triggers"'),
      html.indexOf('data-part="profile-color-controls"')
    )
    expect(triggers.indexOf('data-part="trigger-heading"')).toBeLessThan(
      triggers.indexOf('>Triggers</h2>')
    )
    expect(triggers.indexOf('data-part="trigger-actions"')).toBeLessThan(
      triggers.indexOf('data-part="trigger-chips"')
    )
    expect(triggers.match(/data-part="trigger-chip"/g)).toHaveLength(2)
    expect(triggers).toContain('flex-wrap:wrap')
    for (const name of ['game.exe', 'other.exe']) {
      expect(triggers).toContain(`>${name}</p>`)
      expect(triggers).toContain(`aria-label="Remove ${name}"`)
      expect(triggers).toContain(`data-tooltip="Remove ${name}"`)
    }
    expect(html).not.toContain('C:\\Apps')
    expect(html).not.toContain('Triggers:')
  })

  it('keeps Default grey with its fallback explanation and no trigger list', () => {
    const html = render('default')
    expect(
      html.includes('--chromashift-colors-color-palette-fg:var(--chromashift-colors-gray-fg)')
    ).toBe(true)
    expect(html).toContain('Used in automatic mode when no other profile is triggered')
    expect(html).not.toContain('Select from open apps')
    expect(html).not.toContain('profile-trigger-summary')
    expect(html).toContain('data-accelerator="Control+G"')
  })
})
