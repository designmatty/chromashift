import {
  Badge,
  Box,
  Button,
  createListCollection,
  Dialog,
  Flex,
  Heading,
  Input,
  Portal,
  Select,
  Stack,
  Text
} from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, RefreshCw, Trash2 } from 'lucide-react'
import { run } from '@/lib/product-result'
import type { DiagnosticLogEntry, ProductError } from '@shared/product-api.js'
import {
  filterDiagnosticEntries,
  prettyDiagnosticDetails,
  type DiagnosticLevelFilter
} from '@/features/settings/diagnostic-entries'

const levelCollection = createListCollection<{ label: string; value: DiagnosticLevelFilter }>({
  items: [
    { label: 'All levels', value: 'all' },
    { label: 'Info', value: 'information' },
    { label: 'Warning', value: 'warning' },
    { label: 'Error', value: 'error' },
    { label: 'Critical', value: 'critical' }
  ]
})

export function DiagnosticsPanel({
  onError
}: {
  onError(error: ProductError | null): void
}): React.JSX.Element {
  const [entries, setEntries] = useState<DiagnosticLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState<'copy' | 'download' | 'clear' | null>(null)
  const [completed, setCompleted] = useState<{ action: 'copy' | 'download' } | null>(null)
  const [level, setLevel] = useState<DiagnosticLevelFilter>('all')
  const [search, setSearch] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const clearRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const visibleEntries = filterDiagnosticEntries(entries, level, search)

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
      if (value !== undefined) {
        setEntries([])
        setConfirmClear(false)
      }
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
            variant="surface"
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
            variant="surface"
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
            variant="surface"
            size="xs"
            borderRadius="full"
            loading={loading}
            disabled={sharing !== null}
            onClick={() => void refresh()}
          >
            <RefreshCw /> Refresh
          </Button>
          <Button
            ref={clearRef}
            aria-label="Clear logs"
            marginLeft="auto"
            colorPalette="red"
            variant="surface"
            size="xs"
            rounded="full"
            loading={sharing === 'clear'}
            disabled={sharing !== null || loading || entries.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 /> Clear logs
          </Button>
        </Flex>
      </Stack>
      <Flex gap="2">
        <Select.Root
          variant="subtle"
          collection={levelCollection}
          value={[level]}
          onValueChange={(details) => {
            const nextLevel = details.value[0]
            if (nextLevel !== undefined) setLevel(nextLevel as DiagnosticLevelFilter)
          }}
          size="sm"
          width="40"
          flexShrink={0}
        >
          <Select.HiddenSelect />
          <Select.Label srOnly>Log level</Select.Label>
          <Select.Control>
            <Select.Trigger
              aria-label="Log level"
              shadow="raised"
              borderColor={{ base: 'border', _dark: 'transparent' }}
            >
              <Select.ValueText />
            </Select.Trigger>
            <Select.IndicatorGroup>
              <Select.Indicator color="fg.muted" />
            </Select.IndicatorGroup>
          </Select.Control>
          <Portal>
            <Select.Positioner>
              <Select.Content borderWidth="1px" borderColor="border" color="fg">
                {levelCollection.items.map((item) => (
                  <Select.Item item={item} key={item.value}>
                    <Select.ItemText>{item.label}</Select.ItemText>
                    <Select.ItemIndicator />
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Positioner>
          </Portal>
        </Select.Root>
        <Input
          ref={searchRef}
          size="sm"
          aria-label="Search logs"
          placeholder="Search logs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Flex>
      <Text color="fg.muted" fontSize="xs">
        Showing {visibleEntries.length} of {entries.length} events. Copy and download include the
        full tail.
      </Text>
      <Stack gap="2" aria-live="polite">
        {!loading && entries.length === 0 && (
          <Text color="fg.muted">No diagnostic events are available yet.</Text>
        )}
        {!loading && entries.length > 0 && visibleEntries.length === 0 && (
          <Text color="fg.muted">No events match these filters.</Text>
        )}
        {visibleEntries.map((entry, index) => (
          <Stack
            as="article"
            key={`${entry.timestamp}-${entry.eventName}-${index}`}
            gap="1"
            px="3"
            py="2"
            rounded="lg"
            borderWidth="1px"
            borderColor={{ base: 'border', _dark: 'border.muted' }}
            borderTopColor={{ base: 'border', _dark: 'whiteAlpha.200' }}
            bg="bg.subtle"
          >
            <Flex align="center" gap="2" wrap="wrap">
              <Badge size="sm" colorPalette={levelColor(entry.level)}>
                {entry.level === 'information' ? 'Info' : entry.level}
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
                  {prettyDiagnosticDetails(entry.details)}
                </Text>
              </Box>
            )}
          </Stack>
        ))}
      </Stack>
      <Dialog.Root
        open={confirmClear}
        role="alertdialog"
        placement="center"
        size="sm"
        initialFocusEl={() => cancelRef.current}
        finalFocusEl={() => (entries.length === 0 ? searchRef.current : clearRef.current)}
        closeOnEscape={sharing !== 'clear'}
        closeOnInteractOutside={sharing !== 'clear'}
        onOpenChange={({ open }) => {
          if (sharing !== 'clear') setConfirmClear(open)
        }}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Clear logs?</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Dialog.Description>
                  This deletes all local diagnostic logs. This cannot be undone.
                </Dialog.Description>
              </Dialog.Body>
              <Dialog.Footer>
                <Button
                  ref={cancelRef}
                  variant="surface"
                  disabled={sharing === 'clear'}
                  onClick={() => setConfirmClear(false)}
                >
                  Cancel
                </Button>
                <Button
                  colorPalette="red"
                  loading={sharing === 'clear'}
                  onClick={() => void clear()}
                  variant={'solid'}
                >
                  Clear logs
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
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
