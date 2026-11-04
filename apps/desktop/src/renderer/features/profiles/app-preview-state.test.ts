import { describe, expect, it } from 'vitest'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import type { ProductState } from '@shared/product-api'
import {
  emptyPreviewMessage,
  liveProfile,
  shouldPreviewProfile
} from '@/features/profiles/app-preview-state'

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
    expect(shouldPreviewProfile(product, { ...profiles[1]!, displays: [] })).toBe(false)
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
  it('explains empty-target browsing without starting a native preview', () => {
    const product = state()
    product.chromaShift.intendedTarget = { kind: 'profile', profileId: 'game' }
    expect(shouldPreviewProfile(product, profiles[0]!)).toBe(false)
    expect(emptyPreviewMessage(product, profiles[0]!)).toBe(
      'No display settings saved — your displays keep Game until you change a value.'
    )
    product.chromaShift.intendedTarget = { kind: 'baseline' }
    expect(emptyPreviewMessage(product, { ...profiles[1]!, displays: [] })).toBe(
      'No display settings saved — your displays keep their current settings until you change a value.'
    )
    expect(emptyPreviewMessage(product, profiles[0]!)).toBe(null)
    expect(emptyPreviewMessage(state('paused'), { ...profiles[1]!, displays: [] })).toBe(null)
  })
})
