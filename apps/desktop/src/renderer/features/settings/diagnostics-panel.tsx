import { Badge, Box, Button, Flex, Heading, Stack, Text } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { run } from '@/lib/product-result'
import type { DiagnosticLogEntry, ProductError } from '../../../shared/product-api.js'

export function DiagnosticsPanel({
  onError
}: {
  onError(error: ProductError | null): void
}): React.JSX.Element {
  const [entries, setEntries] = useState<DiagnosticLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  async function refresh(): Promise<void> {
    setLoading(true)
    const value = await run(window.chromaShift.getDiagnostics(), onError)
    if (value !== undefined) setEntries(value)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <Stack as="section" gap="4">
      <Flex as="header" align="center" justify="space-between" gap="4">
        <Stack gap="0">
          <Heading as="h1" size="lg">
            Diagnostics
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            Latest events from this ChromaShift data directory
          </Text>
        </Stack>
        <Button
          aria-label="Refresh diagnostics"
          variant="outline"
          size="xs"
          borderRadius="full"
          loading={loading}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
      </Flex>
      <Stack gap="2" aria-live="polite">
        {!loading && entries.length === 0 && (
          <Text color="fg.muted">No diagnostic events are available yet.</Text>
        )}
        {entries.map((entry, index) => (
          <Stack
            as="article"
            key={`${entry.timestamp}-${entry.eventName}-${index}`}
            gap="1"
            px="3"
            py="2"
            rounded="lg"
            borderWidth="1px"
            borderColor={{ base: 'border', _dark: 'border.muted' }}
            bg="bg.subtle"
          >
            <Flex align="center" gap="2" wrap="wrap">
              <Badge size="sm" colorPalette={levelColor(entry.level)}>
                {entry.level}
              </Badge>
              <Text as="strong" fontSize="sm" fontWeight="600">
                {entry.eventName}
              </Text>
              <Text ml="auto" color="fg.muted" fontFamily="mono" fontSize="xs">
                {formatTimestamp(entry.timestamp)}
              </Text>
            </Flex>
            {entry.details.length > 0 && (
              <Box as="details">
                <Text as="summary" color="fg.muted" cursor="pointer" fontSize="xs">
                  Details
                </Text>
                <Text
                  as="pre"
                  mt="2"
                  mb="0"
                  color="fg.muted"
                  fontFamily="mono"
                  fontSize="xs"
                  overflowWrap="anywhere"
                  whiteSpace="pre-wrap"
                >
                  {entry.details}
                </Text>
              </Box>
            )}
          </Stack>
        ))}
      </Stack>
    </Stack>
  )
}

function levelColor(level: DiagnosticLogEntry['level']): string {
  if (level === 'critical' || level === 'error') return 'red'
  if (level === 'warning') return 'orange'
  return 'gray'
}

function formatTimestamp(timestamp: string): string {
  const value = new Date(timestamp)
  return Number.isNaN(value.getTime()) ? timestamp : value.toLocaleString()
}
