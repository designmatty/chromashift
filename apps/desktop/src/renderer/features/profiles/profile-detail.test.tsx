import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ColorProfile } from '@chromashift/core'
import type { ProductState } from '@shared/product-api'
import { system } from '@/theme/system'
import { ProfileDetail } from '@/features/profiles/profile-detail'
import { ProfileTriggerSummary } from '@/features/profiles/profile-trigger-summary'

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

function summary(names: string[], id?: string): string {
  return renderToStaticMarkup(
    <ChakraProvider value={system}>
      <ProfileTriggerSummary profile={profile(names, id)} />
    </ChakraProvider>
  )
}

describe('profile trigger summary', () => {
  it.each([
    [[], 'Triggers: None'],
    [['game.exe'], 'Triggers: game.exe'],
    [['a.exe', 'b.exe'], 'Triggers: a.exe, b.exe'],
    [['a.exe', 'b.exe', 'c.exe', 'd.exe'], 'Triggers: a.exe, b.exe +2']
  ])('summarizes %j', (names, expected) => {
    const html = summary(names as string[])
    expect(html).toContain(`>${expected}</p>`)
    expect(html).toContain('data-part="profile-trigger-summary"')
  })

  it('exposes every trigger in the tooltip when the summary is compacted', () => {
    const html = summary(['a.exe', 'b.exe', 'c.exe'])
    expect(html).toContain('data-tooltip="Triggers: a.exe, b.exe, c.exe"')
    expect(html).toContain('data-tooltip-disabled="false"')
  })

  it('omits the summary for Default, even with legacy triggers', () => {
    expect(summary(['legacy.exe'], 'DEFAULT')).not.toContain('Triggers:')
  })
})

describe('profile detail', () => {
  function render(id: string, bound = true): string {
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
          profile={profile([], id)}
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
    expect(header).toContain('More profile actions')
    expect(render('game', false)).not.toContain('data-part="shortcut-display"')
  })

  it('keeps Default grey with its fallback explanation and no trigger list', () => {
    const html = render('default')
    expect(
      html.includes('--chromashift-colors-color-palette-fg:var(--chromashift-colors-gray-fg)')
    ).toBe(true)
    expect(html).toContain('Used when no other profile&#x27;s triggers match')
    expect(html).not.toContain('Select from open apps')
    expect(html).not.toContain('profile-trigger-summary')
    expect(html).toContain('data-accelerator="Control+G"')
  })
})
