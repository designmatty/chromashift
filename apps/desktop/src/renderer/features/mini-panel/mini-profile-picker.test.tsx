import { ChakraProvider, RadioGroup } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ColorProfile } from '@chromashift/core'
import type { ProductState } from '@shared/product-api'
import { system } from '@/theme/system'
import { AUTOMATIC_ID, MiniProfilePickerOptions } from '@/features/mini-panel/mini-profile-picker'

function state(): ProductState {
  const profile = (id: string, enabled = true): ColorProfile => ({
    id,
    name: id === 'default' ? 'Default' : id,
    enabled,
    displays: [],
    applications: []
  })
  return {
    configuration: { profiles: [profile('default'), profile('Game'), profile('Hidden', false)] },
    settings: {
      shortcutBindings: [
        { action: { kind: 'defaultProfile' }, accelerator: 'Control+D' },
        { action: { kind: 'profile', profileId: 'Game' }, accelerator: 'Control+G' }
      ]
    },
    activation: {
      enabled: true,
      mode: { kind: 'automatic' },
      currentTarget: { kind: 'profile', profileId: 'Game' }
    },
    chromaShift: {
      status: 'active',
      intendedMode: { kind: 'automatic' },
      intendedTarget: { kind: 'profile', profileId: 'Game' }
    }
  } as ProductState
}

function render(product: ProductState): string {
  const value = product.chromaShift.intendedMode.kind === 'automatic' ? AUTOMATIC_ID : 'Game'
  return renderToStaticMarkup(
    <ChakraProvider value={system}>
      <RadioGroup.Root value={value}>
        <MiniProfilePickerOptions product={product} value={value} onChoose={() => undefined} />
      </RadioGroup.Root>
    </ChakraProvider>
  )
}

describe('mini profile picker', () => {
  it('keeps Automatic first, names its current profile, and marks that profile Live', () => {
    const html = render(state())
    const names = [...html.matchAll(/data-part="mini-profile-name"[^>]*>([^<]*)/g)].map(
      (match) => match[1]
    )
    expect(names).toEqual(['Automatic', 'Default', 'Game'])
    expect(html).toContain('Using: Game')
    expect(html.match(/data-part="mini-profile-live"/g)).toHaveLength(1)
    expect(html.indexOf('data-part="mini-profile-live"')).toBeGreaterThan(
      html.indexOf('>Game</span>')
    )
    expect(html).toContain('1 disabled profile')
    expect(html).not.toContain('Hidden')
    expect(html).not.toContain('paused-picker-hint')
  })

  it('uses shared profile icons, grey Default, and configured hotkeys', () => {
    const html = render(state())
    expect(html.match(/lucide-palette/g)).toHaveLength(2)
    expect(
      html.includes('--chromashift-colors-color-palette-fg:var(--chromashift-colors-gray-fg)')
    ).toBe(true)
    expect(html).toContain('data-accelerator="Control+D"')
    expect(html).toContain('data-accelerator="Control+G"')
  })

  it('pluralizes the hidden-profile footer and omits it when every profile is enabled', () => {
    const product = state()
    product.configuration.profiles.push({
      ...product.configuration.profiles[2]!,
      id: 'Other',
      name: 'Other'
    })
    expect(render(product)).toContain('2 disabled profiles')
    product.configuration.profiles = product.configuration.profiles.filter(
      (profile) => profile.enabled
    )
    expect(render(product)).not.toContain('disabled-profiles-count')
  })

  it('shows the Paused hint without claiming any profile is Live', () => {
    const product = state()
    product.chromaShift.status = 'paused'
    const html = render(product)
    expect(html).toContain('ChromaShift is paused — your choice applies when you resume')
    expect(html).not.toContain('mini-profile-live')
    expect(html).toContain('Using: Original settings')
    expect(html).not.toContain('Using: Game')
  })

  it('omits automatic Using and Live in Manual mode, and Live while Safety blocked', () => {
    const product = state()
    product.chromaShift.intendedMode = { kind: 'manual', profileId: 'Game' }
    expect(render(product)).not.toContain('automatic-using')
    expect(render(product)).not.toContain('mini-profile-live')
    product.chromaShift.intendedMode = { kind: 'automatic' }
    product.chromaShift.status = 'safetyBlocked'
    expect(render(product)).not.toContain('mini-profile-live')
    expect(render(product)).not.toContain('automatic-using')
  })

  it('follows the applied target when Automatic returns to Default before intent updates', () => {
    const product = state()
    product.activation.currentTarget = { kind: 'profile', profileId: 'default' }
    const html = render(product)
    expect(html).toContain('Using: Default')
    expect(html.indexOf('mini-profile-live')).toBeLessThan(html.indexOf('>Game</span>'))
  })

  it('names confirmed Original settings without marking a profile Live', () => {
    const product = state()
    product.activation.currentTarget = { kind: 'baseline' }
    const html = render(product)
    expect(html).toContain('Using: Original settings')
    expect(html).not.toContain('mini-profile-live')
  })

  it('omits Using and Live when no applied target is confirmed', () => {
    const product = state()
    product.activation.currentTarget = null
    const html = render(product)
    expect(html).not.toContain('automatic-using')
    expect(html).not.toContain('mini-profile-live')
  })
})
