import { Text } from '@chakra-ui/react'
import type { ColorProfile } from '@chromashift/core'
import { Tooltip } from '@/components/ui/tooltip'
import { useTextTruncated } from '@/hooks/use-text-truncated'

export function ProfileTriggerSummary({
  profile
}: {
  profile: ColorProfile
}): React.JSX.Element | null {
  const names = profile.applications.map((rule) => rule.executableName)
  const full = `Triggers: ${names.length === 0 ? 'None' : names.join(', ')}`
  const summary =
    names.length > 2 ? `Triggers: ${names.slice(0, 2).join(', ')} +${names.length - 2}` : full
  const [ref, truncated] = useTextTruncated<HTMLParagraphElement>(summary)
  if (profile.id.toLowerCase() === 'default') return null

  return (
    <Tooltip content={full} disabled={!truncated && names.length <= 2}>
      <Text
        ref={ref}
        data-part="profile-trigger-summary"
        fontSize="sm"
        color="fg.muted"
        minW="0"
        truncate
      >
        {summary}
      </Text>
    </Tooltip>
  )
}
