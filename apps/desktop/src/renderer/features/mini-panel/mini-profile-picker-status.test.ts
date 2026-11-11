import { describe, expect, it } from 'vitest'
import type { ProductState } from '@shared/product-api'
import { miniProfilePickerStatus } from '@/features/mini-panel/mini-profile-picker-status'

function state(
  status: ProductState['chromaShift']['status'] = 'active'
): Pick<ProductState, 'configuration' | 'chromaShift' | 'activation'> {
  return {
    configuration: {
      schemaVersion: 3,
      settings: { defaultProfileId: 'default' },
      profiles: ['default', 'Game'].map((id) => ({
        id,
        name: id === 'default' ? 'Default' : id,
        enabled: true,
        applications: [],
        displays: []
      }))
    },
    chromaShift: {
      status,
      pendingOperation: status === 'safetyBlocked' ? 'resume' : null,
      intendedMode: { kind: 'automatic' },
      intendedTarget: { kind: 'profile', profileId: 'default' },
      transitionInProgress: false
    },
    activation: {
      enabled: true,
      mode: { kind: 'automatic' },
      currentTarget: { kind: 'profile', profileId: 'Game' }
    }
  }
}

describe('mini profile picker status', () => {
  it('uses the applied profile despite different intent and a queued automatic target', () => {
    const product = state()
    product.activation.queuedTarget = { kind: 'profile', profileId: 'default' }
    expect(miniProfilePickerStatus(product)).toEqual({ using: 'Game', liveProfileId: 'Game' })
    product.chromaShift.intendedTarget = null
    expect(miniProfilePickerStatus(product)).toEqual({ using: 'Game', liveProfileId: 'Game' })
  })

  it.each(['active', 'paused', 'safetyBlocked'] as const)(
    'presents a profile target while %s',
    (status) => {
      expect(miniProfilePickerStatus(state(status))).toEqual(
        status === 'active'
          ? { using: 'Game', liveProfileId: 'Game' }
          : status === 'paused'
            ? { using: 'Original settings' }
            : {}
      )
    }
  )

  it.each(['active', 'paused', 'safetyBlocked'] as const)(
    'presents confirmed Original settings while %s',
    (status) => {
      const product = state(status)
      product.activation.currentTarget = { kind: 'baseline' }
      expect(miniProfilePickerStatus(product)).toEqual(
        status === 'safetyBlocked' ? {} : { using: 'Original settings' }
      )
    }
  )

  it.each(['active', 'paused', 'safetyBlocked'] as const)(
    'presents no confirmed activation while %s',
    (status) => {
      const product = state(status)
      product.activation.currentTarget = null
      expect(miniProfilePickerStatus(product)).toEqual(
        status === 'paused' ? { using: 'Original settings' } : {}
      )
    }
  )

  it.each(['active', 'paused', 'safetyBlocked'] as const)(
    'shows only confirmed Live in Manual mode while %s',
    (status) => {
      const product = state(status)
      product.chromaShift.intendedMode = { kind: 'manual', profileId: 'Game' }
      expect(miniProfilePickerStatus(product)).toEqual(
        status === 'active' ? { liveProfileId: 'Game' } : {}
      )
    }
  )

  it.each(['baseline', 'unconfirmed', 'disabled'] as const)(
    'omits Manual Live for %s',
    (target) => {
      const product = state()
      product.chromaShift.intendedMode = { kind: 'manual', profileId: 'Game' }
      if (target === 'disabled') product.configuration.profiles[1]!.enabled = false
      else product.activation.currentTarget = target === 'baseline' ? { kind: 'baseline' } : null
      expect(miniProfilePickerStatus(product)).toEqual({})
    }
  )

  it('matches applied profile IDs case-insensitively', () => {
    const product = state()
    product.activation.currentTarget = { kind: 'profile', profileId: 'GAME' }
    expect(miniProfilePickerStatus(product)).toEqual({ using: 'Game', liveProfileId: 'Game' })
  })

  it('does not substitute Default for an unknown applied profile', () => {
    const product = state()
    product.activation.currentTarget = { kind: 'profile', profileId: 'missing' }
    expect(miniProfilePickerStatus(product)).toEqual({})
  })

  it('does not give a disabled applied profile a Live row', () => {
    const product = state()
    product.configuration.profiles[1]!.enabled = false
    expect(miniProfilePickerStatus(product)).toEqual({ using: 'Game', liveProfileId: undefined })
  })
})
