import { Button, Flex, Heading, Input, Stack, Text } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PROFILE_ID } from '@chromashift/core'
import { SettingsRow } from '@/components/layout/presentational'
import type {
  ProductError,
  ProductState,
  ShortcutAction,
  ShortcutBinding
} from '../../../shared/product-api.js'
import { recordShortcut } from './shortcut-recording.js'

const builtInActions: Array<{ action: ShortcutAction; label: string; description: string }> = [
  {
    action: { kind: 'defaultProfile' },
    label: 'Default',
    description: 'Select the Default profile'
  },
  {
    action: { kind: 'previousProfile' },
    label: 'Previous profile',
    description: 'Select the previous enabled profile'
  },
  {
    action: { kind: 'nextProfile' },
    label: 'Next profile',
    description: 'Select the next enabled profile'
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
  const [draft, setDraft] = useState<ShortcutBinding[]>(() => product.settings.shortcutBindings)
  const [recording, setRecording] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (dirty) return
    setDraft(product.settings.shortcutBindings)
  }, [dirty, product.settings.shortcutBindings])

  const profiles = product.configuration.profiles.filter(
    (profile) => profile.enabled && profile.id.toLowerCase() !== DEFAULT_PROFILE_ID
  )

  function replaceBinding(action: ShortcutAction, accelerator: string | null): void {
    setDraft((current) => {
      const retained = current.filter((binding) => actionId(binding.action) !== actionId(action))
      return accelerator === null ? retained : [...retained, { action, accelerator }]
    })
    setDirty(true)
    setMessage(null)
  }

  async function save(): Promise<void> {
    setSaving(true)
    setMessage(null)
    const result = await window.chromaShift.updateSettings({
      ...product.settings,
      shortcutBindings: draft
    })
    setSaving(false)
    if (!result.ok) {
      onError(result.error)
      setMessage(result.error.message)
      return
    }
    onError(null)
    setDraft(result.value.shortcutBindings)
    setDirty(false)
    setRecording(null)
  }

  function cancel(): void {
    setDraft(product.settings.shortcutBindings)
    setDirty(false)
    setRecording(null)
    setMessage(null)
  }

  return (
    <Stack as="section" h="full" minH="full" gap="4">
      <Stack gap="1">
        <Heading as="h1" size="lg">
          Shortcuts
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          Shortcuts work globally, including while both panels are closed.
        </Text>
      </Stack>

      <ShortcutGroup
        title="Navigation"
        rows={builtInActions}
        bindings={draft}
        recording={recording}
        onRecordingChange={setRecording}
        onBindingChange={replaceBinding}
        onMessage={setMessage}
      />
      <ShortcutGroup
        title="Profiles"
        rows={profiles.map((profile) => ({
          action: { kind: 'profile' as const, profileId: profile.id },
          label: profile.name,
          description: 'Select this profile directly'
        }))}
        bindings={draft}
        recording={recording}
        onRecordingChange={setRecording}
        onBindingChange={replaceBinding}
        onMessage={setMessage}
      />

      <Text aria-live="polite" minH="5" color={message === null ? 'fg.muted' : 'fg.error'}>
        {message ?? (recording === null ? '' : 'Press Escape to cancel recording.')}
      </Text>
      <Flex gap="2" justify="flex-end" mt="auto">
        <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={cancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!dirty || saving} loading={saving} onClick={() => void save()}>
          Save shortcuts
        </Button>
      </Flex>
    </Stack>
  )
}

function ShortcutGroup({
  title,
  rows,
  bindings,
  recording,
  onRecordingChange,
  onBindingChange,
  onMessage
}: {
  title: string
  rows: Array<{ action: ShortcutAction; label: string; description: string }>
  bindings: readonly ShortcutBinding[]
  recording: string | null
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
  onRecord,
  onCancel,
  onChange,
  onMessage
}: {
  label: string
  description: string
  accelerator: string | null
  recording: boolean
  onRecord(): void
  onCancel(): void
  onChange(accelerator: string | null): void
  onMessage(message: string): void
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)

  return (
    <SettingsRow title={label} description={description}>
      <Flex gap="2" align="center">
        <Input
          ref={input}
          width="170px"
          size="sm"
          readOnly
          aria-label={`${label} shortcut`}
          value={recording ? 'Press shortcut…' : displayAccelerator(accelerator)}
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
            if (!recording) onRecord()
          }}
        />
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            onRecord()
            requestAnimationFrame(() => input.current?.focus())
          }}
        >
          {recording ? 'Recording…' : accelerator === null ? 'Record' : 'Replace'}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={accelerator === null}
          onClick={() => onChange(null)}
        >
          Clear
        </Button>
      </Flex>
    </SettingsRow>
  )
}

function actionId(action: ShortcutAction): string {
  return action.kind === 'profile' ? `profile:${action.profileId.toLowerCase()}` : action.kind
}

function displayAccelerator(accelerator: string | null): string {
  return accelerator?.replace('CommandOrControl', 'Ctrl') ?? 'Not set'
}
