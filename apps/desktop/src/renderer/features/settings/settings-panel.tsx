import { Box, createListCollection, Heading, Portal, Select, Stack } from '@chakra-ui/react'
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
  { label: 'App panel', value: 'app' }
]
const closeItems: SelectItem<'tray' | 'shutdown'>[] = [
  { label: 'Minimize to tray', value: 'tray' },
  { label: 'Shut down ChromaShift', value: 'shutdown' }
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
    <Stack
      as="section"
      h="full"
      minH="full"
      p="20px"
      gap="17px"
      overflow="hidden"
      rounded="16px"
      bg="bg.panel"
    >
      <Heading as="h1" minH="26px" fontSize="18px" fontWeight="700" lineHeight="23px">
        General Settings
      </Heading>
      <Box overflow="hidden" rounded="6px" bg="bg.muted" css={{ '& > *': { borderRadius: 0 } }}>
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
      </Box>
      <SettingsRow title="Close behavior" description="Choose what happens when you click close">
        <SettingsSelect
          ariaLabel="Close behavior"
          value={settings.closeBehavior}
          items={closeItems}
          onChange={(closeBehavior) => update({ ...settings, closeBehavior })}
        />
      </SettingsRow>
      <SettingsRow title="Theme" description="">
        <SettingsSelect
          ariaLabel="Theme"
          value={settings.theme}
          items={themeItems}
          onChange={(theme) => update({ ...settings, theme })}
        />
      </SettingsRow>
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
      w="144px"
      flex="none"
    >
      <Select.HiddenSelect />
      <Select.Label srOnly>{ariaLabel}</Select.Label>
      <Select.Control>
        <Select.Trigger
          aria-label={ariaLabel}
          h="26px"
          minH="26px"
          px="10px"
          borderColor="border"
          rounded="6px"
          bg="bg.select"
          color="fg"
          fontSize="12px"
        >
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup pr="8px">
          <Select.Indicator color="fg.muted" />
        </Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content bg="bg.select" borderColor="border" color="fg">
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
