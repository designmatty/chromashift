import { Badge } from '@chakra-ui/react'

/**
 * Marks a display that is in HDR, in the warning palette of the HDR notice. Its
 * visible text is its only accessible name, so screen readers hear "HDR" once.
 * The app tabs and the mini panel share one compact style (owner decision).
 */
export function HdrBadge(): React.JSX.Element {
  return (
    <Badge
      data-part="hdr-badge"
      variant="outline"
      colorPalette="orange"
      flex="none"
      fontSize="10px"
      fontWeight="bold"
      minH="unset"
      px="4px"
      py="2px"
    >
      HDR
    </Badge>
  )
}
