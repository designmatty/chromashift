import { describe, expect, it } from 'vitest'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import type { ProductState } from '@shared/product-api'
import {
  automaticProfileName,
  liveProfile,
  shouldPreviewProfile
} from '@/features/profiles/app-preview-state'
import { appSessionDraft, shouldEndPreviewOnMinimize } from '@/features/profiles/app-preview-state'

const profiles: ColorProfile[] = [
  { id: 'default', name: 'Default profile', enabled: true, applications: [], displays: [] },
  {
    id: 'game',
    name: 'Game',
    enabled: true,
    applications: [{ executableName: 'game.exe' }],
    displays: [{ displayId: 'display:one', color: createNeutralColorSettings() }]
  }
]
function state(
  status: ProductState['chromaShift']['status'] = 'active'
): Parameters<typeof liveProfile>[0] {
  return {
    configuration: { schemaVersion: 3, profiles, settings: { defaultProfileId: 'default' } },
    chromaShift: {
      status,
      intendedMode: { kind: 'automatic' },
      intendedTarget: { kind: 'profile', profileId: 'default' },
      pendingOperation: null,
      transitionInProgress: false
    },
    foregroundApplication: null
  }
}
describe('app preview selection', () => {
  it('hydrates the editor with a mini-panel override and preserves it on minimize', () => {
    const saved = profiles[1]!
    const draft = structuredClone(saved)
    draft.displays[0]!.color.saturation = 80
    const preview: ProductState['preview'] = {
      state: 'active',
      kind: 'override',
      profileId: saved.id,
      targets: draft.displays,
      draft,
      unsavedChanges: true
    }
    const product = { ...state(), preview } as ProductState
    expect(appSessionDraft(product)).toEqual(draft)
    expect(shouldEndPreviewOnMinimize(false, preview)).toBe(false)
    expect(shouldEndPreviewOnMinimize(true, { ...preview, kind: 'edit' })).toBe(false)
    expect(shouldEndPreviewOnMinimize(true, { state: 'inactive' })).toBe(false)
    expect(
      shouldEndPreviewOnMinimize(false, { ...preview, kind: 'preview', unsavedChanges: false })
    ).toBe(true)
    expect(
      shouldEndPreviewOnMinimize(false, { ...preview, kind: 'edit', unsavedChanges: false })
    ).toBe(true)
  })

  it('opens the intended profile, with Default as the original-settings fallback', () => {
    const product = state()
    product.chromaShift.intendedTarget = { kind: 'profile', profileId: 'GAME' }
    expect(liveProfile(product)?.id).toBe('game')
    product.chromaShift.intendedTarget = { kind: 'baseline' }
    expect(liveProfile(product)?.id).toBe('default')
    product.chromaShift.intendedTarget = null
    expect(liveProfile(product)?.id).toBe('default')
  })
  it('previews other profiles without changing activation intent, even when disabled', () => {
    const product = state()
    const before = structuredClone(product)
    expect(shouldPreviewProfile(product, { ...profiles[1]!, enabled: false })).toBe(true)
    expect(product).toEqual(before)
    expect(shouldPreviewProfile(product, profiles[0]!)).toBe(false)
    expect(shouldPreviewProfile(product, { ...profiles[1]!, displays: [] })).toBe(true)
  })
  it.each(['paused', 'safetyBlocked'] as const)('never previews while %s', (status) => {
    expect(shouldPreviewProfile(state(status), profiles[1]!)).toBe(false)
  })
  it('resolves automatic B while manually using A and browsing preview C', () => {
    const product = state()
    product.chromaShift.intendedMode = { kind: 'manual', profileId: 'default' }
    product.foregroundApplication = {
      pid: 1,
      executable: 'GAME.exe',
      path: null,
      title: 'Game',
      monitorDeviceName: null
    }
    const preview = { ...profiles[1]!, id: 'c', name: 'Preview C', applications: [] }
    product.configuration = { ...product.configuration, profiles: [...profiles, preview] }
    expect(shouldPreviewProfile(product, preview)).toBe(true)
    expect(automaticProfileName(product)).toBe('Game')
    expect(liveProfile(product)?.id).toBe('default')
  })
  it('falls back to Default and then Original settings without a foreground match', () => {
    const product = state()
    product.chromaShift.intendedMode = { kind: 'manual', profileId: 'game' }
    product.chromaShift.intendedTarget = { kind: 'profile', profileId: 'game' }
    expect(automaticProfileName(product)).toBe('Default profile')
    product.configuration = { ...product.configuration, settings: { defaultProfileId: null } }
    expect(automaticProfileName(product)).toBe('Original settings')
  })
  it('starts a normal preview for an empty Default over a live profile', () => {
    const product = state()
    product.chromaShift.intendedTarget = { kind: 'profile', profileId: 'game' }
    expect(shouldPreviewProfile(product, profiles[0]!)).toBe(true)
    product.chromaShift.intendedTarget = { kind: 'baseline' }
    expect(shouldPreviewProfile(product, { ...profiles[1]!, displays: [] })).toBe(true)
    expect(shouldPreviewProfile(product, profiles[0]!)).toBe(false)
    expect(shouldPreviewProfile(state('paused'), { ...profiles[1]!, displays: [] })).toBe(false)
  })
})
