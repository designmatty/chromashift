import { Kbd } from '@chakra-ui/react'

export function ShortcutDisplay({
  label,
  accelerator
}: {
  label: string
  accelerator: string | null
}): React.JSX.Element | null {
  const displayKeys = acceleratorKeys(accelerator)
  if (displayKeys.length === 0) return null

  return (
    <Kbd
      data-part="shortcut-display"
      data-accelerator={accelerator ?? ''}
      aria-label={`${label} shortcut: ${displayAccelerator(accelerator)}`}
      size="sm"
      flexShrink={0}
    >
      {displayKeys.join(' + ')}
    </Kbd>
  )
}

function displayAccelerator(accelerator: string | null): string {
  return accelerator?.replace('CommandOrControl', 'Ctrl').replace('Super', 'Win') ?? 'Not set'
}

export function acceleratorKeys(accelerator: string | null): string[] {
  return accelerator === null ? [] : displayAccelerator(accelerator).split('+')
}
