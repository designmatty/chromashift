import {
  Badge,
  Box,
  Button,
  CloseButton,
  Flex,
  Heading,
  SimpleGrid,
  Stack,
  Text
} from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { RefreshCcwDot } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { formatName, run } from '@/lib/product-result'
import type { ProductError, ProductState } from '@shared/product-api.js'

export function DisplaysView({
  product,
  onError
}: {
  product: ProductState
  onError(error: ProductError | null): void
}): React.JSX.Element {
  const [restored, setRestored] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (product.chromaShift.status !== 'paused') setRestored(false)
  }, [product.chromaShift.status])
  useEffect(() => {
    if (!restored) return
    const timeout = window.setTimeout(() => setRestored(false), 10_000)
    return () => window.clearTimeout(timeout)
  }, [restored])
  async function restore(): Promise<void> {
    setBusy(true)
    try {
      if ((await run(window.chromaShift.restoreBaseline(), onError)) === undefined) return
      const state = await run(window.chromaShift.getState(), onError)
      setRestored(state?.chromaShift.status === 'paused')
    } finally {
      setBusy(false)
    }
  }
  async function resume(): Promise<void> {
    setBusy(true)
    try {
      if ((await run(window.chromaShift.controlChromaShift('resume'), onError)) !== undefined)
        setRestored(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Stack as="section" h="full" gap="4">
      <Flex as="header" align="center" justify="space-between">
        <Heading as="h1" size="lg">
          Displays
        </Heading>
        <Button
          variant="outline"
          size={'xs'}
          borderRadius={'full'}
          loading={busy}
          onClick={() => void restore()}
        >
          <RefreshCcwDot />
          Restore original display settings
        </Button>
      </Flex>
      {product.displays.map((display) => {
        const limits = product.gammaLimits?.displays[display.id.toLowerCase()]
        const hasLearnedLimits = [limits?.sdr, limits?.hdr].some(
          (mode) => mode !== undefined && Object.keys(mode.brightness).length > 0
        )
        const resetLabel = hasLearnedLimits ? 'Reset learned limits' : 'Limits reset'
        return (
          <Box key={display.id}>
            <Flex
              minH="58px"
              borderRadius={'lg'}
              px="4"
              py="2"
              align="center"
              justify="space-between"
              gap="5"
              borderWidth="1px"
              borderColor={{ base: 'border', _dark: 'border.muted' }}
              bg={'bg.subtle'}
            >
              <Box flex="1">
                <Heading
                  as="h2"
                  size={'md'}
                  overflow="hidden"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {display.name}
                </Heading>
                <Text
                  overflow="hidden"
                  fontFamily="mono"
                  fontSize="sm"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {display.adapter.name} · {display.connection} ·{' '}
                  <Tooltip content={`${display.refreshRate} Hz`}>
                    <Text as="span" tabIndex={0}>
                      {Math.round(display.refreshRate)} Hz
                    </Text>
                  </Tooltip>
                </Text>
              </Box>
              {display.primary && (
                <Badge size={'lg'} colorPalette="gray">
                  Primary
                </Badge>
              )}
            </Flex>
            <SimpleGrid p="2" columns={2} columnGap={6} rowGap={3}>
              {Object.entries(product.capabilityReports[display.id]?.capabilities ?? {})
                .filter(([name]) => name !== 'colorTemperature' || display.adapter.vendor === 'amd')
                .map(([name, capability]) => (
                  <Flex
                    gap="1"
                    direction="column"
                    alignItems="flex-start"
                    color={capability.supported ? 'fg' : 'fg.muted'}
                    key={name}
                  >
                    <Text
                      overflow="hidden"
                      fontSize="md"
                      fontWeight="500"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                    >
                      {formatName(name)}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      Controlled by:{' '}
                      <Text as="span" fontFamily="mono">
                        {capability.supported ? providerName(capability.provider) : 'Unavailable'}
                      </Text>
                    </Text>
                  </Flex>
                ))}
            </SimpleGrid>
            <Tooltip
              content="Forget the gamma limits Windows rejected on this display."
              disabled={!hasLearnedLimits}
            >
              <Button
                size="2xs"
                variant="subtle"
                bg={{ base: 'bg.muted', _dark: 'bg.emphasized' }}
                color="inherit"
                disabled={!hasLearnedLimits}
                aria-label={`${resetLabel} for ${display.name}`}
                onClick={() => void run(window.chromaShift.resetLearnedLimits(display.id), onError)}
              >
                {resetLabel}
              </Button>
            </Tooltip>
          </Box>
        )
      })}
      {restored && (
        <Flex
          role="status"
          aria-live="polite"
          position="fixed"
          bottom="4"
          right="4"
          maxW="calc(100vw - 32px)"
          align="center"
          gap="3"
          p="3"
          borderWidth="1px"
          borderColor="border"
          rounded="lg"
          bg="bg.panel"
          shadow="md"
          zIndex="toast"
        >
          <Text fontSize="sm">Display settings restored. ChromaShift is paused.</Text>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void resume()}>
            Resume
          </Button>
          <Tooltip content="Dismiss restore notification">
            <CloseButton
              size="2xs"
              aria-label="Dismiss restore notification"
              onClick={() => setRestored(false)}
            />
          </Tooltip>
        </Flex>
      )}
    </Stack>
  )
}

function providerName(provider: string): string {
  return (
    (
      {
        windows: 'Windows',
        nvidia: 'NVIDIA driver',
        amd: 'AMD driver',
        intel: 'Intel driver'
      } as Record<string, string>
    )[provider] ?? 'Unknown provider'
  )
}
