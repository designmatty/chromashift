import { Badge, Box, Button, Flex, Menu, Portal, Tabs, Text } from '@chakra-ui/react'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createNeutralColorSettings,
  setDisplayTarget,
  type ColorProfile,
  type ColorSettings
} from '@chromashift/core'
import type { ProductState } from '../../../shared/product-api.js'
import { ColorControls } from './color-controls'
import { buildDisplayRows, type DisplayRow } from './display-rows'

const LAST_DISPLAY_KEY = 'chromashift.profile-editor.selected-display'

export function DisplayControls({
  profile,
  product,
  editing,
  onChange
}: {
  profile: ColorProfile
  product: ProductState
  editing: boolean
  onChange(profile: ColorProfile): void
}): React.JSX.Element {
  const rows = buildDisplayRows(profile, product)
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem(LAST_DISPLAY_KEY))
  const rememberedRow = rows.find((row) => row.displayId === selectedId)
  const selected =
    rememberedRow ??
    rows.find((row) => row.target !== undefined) ??
    rows.find((row) => row.display.primary) ??
    rows[0]

  useEffect(() => {
    if (selected === undefined || selected.displayId === selectedId) return
    setSelectedId(selected.displayId)
    localStorage.setItem(LAST_DISPLAY_KEY, selected.displayId)
  }, [selected?.displayId, selectedId])

  if (selected === undefined) return <Text color="fg.muted">No displays are connected.</Text>

  return (
    <Tabs.Root
      value={selected.displayId}
      variant="plain"
      onValueChange={({ value }) => {
        setSelectedId(value)
        localStorage.setItem(LAST_DISPLAY_KEY, value)
      }}
      fitted
      css={{
        '--tabs-indicator-fg': 'colors.fg.error',
        '--tabs-indicator-bg': {base: 'colors.bg.panel', _dark: 'colors.bg.muted'},
        '--tabs-trigger-radius': 'radii.md'
      }}
    >
      <Tabs.List
        overflowX="auto"
        overflowY="hidden"
        flexWrap="nowrap"
        padding={'1'}
        backgroundColor={{base: 'bg.muted', _dark: 'bg'}}
        rounded="md"
      >
        {rows.map((row) => (
          <Tabs.Trigger
            key={row.displayId}
            value={row.displayId}
            flex="none"
            gap="2"
            data-part="display-tab"
            data-display-id={row.displayId}
            _selected={{
              color: 'fg'
            }}
          >
            <Text maxW="190px" truncate as="span" color={'inherit'}>
              {row.display.name}
            </Text>
            {row.display.primary && <Badge colorPalette="blue">Primary</Badge>}
          </Tabs.Trigger>
        ))}
        <Tabs.Indicator border={'1px solid {color.red.500}'} />
      </Tabs.List>
      {rows.map((row) => {
        const color = row.target?.color ?? createNeutralColorSettings()
        return (
          <Tabs.Content
            key={row.displayId}
            value={row.displayId}
            pt="4"
            data-part="display-control"
            data-display-id={row.displayId}
          >
            <Flex align="start" gap="3" mb="4">
              <Box minW="0" flex="1">
                <Text
                  overflow="hidden"
                  color="fg.muted"
                  fontFamily="mono"
                  fontSize="xs"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {`${row.display.adapter.name} • ${row.display.connection}`}
                </Text>
              </Box>
            </Flex>
            <ColorControls
              displayId={row.displayId}
              color={color}
              product={product}
              editable={editing}
              onChange={(nextColor) =>
                onChange(setDisplayTarget(profile, { displayId: row.displayId, color: nextColor }))
              }
            />
            {editing && (
              <CopyToMenu
                profile={profile}
                sourceDisplayId={row.displayId}
                color={color}
                rows={rows}
                onChange={onChange}
              />
            )}
          </Tabs.Content>
        )
      })}
    </Tabs.Root>
  )
}

function CopyToMenu({
  profile,
  sourceDisplayId,
  color,
  rows,
  onChange
}: {
  profile: ColorProfile
  sourceDisplayId: string
  color: ColorSettings
  rows: DisplayRow[]
  onChange(profile: ColorProfile): void
}): React.JSX.Element | null {
  const others = rows.filter((row) => row.displayId !== sourceDisplayId)
  if (others.length === 0) return null

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="2xs" bg="bg" color="fg" variant={{ base: 'outline', _dark: 'solid' }} mt="3">
          Copy to
          <ChevronDown size={16} />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content>
            {others.map((row) => (
              <Menu.Item
                key={row.displayId}
                value={row.displayId}
                onClick={() =>
                  onChange(
                    setDisplayTarget(profile, {
                      displayId: row.displayId,
                      color: { ...color }
                    })
                  )
                }
              >
                {row.display.name}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
