import { Badge } from '@chakra-ui/react'

/**
 * Marks a display that is in HDR, in the warning palette of the HDR notice. Its
 * visible text is its only accessible name, so screen readers hear "HDR" once.
 */
export function HdrBadge({ size = 'sm' }: { size?: 'xs' | 'sm' }): React.JSX.Element {
  return (
    <Badge data-part="hdr-badge" size={size} variant="outline" colorPalette="orange" flex="none">
      HDR
    </Badge>
  )
}
