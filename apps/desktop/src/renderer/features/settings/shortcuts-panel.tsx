import { Button, Flex, Group, Heading, IconButton, Kbd, Stack, Text } from '@chakra-ui/react'
import { useRef, useState } from 'react'
import { DEFAULT_PROFILE_ID } from '@chromashift/core'
import { SettingsRow } from '@/components/layout/presentational'
import type {
  ProductError,
  ProductState,
  ShortcutAction,
  ShortcutBinding
} from '../../../shared/product-api.js'
import { recordShortcut } from './shortcut-recording.js'
import { X } from 'lucide-react'

const builtInActions: Array<{ action: ShortcutAction; label: string; description: string }> = [
  {
    action: { kind: 'defaultProfile' },
    label: 'Default',
    description: 'Selects Default profile'
  },
  {
    action: { kind: 'previousProfile' },
    label: 'Previous profile',
    description: 'Selects previous enabled profile'
  },
  {
    action: { kind: 'nextProfile' },
    label: 'Next profile',
    description: 'Selects next enabled profile'
  },
  {
    action: { kind: 'automatic' },
    label: 'Return to Automatic',
    description: 'Follow the foreground app again'
  },
  {
    action: { kind: 'toggleChromaShift' },
    label: 'Toggle ChromaShift',
    description: 'Pause or resume ChromaShift'
  }
]

export function ShortcutsPanel({
  product,
  onError
}: {
  product: ProductState
  onError(error: ProductError | null): void
}): React.JSX.Element {
  const [recording, setRecording] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const profiles = product.configuration.profiles.filter(
    (profile) => profile.enabled && profile.id.toLowerCase() !== DEFAULT_PROFILE_ID
  )

  async function replaceBinding(action: ShortcutAction, accelerator: string | null): Promise<void> {
    if (savingRef.current) return
    const retained = product.settings.shortcutBindings.filter(
      (binding) => actionId(binding.action) !== actionId(action)
    )
    const shortcutBindings =
      accelerator === null ? retained : [...retained, { action, accelerator }]
    savingRef.current = true
    setSaving(true)
    setMessage(null)
    const result = await window.chromaShift
      .updateSettings({
        ...product.settings,
        shortcutBindings
      })
      .catch((error: unknown) => ({
        ok: false as const,
        error: {
          code: 'OPERATION_FAILED' as const,
          message: error instanceof Error ? error.message : String(error)
        }
      }))
    savingRef.current = false
    setSaving(false)
    if (!result.ok) {
      onError(result.error)
      setMessage(result.error.message)
      return
    }
    onError(null)
  }

  return (
    <Stack as="section" h="full" minH="full" gap="4">
      <Stack gap="1">
        <Heading as="h1" size="lg">
          Shortcuts
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          Shortcuts save automatically and work while both panels are closed. Use Ctrl, Alt, Shift,
          or Windows with another key. Fn cannot be registered as a Windows shortcut.
        </Text>
      </Stack>

      <ShortcutGroup
        title="Navigation"
        rows={builtInActions}
        bindings={product.settings.shortcutBindings}
        recording={recording}
        disabled={saving}
        onRecordingChange={setRecording}
        onBindingChange={(action, accelerator) => void replaceBinding(action, accelerator)}
        onMessage={setMessage}
      />
      <ShortcutGroup
        title="Profiles"
        rows={profiles.map((profile) => ({
          action: { kind: 'profile' as const, profileId: profile.id },
          label: profile.name,
          description: 'Select this profile directly'
        }))}
        bindings={product.settings.shortcutBindings}
        recording={recording}
        disabled={saving}
        onRecordingChange={setRecording}
        onBindingChange={(action, accelerator) => void replaceBinding(action, accelerator)}
        onMessage={setMessage}
      />

      <Text aria-live="polite" minH="5" color={message === null ? 'fg.muted' : 'fg.error'}>
        {message ?? (recording === null ? '' : 'Press Escape to cancel recording.')}
      </Text>
    </Stack>
  )
}

function ShortcutGroup({
  title,
  rows,
  bindings,
  recording,
  disabled,
  onRecordingChange,
  onBindingChange,
  onMessage
}: {
  title: string
  rows: Array<{ action: ShortcutAction; label: string; description: string }>
  bindings: readonly ShortcutBinding[]
  recording: string | null
  disabled: boolean
  onRecordingChange(value: string | null): void
  onBindingChange(action: ShortcutAction, accelerator: string | null): void
  onMessage(value: string | null): void
}): React.JSX.Element {
  return (
    <Stack gap="1">
      <Heading as="h2" size="md">
        {title}
      </Heading>
      <Stack gap={0.5}>
        {rows.map((row) => {
          const id = actionId(row.action)
          return (
            <ShortcutRow
              key={id}
              label={row.label}
              description={row.description}
              accelerator={
                bindings.find((binding) => actionId(binding.action) === id)?.accelerator ?? null
              }
              recording={recording === id}
              disabled={disabled}
              onRecord={() => {
                onMessage(null)
                onRecordingChange(id)
              }}
              onCancel={() => onRecordingChange(null)}
              onChange={(accelerator) => {
                onBindingChange(row.action, accelerator)
                onRecordingChange(null)
              }}
              onMessage={onMessage}
            />
          )
        })}
      </Stack>
    </Stack>
  )
}

function ShortcutRow({
  label,
  description,
  accelerator,
  recording,
  disabled,
  onRecord,
  onCancel,
  onChange,
  onMessage
}: {
  label: string
  description: string
  accelerator: string | null
  recording: boolean
  disabled: boolean
  onRecord(): void
  onCancel(): void
  onChange(accelerator: string | null): void
  onMessage(message: string): void
}): React.JSX.Element {
  const recordButton = useRef<HTMLButtonElement>(null)
  const displayKeys = acceleratorKeys(accelerator)

  return (
    <SettingsRow title={label} description={description}>
      <Flex gap="2" align="center">
        <Flex
          data-part="shortcut-display"
          data-accelerator={accelerator ?? ''}
          align="center"
          gap="1"
          aria-label={`${label} shortcut: ${displayAccelerator(accelerator)}`}
        >
          {recording ? (
            <Kbd size="sm" colorPalette="blue">
              Press shortcut
            </Kbd>
          ) : displayKeys.length > 0 ? (
              <Kbd size="sm">
                {displayKeys.join(' + ')}
              </Kbd>
            ) : null
          }
        </Flex>
        <Group attached>
          <Button
            ref={recordButton}
            size="2xs"
            variant='surface'
            disabled={disabled}
            aria-label={`${label} shortcut`}
            margin={0}
            onKeyDown={(event) => {
              if (!recording) return
              event.preventDefault()
              event.stopPropagation()
              const result = recordShortcut(event)
              if (result.kind === 'cancel') onCancel()
              else if (result.kind === 'clear') onChange(null)
              else if (result.kind === 'invalid') onMessage(result.message)
              else if (result.kind === 'binding') onChange(result.accelerator)
            }}
            onClick={() => {
              if (!recording) {
                onRecord()
                requestAnimationFrame(() => recordButton.current?.focus())
              }
            }}
          >
            {recording ? 'Recording…' : 'Record'}
          </Button>
          <IconButton
            aria-label='Clear shortcut'
            size="2xs"
            variant='surface'
            disabled={disabled || accelerator === null}
            onClick={() => onChange(null)}
          >
            <X />
          </IconButton>
        </Group>
      </Flex>
    </SettingsRow>
  )
}

function actionId(action: ShortcutAction): string {
  return action.kind === 'profile' ? `profile:${action.profileId.toLowerCase()}` : action.kind
}

function displayAccelerator(accelerator: string | null): string {
  return accelerator?.replace('CommandOrControl', 'Ctrl').replace('Super', 'Win') ?? 'Not set'
}

function acceleratorKeys(accelerator: string | null): string[] {
  return accelerator === null ? [] : displayAccelerator(accelerator).split('+')
}
