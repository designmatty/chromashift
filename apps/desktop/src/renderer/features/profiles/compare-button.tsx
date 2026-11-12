import { Button } from '@chakra-ui/react'
import type { CompareInput } from '@/features/profiles/hold-to-compare'

export function CompareButton({
  showingSaved,
  onPress,
  onRelease,
  disabled,
  pointerOnly = false
}: {
  showingSaved: boolean
  onPress(input: CompareInput): void
  onRelease(input?: CompareInput): Promise<void>
  disabled?: boolean
  pointerOnly?: boolean
}): React.JSX.Element {
  return (
    <Button
      size="xs"
      variant="outline"
      aria-label="Hold to compare with saved"
      aria-pressed={showingSaved}
      data-comparing={showingSaved ? 'true' : 'false'}
      bg={showingSaved ? 'fg' : undefined}
      color={showingSaved ? 'bg' : undefined}
      _hover={showingSaved ? { bg: 'fg', color: 'bg' } : undefined}
      _active={showingSaved ? { bg: 'fg', color: 'bg' } : undefined}
      disabled={disabled}
      tabIndex={pointerOnly ? -1 : undefined}
      touchAction="none"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        if (pointerOnly) event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        onPress('pointer')
      }}
      onPointerUp={() => void onRelease('pointer')}
      onPointerCancel={() => void onRelease('pointer')}
      onLostPointerCapture={() => void onRelease('pointer')}
      onKeyDown={(event) => {
        if (pointerOnly || (event.key !== ' ' && event.key !== 'Enter')) return
        event.preventDefault()
        if (!event.repeat) onPress(event.key)
      }}
      onKeyUp={(event) => {
        if (pointerOnly || (event.key !== ' ' && event.key !== 'Enter')) return
        event.preventDefault()
        void onRelease(event.key)
      }}
      onBlur={() => void onRelease()}
      onClick={(event) => event.preventDefault()}
    >
      Hold to compare
    </Button>
  )
}
