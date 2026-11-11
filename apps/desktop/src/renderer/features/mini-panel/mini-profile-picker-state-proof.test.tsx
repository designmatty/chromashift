import { ChakraProvider, RadioGroup } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import type { ProductState } from '@shared/product-api'
import { system } from '@/theme/system'
import { AUTOMATIC_ID, MiniProfilePickerOptions } from '@/features/mini-panel/mini-profile-picker'

function state(status: ProductState['chromaShift']['status'] = 'active'): ProductState {
  const profile = (id: string): ColorProfile => ({
    id,
    name: id === 'default' ? 'Default' : id,
    enabled: true,
    displays: [],
    applications: []
  })
  return {
    version: '0.1.0-preview.15',
    displays: [],
    capabilityReports: {},
    foregroundApplication: null,
    configuration: {
      schemaVersion: 3,
      settings: { defaultProfileId: 'default' },
      profiles: [profile('default'), profile('Game')]
    },
    settings: {
      schemaVersion: 2,
      launchAtStartup: false,
      launchBehavior: 'app',
      closeBehavior: 'tray',
      theme: 'system',
      notificationsEnabled: false,
      shortcutBindings: []
    },
    activation: { enabled: true, mode: { kind: 'automatic' }, currentTarget: null },
    preview: { state: 'inactive' },
    chromaShift: {
      status,
      pendingOperation: status === 'safetyBlocked' ? 'resume' : null,
      intendedMode: { kind: 'automatic' },
      intendedTarget: { kind: 'profile', profileId: 'Game' },
      transitionInProgress: false
    }
  }
}

function render(product: ProductState): string {
  return renderToStaticMarkup(
    <ChakraProvider value={system}>
      <RadioGroup.Root value={AUTOMATIC_ID}>
        <MiniProfilePickerOptions
          product={product}
          value={AUTOMATIC_ID}
          onChoose={() => undefined}
        />
      </RadioGroup.Root>
    </ChakraProvider>
  )
}

describe('review #93: report displayed state rather than intent', () => {
  it('does not describe the preserved target as Using after Pause restored Original settings', () => {
    expect(render(state('paused'))).not.toContain('Using: Game')
  })

  it('does not invent Default as Using after Automatic clears intent during a safety block', () => {
    const product = state('safetyBlocked')
    product.chromaShift.intendedTarget = null
    expect(render(product)).not.toContain('Using: Default')
  })

  it('does not mark a failed automatic target Live when no activation succeeded', () => {
    // AutomaticActivationController clears currentTarget on failed/partialFailure;
    // ChromaShiftController.recordCompletedOutcome preserves resolution as intent.
    expect(render(state())).not.toContain('data-part="mini-profile-live"')
  })

  it('keeps the override profile rather than reporting the queued automatic profile', () => {
    const product = state()
    product.activation.currentTarget = { kind: 'profile', profileId: 'Game' }
    product.activation.queuedTarget = { kind: 'profile', profileId: 'default' }
    product.preview = {
      state: 'active',
      kind: 'override',
      profileId: 'Game',
      targets: [
        {
          displayId: 'display:one',
          color: { ...createNeutralColorSettings(), brightness: 30 }
        }
      ],
      unsavedChanges: true
    }
    const html = render(product)
    expect(html).toContain('Using: Game')
    expect(html).not.toContain('Using: Default')
    expect(html.match(/data-part="mini-profile-live"/g)).toHaveLength(1)
  })

  it('hides a disabled intended profile and keeps it out of the Live rows', () => {
    const product = state()
    product.configuration.profiles[1]!.enabled = false
    const html = render(product)
    expect(html).toContain('1 disabled profile')
    expect(html).not.toContain('data-part="mini-profile-live"')
    const names = [...html.matchAll(/data-part="mini-profile-name"[^>]*>([^<]*)/g)].map(
      (match) => match[1]
    )
    expect(names).toEqual(['Automatic', 'Default'])
  })
})
