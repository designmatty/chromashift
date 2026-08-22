import { Badge, Button, Flex, Stack, Text } from '@chakra-ui/react'
import { run } from '@/lib/product-result'
import type { ProductError, ProductState } from '../../../shared/product-api.js'

export function ChromaShiftStatus({
  product,
  onError,
  compact = false
}: {
  product: ProductState
  onError(error: ProductError | null): void
  compact?: boolean
}): React.JSX.Element {
  const state = product.chromaShift
  const statusLabel =
    state.status === 'safetyBlocked'
      ? 'Safety blocked'
      : state.status === 'paused'
        ? 'Paused'
        : 'Active'
  const action = state.status === 'safetyBlocked' ? 'retry' : 'resume'

  return (
    <Flex
      data-part="chromashift-status"
      mx={compact ? '3' : '4'}
      px={compact ? '3' : '4'}
      py={compact ? '2' : '2.5'}
      gap="3"
      align="center"
      rounded="lg"
      borderWidth="1px"
      borderColor="border"
      bg="bg.subtle"
      flex="none"
    >
      <Badge
        colorPalette={
          state.status === 'active' ? 'green' : state.status === 'paused' ? 'gray' : 'red'
        }
        variant="subtle"
      >
        ChromaShift: {statusLabel}
      </Badge>
      <Stack gap="0" minW="0" flex="1">
        <Text fontSize="xs" color="fg.muted">
          Intended target
        </Text>
        <Text fontSize="sm" fontWeight="600" truncate>
          {intendedTargetLabel(product)}
        </Text>
      </Stack>
      {state.status !== 'active' && (
        <Button
          size="xs"
          variant="outline"
          disabled={state.transitionInProgress}
          loading={state.transitionInProgress}
          onClick={() => void run(window.chromaShift.controlChromaShift(action), onError)}
        >
          {state.status === 'safetyBlocked'
            ? compact
              ? 'Retry'
              : 'Retry safety check'
            : compact
              ? 'Resume'
              : 'Resume ChromaShift'}
        </Button>
      )}
    </Flex>
  )
}

function intendedTargetLabel(product: ProductState): string {
  const target = product.chromaShift.intendedTarget
  if (target === null) {
    return product.chromaShift.intendedMode.kind === 'automatic' ? 'Automatic' : 'None'
  }
  if (target.kind === 'baseline') return 'Original settings'
  return (
    product.configuration.profiles.find(
      (profile) => profile.id.toLowerCase() === target.profileId.toLowerCase()
    )?.name ?? 'Unavailable profile'
  )
}
