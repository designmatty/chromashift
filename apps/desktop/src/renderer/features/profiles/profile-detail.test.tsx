import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ColorProfile } from '@chromashift/core'
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
  function render(id: string, bound = true, names: string[] = []): string {
    vi.stubGlobal('localStorage', { getItem: () => null })
    const product = {
      displays: [],
      capabilityReports: {},
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
            applications: names.map((executableName) => ({
              executableName,
              executablePath: `C:\\Apps\\${executableName}`
            }))
          }}
          product={product}
          busy={false}
          dirty={false}
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
