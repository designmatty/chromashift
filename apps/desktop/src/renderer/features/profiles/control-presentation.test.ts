import { describe, expect, it } from 'vitest'
import type { ActivationMode } from '@chromashift/core'
import type { ShortcutBinding } from '@shared/product-api'
import {
  controlPill,
  liveProfileColor,
  liveProfileSubtitle,
  modeToggleDecision,
  modeTooltip,
  profileShortcut,
  useProfileKey,
  previewMarkerProfileId
} from '@/features/profiles/control-presentation'

const profiles = [
  { id: 'default', name: 'Default profile', enabled: true, applications: [], displays: [] },
  { id: 'game', name: 'Game', enabled: true, applications: [], displays: [] }
]

function state(): Parameters<typeof controlPill>[0] {
  return {
    configuration: { schemaVersion: 3, profiles, settings: { defaultProfileId: 'default' } },
    chromaShift: {
      status: 'active',
      intendedMode: { kind: 'automatic' },
      intendedTarget: { kind: 'profile', profileId: 'default' },
      pendingOperation: null,
      transitionInProgress: false
    },
    preview: { state: 'inactive' },
    foregroundApplication: null
  }
}

describe('control pill', () => {
  it('shows pending restoration as Safety blocked without an editable preview marker', () => {
    const product = state()
    product.chromaShift.status = 'safetyBlocked'
    product.chromaShift.pendingOperation = 'previewRestore'
    product.preview = { state: 'restorePending', displayIds: ['display:one'] }
    expect(controlPill(product, true)).toEqual({
      label: 'Safety blocked',
      palette: 'red',
      previewing: false
    })
    expect(previewMarkerProfileId(product.preview)).toBeNull()
  })
  it('names the live manual profile, including subsequent renames', () => {
    const product = state()
    expect(controlPill(product)).toEqual({
      label: 'Active · Automatic',
      palette: 'green',
      previewing: false
    })
    product.chromaShift.intendedMode = { kind: 'manual', profileId: 'game' }
    product.chromaShift.intendedTarget = { kind: 'profile', profileId: 'game' }
    expect(controlPill(product).label).toBe('Active · Manual: Game')
    product.configuration = {
      ...product.configuration,
      profiles: profiles.map((p) => ({ ...p, name: 'Renamed' }))
    }
    expect(controlPill(product).label).toBe('Active · Manual: Renamed')
  })
  it('highlights only a non-live preview and ignores case in profile IDs', () => {
    const product = state()
    product.preview = {
      state: 'active',
      sessionId: 1,
      kind: 'preview',
      profileId: 'GAME',
      targets: [],
      unsavedChanges: false
    }
    expect(controlPill(product)).toEqual({
      label: 'Previewing: Game',
      palette: 'green',
      previewing: true
    })
    product.preview.profileId = 'DEFAULT'
    expect(controlPill(product).label).toBe('Active · Automatic')
  })
  it('prioritizes unsaved edits and overrides over preview and mode', () => {
    const product = state()
    expect(controlPill(product, true).label).toBe('Auto-switching on hold')
    for (const kind of ['edit', 'override'] as const) {
      product.preview = {
        state: 'active',
        sessionId: 1,
        kind,
        profileId: 'game',
        targets: [],
        unsavedChanges: true
      }
      expect(controlPill(product)).toEqual({
        label: 'Auto-switching on hold',
        palette: 'yellow',
        previewing: false
      })
    }
  })
  it.each([
    ['paused', 'Paused', 'gray'],
    ['safetyBlocked', 'Safety blocked', 'red']
  ] as const)('prioritizes %s over dirty edits and mode', (status, label, palette) => {
    const product = state()
    product.chromaShift.status = status
    product.preview = {
      state: 'active',
      sessionId: 1,
      kind: 'edit',
      profileId: 'game',
      targets: [],
      unsavedChanges: true
    }
    expect(controlPill(product, true)).toEqual({ label, palette, previewing: false })
  })
})

describe('live sidebar state', () => {
  it.each([
    ['active', 'Live', 'profile.live'],
    ['paused', 'Paused', 'fg.muted'],
    ['safetyBlocked', 'Blocked', 'red.fg']
  ] as const)('uses %s text and ring color in both modes', (status, label, color) => {
    for (const mode of [{ kind: 'automatic' }, { kind: 'manual', profileId: 'game' }] as const) {
      expect(liveProfileSubtitle(status, mode)).toBe(
        `${label} · ${mode.kind === 'automatic' ? 'Automatic' : 'Manual'}`
      )
      expect(liveProfileColor(status)).toBe(color)
    }
  })
})

describe('mode toggle decisions', () => {
  it('keeps the live profile when entering Manual while another profile is previewed', () => {
    const product = state()
    product.preview = {
      state: 'active',
      sessionId: 1,
      kind: 'preview',
      profileId: 'game',
      targets: [],
      unsavedChanges: false
    }
    expect(modeToggleDecision(product.chromaShift.intendedMode, 'manual', 'default')).toEqual({
      kind: 'manual',
      profileId: 'default'
    })
  })
  it('returns Automatic and treats the already selected mode as a no-op', () => {
    const manual: ActivationMode = { kind: 'manual', profileId: 'game' }
    expect(modeToggleDecision(manual, 'automatic', 'game')).toEqual({ kind: 'automatic' })
    expect(modeToggleDecision(manual, 'manual', 'default')).toBeNull()
    expect(modeToggleDecision({ kind: 'automatic' }, 'automatic', 'game')).toBeNull()
    expect(modeToggleDecision({ kind: 'automatic' }, 'manual', null)).toBeNull()
  })
  it('formats current Automatic bindings, without inventing a Manual shortcut', () => {
    const bindings: ShortcutBinding[] = [
      { action: { kind: 'automatic' }, accelerator: 'CommandOrControl+Alt+Super+End' }
    ]
    expect(modeTooltip('automatic', bindings)).toBe('Automatic (Ctrl+Alt+Win+End)')
    expect(modeTooltip('manual', bindings)).toBe('Manual')
    expect(modeTooltip('automatic', [])).toBe('Automatic')
    expect(modeTooltip('automatic', [{ ...bindings[0]!, accelerator: 'Control+Shift+A' }])).toBe(
      'Automatic (Ctrl+Shift+A)'
    )
  })
  it('finds both Default and case-insensitive profile hotkeys for row tooltips', () => {
    const bindings: ShortcutBinding[] = [
      { action: { kind: 'defaultProfile' }, accelerator: 'Control+D' },
      { action: { kind: 'profile', profileId: 'GAME' }, accelerator: 'Control+G' }
    ]
    expect(profileShortcut(profiles[0]!, bindings)).toBe('Control+D')
    expect(profileShortcut(profiles[1]!, bindings)).toBe('Control+G')
    expect(profileShortcut(profiles[1]!, [])).toBeUndefined()
  })
})

describe('row activation and preview markers', () => {
  const key = { key: 'Enter', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false }
  it('separates Manual selection from browsing, busy state and reordering', () => {
    expect(useProfileKey(key, true, false)).toBe(true)
    expect(useProfileKey(key, false, false)).toBe(false)
    expect(useProfileKey(key, true, true)).toBe(false)
    expect(useProfileKey({ ...key, shiftKey: false }, true, false)).toBe(false)
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey'] as const)
      expect(useProfileKey({ ...key, [modifier]: true }, true, false)).toBe(false)
    expect(useProfileKey({ ...key, key: ' ' }, true, false)).toBe(false)
  })
  it('retains the preview eye after edits return to saved values', () => {
    const product = state()
    expect(previewMarkerProfileId(product.preview)).toBeNull()
    for (const kind of ['preview', 'edit'] as const) {
      product.preview = {
        state: 'active',
        sessionId: 1,
        kind,
        profileId: 'game',
        targets: [],
        unsavedChanges: false
      }
      expect(previewMarkerProfileId(product.preview)).toBe('game')
      expect(controlPill(product).label).toBe('Previewing: Game')
    }
  })
})
