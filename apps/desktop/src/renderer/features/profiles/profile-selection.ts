import type { ActivationMode, ColorProfile } from '@chromashift/core'
import type { ShortcutBinding } from '@shared/product-api.js'

export function profileSelectionLabel(
  profiles: readonly ColorProfile[],
  mode: ActivationMode,
  currentId: string | null
): string {
  const profileId = mode.kind === 'manual' ? mode.profileId : currentId
  const modeLabel = mode.kind === 'manual' ? 'Manual' : 'Automatic'
  if (profileId === null) return modeLabel
  const profile = profiles.find((item) => item.id.toLowerCase() === profileId.toLowerCase())
  return `${modeLabel}: ${profile?.name ?? 'Profile unavailable'}`
}

export function profileSelectionItems(
  profiles: readonly ColorProfile[],
  bindings: readonly ShortcutBinding[]
): { label: string; value: string; shortcut: string | null }[] {
  return [
    {
      label: 'Automatic',
      value: 'automatic',
      shortcut: bindings.find((binding) => binding.action.kind === 'automatic')?.accelerator ?? null
    },
    ...profiles
      .filter((profile) => profile.enabled)
      .map((profile) => ({
        label: profile.name,
        value: `profile:${profile.id}`,
        shortcut:
          bindings.find((binding) =>
            binding.action.kind === 'profile'
              ? binding.action.profileId.toLowerCase() === profile.id.toLowerCase()
              : binding.action.kind === 'defaultProfile' && profile.id.toLowerCase() === 'default'
          )?.accelerator ?? null
      }))
  ]
}
