import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProfileList, type ProfileListProps } from '@/features/profiles/profile-list'
import { system } from '@/theme/system'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ content, children }: { content: string; children: React.ReactNode }) => (
    <span data-tooltip={content}>{children}</span>
  )
}))

function render(overrides: Partial<ProfileListProps> = {}): string {
  const props: ProfileListProps = {
    profiles: [],
    shortcutBindings: [{ action: { kind: 'automatic' }, accelerator: 'Control+A' }],
    selectedId: null,
    currentId: 'game',
    dirtyProfileId: null,
    previewingProfileId: null,
    mode: { kind: 'automatic' },
    controlStatus: 'active',
    busy: false,
    collapsed: false,
    onCollapsedChange: vi.fn(),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onModeChange: vi.fn(),
    onUseProfile: vi.fn(),
    onOpenSettings: vi.fn(),
    onDuplicate: vi.fn(),
    onToggleEnabled: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
  return renderToStaticMarkup(
    <ChakraProvider value={system}>
      <ProfileList {...props} />
    </ChakraProvider>
  )
}

describe('sidebar activation SegmentGroup', () => {
  it.each([false, true])('uses labelled radio segments with collapsed=%s', (collapsed) => {
    const html = render({ collapsed })
    const toggle = html.slice(
      html.indexOf('data-part="mode-toggle"'),
      html.indexOf('</label>', html.indexOf('data-mode="manual"'))
    )
    expect(toggle).toContain('data-scope="segment-group"')
    expect(toggle).toContain(`data-orientation="${collapsed ? 'vertical' : 'horizontal'}"`)
    expect(toggle).toContain('aria-label="Activation mode"')
    expect(toggle).toContain('role="radiogroup"')
    for (const label of ['Automatic', 'Manual']) {
      expect(toggle).toContain(`aria-label="${label}"`)
      expect(toggle).toContain(`>${label}</span>`)
      if (collapsed)
        expect(toggle).toMatch(
          new RegExp(`data-part="mode-short-label" aria-hidden="true"[^>]*>${label[0]}</span>`)
        )
    }
    expect(toggle.match(/type="radio"/g)).toHaveLength(2)
    expect(toggle).toContain('data-tooltip="Automatic (Ctrl+A)"')
    expect(toggle).toContain('data-tooltip="Manual"')
    expect(toggle).toMatch(/data-state="checked"[^>]*data-mode="automatic"/)
    // Smoke reads data-selected: at runtime the tooltip trigger overrides data-state and
    // the hidden radio uses defaultChecked, so neither tracks later mode changes.
    expect(toggle).toMatch(/data-mode="automatic" data-selected=""/)
    expect(toggle).not.toMatch(/data-mode="manual" data-selected/)
    if (collapsed) {
      expect(html).toContain('width:40px')
      expect(html).toContain('min-width:0')
    }
  })

  it('selects the Manual segment when Manual is intended', () => {
    expect(render({ mode: { kind: 'manual', profileId: 'game' } })).toMatch(
      /data-state="checked"[^>]*data-mode="manual"/
    )
    expect(render({ mode: { kind: 'manual', profileId: 'game' } })).toMatch(
      /data-mode="manual" data-selected=""/
    )
  })

  it.each([true, false])('disables Manual without a live profile, busy=%s', (busy) => {
    const html = render({ currentId: null, busy })
    const inputs = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((match) => match[0])
    expect(inputs).toHaveLength(2)
    expect(inputs[0]!.includes('disabled=""')).toBe(busy)
    expect(inputs[1]).toContain('disabled=""')
  })
})
