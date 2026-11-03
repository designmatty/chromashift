import { describe, expect, it } from 'vitest'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import type { ProductState } from '@shared/product-api'
import {
  discardPlan,
  isProfileClickNoop,
  keepsPreviewBannerWhileSwitching,
  liveProfile,
  previewBannerVisible,
  shouldPreviewProfile,
  updatePlan
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
  it('previews C while manually using A without changing the live profile', () => {
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
    expect(liveProfile(product)?.id).toBe('default')
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
  it.each([
    ['live, without a session', 'default', 'default'],
    ['previewed', 'game', 'game'],
    ['case-insensitively', 'GAME', 'game']
  ])('ignores a click on the profile already shown (%s)', (_label, clicked, shown) => {
    expect(isProfileClickNoop('profiles', clicked, shown)).toBe(true)
  })
  it('still handles clicks on another profile or from a Settings page', () => {
    // Clicking the live profile while previewing another returns to live.
    expect(isProfileClickNoop('profiles', 'default', 'game')).toBe(false)
    // A profile click from Settings navigates back to Profiles.
    expect(isProfileClickNoop('settings', 'default', 'default')).toBe(false)
    expect(isProfileClickNoop('shortcuts', 'game', 'game')).toBe(false)
    expect(isProfileClickNoop('profiles', 'game', null)).toBe(false)
  })
})

describe('preview banner while switching profiles', () => {
  const third: ColorProfile = { ...profiles[1]!, id: 'third', name: 'Third', applications: [] }
  function withPreview(
    preview: ProductState['preview'],
    status: ProductState['chromaShift']['status'] = 'active'
  ): Parameters<typeof previewBannerVisible>[0] {
    const product = state(status)
    return {
      ...product,
      configuration: { ...product.configuration, profiles: [...profiles, third] },
      preview
    }
  }
  const previewing = (
    kind: 'preview' | 'edit' | 'override',
    profileId = 'game'
  ): ProductState['preview'] => ({ state: 'active', profileId, kind, targets: [] })

  it('keeps the banner from one previewed or edited profile to another', () => {
    expect(keepsPreviewBannerWhileSwitching(withPreview(previewing('preview')), third)).toBe(true)
    expect(keepsPreviewBannerWhileSwitching(withPreview(previewing('edit')), third)).toBe(true)
  })
  it('keeps the banner for an empty destination, but not the live or same profile', () => {
    const before = withPreview(previewing('preview'))
    expect(keepsPreviewBannerWhileSwitching(before, profiles[0]!)).toBe(false)
    expect(keepsPreviewBannerWhileSwitching(before, { ...third, displays: [] })).toBe(true)
    expect(keepsPreviewBannerWhileSwitching(before, profiles[1]!)).toBe(false)
  })
  it('does not keep the banner without a preview, for an override, or when not Active', () => {
    expect(keepsPreviewBannerWhileSwitching(withPreview({ state: 'inactive' }), third)).toBe(false)
    expect(keepsPreviewBannerWhileSwitching(withPreview(previewing('override')), third)).toBe(false)
    expect(
      keepsPreviewBannerWhileSwitching(withPreview(previewing('preview'), 'paused'), third)
    ).toBe(false)
  })
  it('shows the destination while the previous session rolls back', () => {
    const rolledBack = withPreview({ state: 'inactive' })
    expect(previewBannerVisible(rolledBack, third, 'third')).toBe(true)
    expect(previewBannerVisible(withPreview(previewing('preview')), third, 'third')).toBe(true)
    // The next session has started; the pending destination is no longer needed.
    expect(previewBannerVisible(withPreview(previewing('preview', 'third')), third, null)).toBe(
      true
    )
  })
  it('shows empty profiles only while their session or pending destination exists', () => {
    const empty = { ...third, displays: [] }
    const rolledBack = withPreview({ state: 'inactive' })
    expect(previewBannerVisible(rolledBack, empty, null)).toBe(false)
    expect(previewBannerVisible(rolledBack, empty, 'third')).toBe(true)
    expect(previewBannerVisible(withPreview(previewing('preview', 'third')), empty, null)).toBe(
      true
    )
  })
  it('hides the banner when the switch fails or the destination is live', () => {
    const rolledBack = withPreview({ state: 'inactive' })
    // A failed switch clears the pending destination.
    expect(previewBannerVisible(rolledBack, third, null)).toBe(false)
    expect(previewBannerVisible(rolledBack, profiles[0]!, 'default')).toBe(false)
    expect(previewBannerVisible(withPreview(previewing('override')), third, 'third')).toBe(false)
    expect(previewBannerVisible(withPreview({ state: 'inactive' }, 'paused'), third, 'third')).toBe(
      false
    )
  })
})

describe('header Update and Discard', () => {
  const second = { displayId: 'display:two', color: createNeutralColorSettings() }
  function session(
    preview: ProductState['preview'],
    status: ProductState['chromaShift']['status'] = 'active'
  ): Parameters<typeof discardPlan>[0] {
    return { ...state(status), preview }
  }
  const editing = (
    targets = profiles[1]!.displays,
    overrides: { kind?: 'preview' | 'edit' | 'override'; profileId?: string } = {}
  ): ProductState['preview'] => ({
    state: 'active',
    kind: overrides.kind ?? 'edit',
    profileId: overrides.profileId ?? 'game',
    targets
  })

  it('commits the live profile and saves any other profile in its session', () => {
    expect(updatePlan(session({ state: 'inactive' }), 'default')).toBe('commit')
    expect(updatePlan(session({ state: 'inactive' }), 'DEFAULT')).toBe('commit')
    expect(updatePlan(session(editing()), 'game')).toBe('saveInSession')
  })
  it('returns to live only when discarding the live profile or a missing one', () => {
    expect(discardPlan(session(editing()), profiles[0])).toBe('returnToLive')
    expect(discardPlan(session(editing()), undefined)).toBe('returnToLive')
  })
  it('reverts a non-live session in place when saved targets cover it', () => {
    expect(discardPlan(session(editing()), profiles[1])).toBe('revertSession')
    expect(discardPlan(session(editing(undefined, { kind: 'preview' })), profiles[1])).toBe(
      'revertSession'
    )
    // A saved target the session lacks is simply applied.
    expect(
      discardPlan(session(editing([])), {
        ...profiles[1]!,
        displays: [...profiles[1]!.displays, second]
      })
    ).toBe('revertSession')
  })
  it('reverts draft-only targets and empty saved profiles in place', () => {
    // The draft added a display target the saved profile lacks.
    expect(discardPlan(session(editing([...profiles[1]!.displays, second])), profiles[1])).toBe(
      'revertSession'
    )
    // Empty profiles keep a real baseline preview session.
    expect(discardPlan(session(editing()), { ...profiles[1]!, displays: [] })).toBe('revertSession')
  })
  it('restarts only when no matching Preview or Edit session can be reused', () => {
    expect(discardPlan(session({ state: 'inactive' }), profiles[1])).toBe('restartPreview')
    expect(discardPlan(session(editing(undefined, { kind: 'override' })), profiles[1])).toBe(
      'restartPreview'
    )
    expect(discardPlan(session(editing(undefined, { profileId: 'other' })), profiles[1])).toBe(
      'restartPreview'
    )
  })
})
