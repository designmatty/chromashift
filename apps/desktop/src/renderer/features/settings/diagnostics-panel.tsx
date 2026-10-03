import { Badge, Box, Button, Flex, Heading, Stack, Text } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { Check, Copy, Download, RefreshCw, Trash2 } from 'lucide-react'
import { run } from '@/lib/product-result'
import type { DiagnosticLogEntry, ProductError } from '@shared/product-api.js'

export function DiagnosticsPanel({
  onError
}: {
  onError(error: ProductError | null): void
}): React.JSX.Element {
  const [entries, setEntries] = useState<DiagnosticLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState<'copy' | 'download' | 'clear' | null>(null)
  const [completed, setCompleted] = useState<{ action: 'copy' | 'download' } | null>(null)

  useEffect(() => {
    if (completed === null) return
    const timeout = window.setTimeout(() => setCompleted(null), 2000)
    return () => window.clearTimeout(timeout)
  }, [completed])

  async function refresh(): Promise<void> {
    setLoading(true)
    const value = await run(window.chromaShift.getDiagnostics(), onError)
    if (value !== undefined) setEntries(value)
    setLoading(false)
  }

  async function share(action: 'copy' | 'download'): Promise<void> {
    setSharing(action)
    setCompleted(null)
    onError(null)
    try {
      if (action === 'copy') {
        const value = await run(window.chromaShift.copyDiagnostics(), onError)
        if (value !== undefined) setCompleted({ action: 'copy' })
      } else {
        const saved = await run(window.chromaShift.downloadDiagnostics(), onError)
        if (saved) setCompleted({ action: 'download' })
      }
    } finally {
      setSharing(null)
    }
  }

  async function clear(): Promise<void> {
    setSharing('clear')
    setCompleted(null)
    onError(null)
    try {
      const value = await run(window.chromaShift.clearDiagnostics(), onError)
      if (value !== undefined) setEntries([])
    } finally {
      setSharing(null)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <Stack as="section" gap="3">
      <Stack as="header" gap="3">
        <Stack gap="0">
          <Heading as="h1" size="lg">
            Diagnostics
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            Copy or download the latest 250 events, including event details, as JSON Lines.
          </Text>
        </Stack>
        <Flex gap="2" wrap="wrap">
          <Button
            aria-label="Copy logs"
            variant="outline"
            size="xs"
            rounded="full"
            minW="28"
            loading={sharing === 'copy'}
            disabled={sharing !== null || loading || entries.length === 0}
            onClick={() => void share('copy')}
          >
            {completed?.action === 'copy' ? <Check /> : <Copy />}
            <Text as="span" aria-live="polite" aria-atomic="true">
              {completed?.action === 'copy' ? 'Copied' : 'Copy logs'}
            </Text>
          </Button>
          <Button
            aria-label="Download logs"
            variant="outline"
            size="xs"
            rounded="full"
            minW="32"
            loading={sharing === 'download'}
            disabled={sharing !== null || loading || entries.length === 0}
            onClick={() => void share('download')}
          >
            {completed?.action === 'download' ? <Check /> : <Download />}
            <Text as="span" aria-live="polite" aria-atomic="true">
              {completed?.action === 'download' ? 'Saved' : 'Download logs'}
            </Text>
          </Button>
          <Button
            aria-label="Refresh diagnostics"
            variant="outline"
            size="xs"
            borderRadius="full"
            loading={loading}
            disabled={sharing !== null}
            onClick={() => void refresh()}
          >
            <RefreshCw /> Refresh
          </Button>
          <Button
            aria-label="Clear logs"
            variant="outline"
            size="xs"
            rounded="full"
            loading={sharing === 'clear'}
            disabled={sharing !== null || loading || entries.length === 0}
            onClick={() => void clear()}
          >
            <Trash2 /> Clear logs
          </Button>
        </Flex>
      </Stack>
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
