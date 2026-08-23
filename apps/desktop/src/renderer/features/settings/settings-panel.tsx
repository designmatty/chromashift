import { createListCollection, Heading, Portal, Select, Stack } from '@chakra-ui/react'
import { useMemo } from 'react'
import { SettingsRow } from '@/components/layout/presentational'
import { Switch } from '@/components/ui/switch'
import { run } from '@/lib/product-result'
import type { ProductError, ProductState } from '../../../shared/product-api.js'

interface SelectItem<T extends string> {
  label: string
  value: T
}

const launchItems: SelectItem<'tray' | 'app'>[] = [
  { label: 'Minimized to tray', value: 'tray' },
  { label: 'Open app panel', value: 'app' }
]
const closeItems: SelectItem<'tray' | 'shutdown'>[] = [
  { label: 'Minimize to tray', value: 'tray' },
  { label: 'Shut down app', value: 'shutdown' }
]
const themeItems: SelectItem<'system' | 'light' | 'dark'>[] = [
  { label: 'Match system', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' }
]

export function SettingsPanel({
  product,
  onError
}: {
  product: ProductState
  onError(error: ProductError | null): void
}): React.JSX.Element {
  const settings = product.settings
  const update = (next: typeof settings): void => {
    void run(window.chromaShift.updateSettings(next), onError)
  }

  return (
    <Stack as="section" h="full" minH="full" gap="4">
      <Heading as="h1" size="lg">
        General Settings
      </Heading>
      <Stack direction="column" gap={0.5}>
        <SettingsRow
          title="Launch at start up"
          description="Start ChromaShift when you sign in to Windows"
        >
          <Switch
            checked={settings.launchAtStartup}
            onCheckedChange={(details) => update({ ...settings, launchAtStartup: details.checked })}
            aria-label="Launch at startup"
          />
        </SettingsRow>
        <SettingsRow
          title="Windows startup behavior"
          description="Choose how ChromaShift appears at launch"
        >
          <SettingsSelect
            ariaLabel="Windows startup behavior"
            value={settings.launchBehavior}
            items={launchItems}
            onChange={(launchBehavior) => update({ ...settings, launchBehavior })}
          />
        </SettingsRow>
        <SettingsRow title="Close behavior" description="Choose what happens when you click close">
          <SettingsSelect
            ariaLabel="Close behavior"
            value={settings.closeBehavior}
            items={closeItems}
            onChange={(closeBehavior) => update({ ...settings, closeBehavior })}
          />
        </SettingsRow>
      </Stack>
      <Stack direction="column" gap={0.5}>
        <Heading as="h2" size="lg">
          Notifications
        </Heading>
        <SettingsRow
          title="Profile changes"
          description="Show a Windows notification when the profile changes"
        >
          <Switch
            checked={settings.profileChangeNotifications}
            onCheckedChange={(details) =>
              update({ ...settings, profileChangeNotifications: details.checked })
            }
            aria-label="Profile change notifications"
          />
        </SettingsRow>
      </Stack>
      <Stack direction="column" gap={0.5}>
        <Heading as="h1" size="lg">
          Appearance
        </Heading>
        <SettingsRow title="Theme" description="">
          <SettingsSelect
            ariaLabel="Theme"
            value={settings.theme}
            items={themeItems}
            onChange={(theme) => update({ ...settings, theme })}
          />
        </SettingsRow>
      </Stack>
    </Stack>
  )
}

function SettingsSelect<T extends string>({
  ariaLabel,
  value,
  items,
  onChange
}: {
  ariaLabel: string
  value: T
  items: SelectItem<T>[]
  onChange(value: T): void
}): React.JSX.Element {
  const collection = useMemo(() => createListCollection({ items }), [items])

  return (
    <Select.Root
      collection={collection}
      value={[value]}
      onValueChange={(details) => {
        const nextValue = details.value[0]
        if (nextValue !== undefined) onChange(nextValue as T)
      }}
      size="xs"
      maxWidth="150px"
    >
      <Select.HiddenSelect />
      <Select.Label srOnly>{ariaLabel}</Select.Label>
      <Select.Control>
        <Select.Trigger aria-label={ariaLabel} bgColor={'bg'}>
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator color="fg.muted" />
        </Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content borderWidth={'1px'} borderColor="border" color="fg">
            {collection.items.map((item) => (
              <Select.Item item={item} key={item.value}>
                <Select.ItemText>{item.label}</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  )
}
