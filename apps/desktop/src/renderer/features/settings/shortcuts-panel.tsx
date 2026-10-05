import {
  Alert,
  Button,
  Flex,
  Heading,
  IconButton,
  Input,
  Kbd,
  Menu,
  Portal,
  Stack,
  Text
} from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PROFILE_ID } from '@chromashift/core'
import { SettingsRow } from '@/components/layout/presentational'
import { acceleratorKeys, ShortcutDisplay } from '@/components/ui/shortcut-display'
import {
  type ProductError,
  type ProductState,
  type ShortcutAction,
  type ShortcutBinding
} from '@shared/product-api.js'
import { EMERGENCY_RESTORE_ACCELERATOR } from '@shared/shortcut-constants.js'
import { recordShortcut } from '@/features/settings/shortcut-recording.js'
import { Ellipsis } from 'lucide-react'

type ShortcutRowDefinition = {
  action: ShortcutAction
  label: string
  description: string
}

const builtInActions: ShortcutRowDefinition[] = [
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

  async function replaceBinding(
    action: ShortcutAction,
    accelerator: string | null
  ): Promise<boolean> {
    if (savingRef.current) return false
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
      return false
    }
    onError(null)
    setRecording(null)
    return true
  }

  return (
    <Stack as="section" gap="4">
      <Stack gap="1">
        <Heading as="h1" size="lg">
          Shortcuts
        </Heading>
        <Stack gap="2.5">
          <Text color="fg.muted" fontSize="sm">
            Shortcuts work while ChromaShift runs in the background. Supports <Kbd>Ctrl</Kbd>,{' '}
            <Kbd>Alt</Kbd>, <Kbd>Shift</Kbd>, <Kbd>Windows</Kbd> + another key.
          </Text>
        </Stack>
      </Stack>
      {message && (
        <Alert.Root status={'warning'} size={'sm'}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{message}</Alert.Title>
          </Alert.Content>
        </Alert.Root>
      )}
      <FixedShortcutGroup
        title="Safety"
        label="Restore original display settings"
        description="Restores display settings before ChromaShift changed them"
        accelerator={EMERGENCY_RESTORE_ACCELERATOR}
      />
      <ShortcutGroup
        title="Navigation"
        rows={builtInActions}
        bindings={product.settings.shortcutBindings}
        recording={recording}
        disabled={saving}
        onRecordingChange={setRecording}
        onBindingChange={replaceBinding}
        onMessage={setMessage}
      />
      {profiles.length > 0 && (
        <ShortcutGroup
          title="Profiles"
          rows={profiles.map((profile) => ({
            action: { kind: 'profile' as const, profileId: profile.id },
            label: profile.name,
            description: 'Select this profile'
          }))}
          bindings={product.settings.shortcutBindings}
          recording={recording}
          disabled={saving}
          onRecordingChange={setRecording}
          onBindingChange={replaceBinding}
          onMessage={setMessage}
        />
      )}
    </Stack>
  )
}

function FixedShortcutGroup({
  title,
  label,
  description,
  accelerator
}: {
  title: string
  label: string
  description: string
  accelerator: string
}): React.JSX.Element {
  return (
    <Stack gap="1">
      <Heading as="h2" size="md">
        {title}
      </Heading>
      <Stack gap={0.5}>
        <SettingsRow title={label} description={description}>
          <ShortcutDisplay label={label} accelerator={accelerator} />
        </SettingsRow>
      </Stack>
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
  rows: ShortcutRowDefinition[]
  bindings: readonly ShortcutBinding[]
  recording: string | null
  disabled: boolean
  onRecordingChange(value: string | null): void
  onBindingChange(action: ShortcutAction, accelerator: string | null): Promise<boolean>
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
              onCancel={() => {
                onMessage(null)
                onRecordingChange(null)
              }}
              onChange={(accelerator) => onBindingChange(row.action, accelerator)}
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
  onChange(accelerator: string | null): Promise<boolean>
  onMessage(message: string | null): void
}): React.JSX.Element {
  const control = useRef<HTMLDivElement>(null)
  const recordButton = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const draftLabel = acceleratorKeys(draft).join(' + ')

  useEffect(() => {
    if (recording) input.current?.focus()
  }, [recording])

  function cancel(): void {
    onCancel()
    requestAnimationFrame(() => recordButton.current?.focus())
  }

  async function save(value: string | null): Promise<void> {
    if (await onChange(value)) {
      requestAnimationFrame(() => recordButton.current?.focus())
    } else {
      requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.scrollIntoView({ block: 'nearest' })
      })
    }
  }

  useEffect(() => {
    if (!recording || disabled) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      const bareKey = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
      // Keep bare Tab available for navigation; modified Tab can be a binding.
      if (event.key === 'Tab' && bareKey) return
      if (bareKey && event.key === ' ' && event.target !== input.current) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      if (bareKey && event.key === 'Enter' && draft !== null) {
        void save(draft)
        return
      }
      const result = recordShortcut(event)
      if (result.kind === 'cancel') cancel()
      else if (result.kind === 'clear') void save(null)
      else if (result.kind === 'invalid') onMessage(result.message)
      else if (result.kind === 'binding') {
        setDraft(result.accelerator)
        onMessage(null)
      }
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !control.current?.contains(event.target)) onCancel()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  })

  return (
    <SettingsRow title={label} description={description}>
      <Flex ref={control} className="group" gap="1.5" align="center" flexShrink={0}>
        {recording ? (
          <>
            <Input
              ref={input}
              aria-label={`${label} shortcut`}
              placeholder="Press shortcut"
              value={draftLabel}
              readOnly
              disabled={disabled}
              size="2xs"
              w={`${Math.max(180, draftLabel.length * 8 + 24)}px`}
              fontFamily="mono"
              order={2}
            />
            {draft !== null && (
              <Button
                size="2xs"
                aria-label={`Save ${label} shortcut`}
                disabled={disabled}
                loading={disabled}
                order={1}
                onClick={() => void save(draft)}
              >
                Save
              </Button>
            )}
          </>
        ) : (
          <>
            {accelerator !== null && (
              <Menu.Root
                open={menuOpen}
                onOpenChange={({ open }) => setMenuOpen(open)}
                positioning={{ placement: 'bottom-end' }}
              >
                <Menu.Trigger asChild>
                  <IconButton
                    aria-label={`${label} shortcut options`}
                    size="2xs"
                    variant="ghost"
                    disabled={disabled}
                    opacity={menuOpen ? 1 : 0}
                    _groupHover={{ opacity: 1 }}
                    _groupFocusWithin={{ opacity: 1 }}
                    _hover={{ bg: 'bg.emphasized' }}
                  >
                    <Ellipsis />
                  </IconButton>
                </Menu.Trigger>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content minW="160px">
                      <Menu.Item value="remove" color="fg.error" onClick={() => void save(null)}>
                        Remove shortcut
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
            )}
            <Button
              ref={recordButton}
              size="2xs"
              variant="ghost"
              px="1"
              gap="1"
              rounded="md"
              disabled={disabled}
              aria-label={`${label} shortcut`}
              _hover={{ bg: 'bg.emphasized' }}
              onClick={() => {
                setDraft(null)
                onRecord()
              }}
            >
              {accelerator === null ? (
                <Text as="span" fontSize="xs" color="fg.muted">
                  Add shortcut
                </Text>
              ) : (
                acceleratorKeys(accelerator).map((key, index) => (
                  <Kbd key={index} size="sm" data-part="shortcut-key">
                    {key}
                  </Kbd>
                ))
              )}
            </Button>
          </>
        )}
      </Flex>
    </SettingsRow>
  )
}

function actionId(action: ShortcutAction): string {
  return action.kind === 'profile' ? `profile:${action.profileId.toLowerCase()}` : action.kind
}
