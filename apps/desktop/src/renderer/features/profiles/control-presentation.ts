import type { ActivationMode, ColorProfile } from '@chromashift/core'
import type { ProductState, ShortcutBinding } from '@shared/product-api'
import { formatShortcutAccelerator } from '@shared/shortcut-constants'
import { autoSwitchingOnHold } from '@shared/unsaved-changes'
import { liveProfile } from '@/features/profiles/app-preview-state'

type ControlStatus = ProductState['chromaShift']['status']
export function previewMarkerProfileId(session: ProductState['preview']): string | null {
  return session.state === 'active' ? session.profileId : null
}

export function useProfileKey(
  event: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  enabled: boolean,
  busy: boolean
): boolean {
  return (
    enabled &&
    !busy &&
    event.key === 'Enter' &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  )
}
type PillState = Pick<
  ProductState,
  'configuration' | 'chromaShift' | 'preview' | 'foregroundApplication'
>

export function controlPill(
  product: PillState,
  dirty = false
): {
  label: string
  palette: 'gray' | 'red' | 'yellow' | 'green'
  previewing: boolean
} {
  const status = product.chromaShift.status
  if (status !== 'active')
    return {
      label: status === 'paused' ? 'Paused' : 'Safety blocked',
      palette: status === 'paused' ? 'gray' : 'red',
      previewing: false
    }
  if (dirty || autoSwitchingOnHold(product))
    return { label: 'Auto-switching on hold', palette: 'yellow', previewing: false }
  const live = liveProfile(product)
  const preview = product.preview
  if (preview.state === 'active' && preview.profileId.toLowerCase() !== live?.id.toLowerCase()) {
    const name =
      product.configuration.profiles.find(
        (profile) => profile.id.toLowerCase() === preview.profileId.toLowerCase()
      )?.name ?? 'Profile unavailable'
    return { label: `Previewing: ${name}`, palette: 'green', previewing: true }
  }
  return {
    label:
      product.chromaShift.intendedMode.kind === 'automatic'
        ? 'Active · Automatic'
        : `Active · Manual: ${live?.name ?? 'Profile unavailable'}`,
    palette: 'green',
    previewing: false
  }
}

export function liveProfileSubtitle(status: ControlStatus, mode: ActivationMode): string {
  const state = status === 'active' ? 'Live' : status === 'paused' ? 'Paused' : 'Blocked'
  return `${state} · ${mode.kind === 'automatic' ? 'Automatic' : 'Manual'}`
}

export function liveProfileColor(status: ControlStatus): string {
  return status === 'active' ? 'profile.live' : status === 'paused' ? 'fg.muted' : 'red.fg'
}

/** Manual keeps the underlying live target, independently of the browsed preview. */
export function modeToggleDecision(
  current: ActivationMode,
  requested: ActivationMode['kind'],
  liveProfileId: string | null
): ActivationMode | null {
  if (current.kind === requested) return null
  if (requested === 'automatic') return { kind: 'automatic' }
  return liveProfileId === null ? null : { kind: 'manual', profileId: liveProfileId }
}

export function modeTooltip(
  mode: ActivationMode['kind'],
  bindings: readonly ShortcutBinding[]
): string {
  const shortcut =
    mode === 'automatic'
      ? bindings.find((binding) => binding.action.kind === 'automatic')?.accelerator
      : undefined
  const label = mode === 'automatic' ? 'Automatic' : 'Manual'
  return shortcut === undefined ? label : `${label} (${formatShortcutAccelerator(shortcut)})`
}

export function profileShortcut(
  profile: ColorProfile,
  bindings: readonly ShortcutBinding[]
): string | undefined {
  return bindings.find((binding) =>
    binding.action.kind === 'profile'
      ? binding.action.profileId.toLowerCase() === profile.id.toLowerCase()
      : binding.action.kind === 'defaultProfile' && profile.id.toLowerCase() === 'default'
  )?.accelerator
}
