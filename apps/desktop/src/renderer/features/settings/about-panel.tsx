import { Button, Flex, Heading, Progress, Stack, Text } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { Brand } from '@/components/layout/presentational'
import type { AppUpdateStatus } from '@shared/app-updates.js'

export function AboutPanel({ version }: { version: string }): React.JSX.Element {
  const [lastCheck, setLastCheck] = useState<AppUpdateStatus | null>(null)
  const [busy, setBusy] = useState<'check' | 'install' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.chromaShift
      .getUpdateStatus()
      .then((result) => {
        if (!cancelled && result.ok) setLastCheck(result.value)
      })
      .catch(() => {
        if (!cancelled) setError('Could not read the update status. Try checking again.')
      })
      .finally(() => {
        if (!cancelled) setInitializing(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (busy === null && lastCheck?.phase !== 'checking' && lastCheck?.phase !== 'downloading')
      return
    let cancelled = false
    const interval = window.setInterval(() => {
      void window.chromaShift
        .getUpdateStatus()
        .then((result) => {
          if (!cancelled && result.ok) setLastCheck(result.value)
        })
        .catch(() => {
          if (!cancelled) setError('Could not read update progress. Try again.')
        })
    }, 1000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [busy, lastCheck?.phase])

  async function check(): Promise<void> {
    setBusy('check')
    setError(null)
    try {
      const result = await window.chromaShift.checkForUpdates()
      if (result.ok) setLastCheck(result.value)
      else setError(result.error.message)
    } catch {
      setError('Could not check for updates. Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function install(): Promise<void> {
    setBusy('install')
    setError(null)
    try {
      const result = await window.chromaShift.installUpdate()
      if (!result.ok) setError(result.error.message)
      else if (!result.value) {
        const status = await window.chromaShift.getUpdateStatus()
        if (status.ok) setLastCheck(status.value)
      }
    } catch {
      setError('Could not install the update. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const updating =
    busy !== null ||
    lastCheck?.phase === 'checking' ||
    lastCheck?.phase === 'downloading' ||
    lastCheck?.phase === 'installing'
  const updateError = error ?? lastCheck?.error
  const message =
    updateError ??
    (busy === 'install' || lastCheck?.phase === 'installing'
      ? 'Restoring displays before installing...'
      : lastCheck?.phase === 'downloading'
        ? `Downloading version ${lastCheck.release?.version}, ${Math.round(lastCheck.percent ?? 0)}%...`
        : lastCheck?.phase === 'ready'
          ? `Version ${lastCheck.release?.version} is ready to install.`
          : busy === 'check' || lastCheck?.phase === 'checking'
            ? 'Checking for updates...'
            : lastCheck?.phase === 'up-to-date'
              ? "You're up to date."
              : lastCheck?.phase === 'available'
                ? `Version ${lastCheck.release?.version} is available. In-app installation requires an installed release.`
                : 'Check GitHub for a newer version.')

  return (
    <Stack as="section" h="full" minH="full" gap="4">
      <Flex padding={8} align="center" justify="center" css={{ '& > img': { height: '35px' } }}>
        <Brand />
      </Flex>
      <Flex
        minH="58px"
        borderRadius={'lg'}
        px="4"
        py="2"
        align="center"
        justify="space-between"
        gap="5"
        wrap="wrap"
        borderWidth="1px"
        borderColor={{ base: 'border', _dark: 'border.muted' }}
        bg={'bg.subtle'}
      >
        <Stack flex="1" minW="0" gap="1">
          <Heading as="h2" size="md">
            Version {version}
          </Heading>
          <Text
            role="status"
            aria-live="polite"
            fontSize="sm"
            color={updateError ? 'fg.error' : 'fg.muted'}
          >
            {message}
          </Text>
          {lastCheck?.checkedAt && (
            <Text fontFamily="mono" fontSize="xs" color="fg.muted">
              Last checked {new Date(lastCheck.checkedAt).toLocaleString()}
            </Text>
          )}
          {lastCheck?.phase === 'downloading' && (
            <Progress.Root value={lastCheck.percent} size="xs" aria-label="Update download">
              <Progress.Track>
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>
          )}
        </Stack>
        <Flex gap="2" wrap="wrap">
          {lastCheck?.phase === 'ready' && (
            <Button
              size="xs"
              borderRadius="full"
              disabled={initializing || updating}
              loading={busy === 'install'}
              onClick={() => void install()}
            >
              Restart and install
            </Button>
          )}
          {lastCheck?.phase !== 'ready' && (
            <Button
              size="xs"
              borderRadius="full"
              disabled={initializing || updating}
              loading={busy === 'check'}
              onClick={() => void check()}
            >
              Check for updates
            </Button>
          )}
        </Flex>
      </Flex>
      <Text fontSize="xs" color="fg.muted">
        New updates download automatically when you check. Restart and install when ready. Your
        original display settings are restored before installation.
      </Text>
    </Stack>
  )
}
