import { describe, expect, it } from 'vitest'
import type { ColorProfile } from '@chromashift/core'
import type { ShortcutBinding } from '../../../shared/product-api.js'
import { profileSelectionItems, profileSelectionLabel } from './profile-selection.js'

const profiles: ColorProfile[] = [
  { id: 'default', name: 'Default profile', enabled: true, applications: [], displays: [] },
  { id: 'gaming', name: 'Counter Strike', enabled: true, applications: [], displays: [] },
  { id: 'disabled', name: 'Disabled profile', enabled: false, applications: [], displays: [] }
]

describe('profile selection presentation', () => {
  it('shows the automatically resolved profile, not the profile being viewed', () => {
    expect(profileSelectionLabel(profiles, { kind: 'automatic' }, 'default')).toBe(
      'Automatic: Default profile'
    )
    expect(profileSelectionLabel(profiles, { kind: 'automatic' }, 'GAMING')).toBe(
      'Automatic: Counter Strike'
    )
  })

  it('uses the manual choice independently of the automatic target', () => {
    expect(
      profileSelectionLabel(profiles, { kind: 'manual', profileId: 'gaming' }, 'default')
    ).toBe('Manual: Counter Strike')
  })

  it('does not invent a resolved profile when Automatic has no target', () => {
    expect(profileSelectionLabel(profiles, { kind: 'automatic' }, null)).toBe('Automatic')
    expect(profileSelectionLabel(profiles, { kind: 'automatic' }, 'missing')).toBe(
      'Automatic: Profile unavailable'
    )
  })

  it('reflects profile renames without changing selection', () => {
    const renamed = profiles.map((profile) => ({ ...profile, name: 'Renamed' }))
    expect(profileSelectionLabel(renamed, { kind: 'automatic' }, 'default')).toBe(
      'Automatic: Renamed'
    )
  })

  it('shows profile shortcuts and the built-in Default and Automatic shortcuts', () => {
    const bindings: ShortcutBinding[] = [
      { action: { kind: 'automatic' }, accelerator: 'Control+Shift+A' },
      { action: { kind: 'defaultProfile' }, accelerator: 'Control+Shift+D' },
      { action: { kind: 'profile', profileId: 'GAMING' }, accelerator: 'Control+G' },
      { action: { kind: 'profile', profileId: 'disabled' }, accelerator: 'Control+X' }
    ]
    expect(profileSelectionItems(profiles, bindings)).toEqual([
      { label: 'Automatic', value: 'automatic', shortcut: 'Control+Shift+A' },
      { label: 'Default profile', value: 'profile:default', shortcut: 'Control+Shift+D' },
      { label: 'Counter Strike', value: 'profile:gaming', shortcut: 'Control+G' }
    ])
  })

  it('updates or clears a displayed shortcut when preferences change', () => {
    const bindings: ShortcutBinding[] = [
      { action: { kind: 'profile', profileId: 'gaming' }, accelerator: 'Super+G' }
    ]
    expect(profileSelectionItems(profiles, bindings)[2]?.shortcut).toBe('Super+G')
    expect(profileSelectionItems(profiles, [])[2]?.shortcut).toBeNull()
  })
})
