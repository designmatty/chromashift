import {
  AbsoluteCenter,
  Accordion,
  Badge,
  Box,
  Button,
  IconButton,
  Menu,
  Portal,
  Text
} from '@chakra-ui/react'
import { ChevronDown, Trash2 } from 'lucide-react'
import {
  findDisplayTarget,
  removeDisplayTarget,
  setDisplayTarget,
  type ColorProfile,
  type ColorSettings,
  type ProfileDisplayTarget
} from '@chromashift/core'
import type { Display } from '@chromashift/native-client/protocol'
import { Checkbox } from '@/components/ui/checkbox'
import type { ProductState } from '../../../shared/product-api.js'
import { ColorControls, ColorSummary } from './color-controls'

/**
 * One row per display, connected first and then any saved-but-disconnected
 * target. Expanding a row selects that display for editing; the Edit-mode
 * checkbox controls whether this profile overrides the display at all.
 */
export interface DisplayRow {
  displayId: string
  display: Display | undefined
  target: ProfileDisplayTarget | undefined
}

export function buildDisplayRows(profile: ColorProfile, product: ProductState): DisplayRow[] {
  const connected = product.displays.map((display) => ({
    displayId: display.id,
    display,
    target: findDisplayTarget(profile, display.id) ?? undefined
  }))
  const connectedIds = new Set(product.displays.map((display) => display.id.toLowerCase()))
  const disconnected = profile.displays
    .filter((target) => !connectedIds.has(target.displayId.toLowerCase()))
    .map((target) => ({ displayId: target.displayId, display: undefined, target }))
  return [...connected, ...disconnected]
}

export function DisplayControls({
  profile,
  product,
  editing,
  expandedDisplayIds,
  onExpandedChange,
  onChange
}: {
  profile: ColorProfile
  product: ProductState
  editing: boolean
  expandedDisplayIds: string[]
  onExpandedChange(displayIds: string[]): void
  onChange(profile: ColorProfile): void
}): React.JSX.Element {
  const rows = buildDisplayRows(profile, product)
  if (rows.length === 0) {
    return <Text color="fg.muted">No displays are connected.</Text>
  }

  const copyTargets = rows.filter((row) => row.display !== undefined)

  return (
    <Accordion.Root
      value={expandedDisplayIds}
      variant="plain"
      spaceY={4}
      collapsible
      multiple
      unmountOnExit
      onValueChange={(details) => onExpandedChange(details.value)}
    >
      {rows.map((row) => {
        const expanded = expandedDisplayIds.includes(row.displayId)
        const overridden = row.target !== undefined
        const color = row.target?.color ?? {}
        return (
          <Accordion.Item
            key={row.displayId}
            value={row.displayId}
            data-part="display-control"
            data-display-id={row.displayId}
          >
            <Box position="relative" rounded="md" bg="bg.subtle">
              <Accordion.ItemTrigger
                data-display-control-trigger
                ps={editing ? '11' : '3'}
                pe={editing && row.display === undefined ? '11' : '3'}
                gap={3}
                color={overridden ? 'inherit' : 'fg.muted'}
                textAlign="left"
              >
                <Text
                  as="span"
                  flex="1"
                  overflow="hidden"
                  fontSize="18px"
                  fontWeight="500"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {row.display?.name ?? row.displayId}
                </Text>
                {row.display?.primary === true && <Badge colorPalette={'blue'}>Primary</Badge>}
                {row.display === undefined && <Badge>Disconnected</Badge>}
                <Text
                  as="span"
                  overflow="hidden"
                  fontFamily="mono"
                  fontSize="xs"
                  textAlign="right"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {row.display === undefined
                    ? 'Saved settings return when this display reconnects'
                    : `${row.display.adapter.name} • ${row.display.connection}`}
                </Text>
                <Accordion.ItemIndicator />
              </Accordion.ItemTrigger>
              {editing && (
                <AbsoluteCenter axis="vertical" insetStart="3">
                  <Checkbox
                    checked={overridden}
                    aria-label={`Override ${row.display?.name ?? row.displayId}`}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onChange(setDisplayTarget(profile, { displayId: row.displayId, color: {} }))
                        onExpandedChange([...new Set([...expandedDisplayIds, row.displayId])])
                      } else {
                        onChange(removeDisplayTarget(profile, row.displayId))
                        if (expanded) {
                          onExpandedChange(expandedDisplayIds.filter((id) => id !== row.displayId))
                        }
                      }
                    }}
                  />
                </AbsoluteCenter>
              )}
              {editing && row.display === undefined && (
                <AbsoluteCenter axis="vertical" insetEnd="2">
                  <IconButton
                    variant="ghost"
                    size="xs"
                    aria-label={`Remove ${row.displayId}`}
                    onClick={() => {
                      onChange(removeDisplayTarget(profile, row.displayId))
                      if (expanded) {
                        onExpandedChange(expandedDisplayIds.filter((id) => id !== row.displayId))
                      }
                    }}
                  >
                    <Trash2 />
                  </IconButton>
                </AbsoluteCenter>
              )}
            </Box>
            <Accordion.ItemContent>
              <Accordion.ItemBody pt="3" px="4">
                {editing && overridden ? (
                  <>
                    <ColorControls
                      profileId={profile.id}
                      displayId={row.displayId}
                      color={color}
                      lastColorValues={row.target?.lastColorValues}
                      product={product}
                      editable
                      onChange={(nextColor, lastColorValues) =>
                        onChange(
                          setDisplayTarget(profile, {
                            displayId: row.displayId,
                            color: nextColor,
                            lastColorValues
                          })
                        )
                      }
                    />
                    <CopyToMenu
                      profile={profile}
                      sourceDisplayId={row.displayId}
                      color={color}
                      lastColorValues={row.target?.lastColorValues}
                      rows={copyTargets}
                      onChange={onChange}
                    />
                  </>
                ) : editing ? (
                  <Text color="fg.muted">
                    Select this display to give it settings in this profile.
                  </Text>
                ) : (
                  <ColorSummary color={color} displayId={row.displayId} product={product} />
                )}
              </Accordion.ItemBody>
            </Accordion.ItemContent>
          </Accordion.Item>
        )
      })}
    </Accordion.Root>
  )
}

function CopyToMenu({
  profile,
  sourceDisplayId,
  color,
  lastColorValues,
  rows,
  onChange
}: {
  profile: ColorProfile
  sourceDisplayId: string
  color: ColorSettings
  lastColorValues: ColorSettings | undefined
  rows: DisplayRow[]
  onChange(profile: ColorProfile): void
}): React.JSX.Element | null {
  const others = rows.filter((row) => row.displayId !== sourceDisplayId)
  if (others.length === 0) return null

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size={'2xs'}
          bg={'bg'}
          color={'fg'}
          variant={{ base: 'outline', _dark: 'solid' }}
          mt={3}
        >
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
                      color: { ...color },
                      ...(lastColorValues === undefined
                        ? {}
                        : { lastColorValues: { ...lastColorValues } })
                    })
                  )
                }
              >
                {row.display?.name ?? row.displayId}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
