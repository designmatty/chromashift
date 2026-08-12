import { Badge, Box, Button, Flex, IconButton, Menu, Portal, Stack, Text } from '@chakra-ui/react'
import { ChevronDown, ChevronUp, Copy, Trash2 } from 'lucide-react'
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
  onExpandedChange(displayId: string, expanded: boolean): void
  onChange(profile: ColorProfile): void
}): React.JSX.Element {
  const rows = buildDisplayRows(profile, product)
  if (rows.length === 0) {
    return <Text color="fg.muted">No displays are connected.</Text>
  }

  const copyTargets = rows.filter((row) => row.display !== undefined)

  return (
    <Stack gap="10px">
      {rows.map((row) => {
        const expanded = expandedDisplayIds.includes(row.displayId)
        const overridden = row.target !== undefined
        const color = row.target?.color ?? {}
        return (
          <Box as="section" data-part="display-control" minW="0" key={row.displayId}>
            <Flex
              minH="39px"
              px="10px"
              align="center"
              gap="10px"
              rounded="6px"
              bg={expanded ? 'bg.muted' : 'bg.subtle'}
            >
              {editing && (
                <Checkbox
                  checked={overridden}
                  aria-label={`Override ${row.display?.name ?? row.displayId}`}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange(setDisplayTarget(profile, { displayId: row.displayId, color: {} }))
                      onExpandedChange(row.displayId, true)
                    } else {
                      onChange(removeDisplayTarget(profile, row.displayId))
                      if (expanded) onExpandedChange(row.displayId, false)
                    }
                  }}
                />
              )}
              <Button
                type="button"
                variant="plain"
                minW="0"
                minH="39px"
                p="0"
                flex="1"
                justifyContent="flex-start"
                gap="10px"
                color={overridden ? 'inherit' : 'fg.muted'}
                textAlign="left"
                aria-expanded={expanded}
                onClick={() => onExpandedChange(row.displayId, !expanded)}
              >
                <Text
                  as="span"
                  minW="0"
                  flex="1"
                  overflow="hidden"
                  fontSize="18px"
                  fontWeight="500"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {row.display?.name ?? row.displayId}
                </Text>
                {row.display?.primary === true && (
                  <Badge
                    h="20px"
                    px="6px"
                    py="2px"
                    rounded="6px"
                    bg="badge.primaryBg"
                    color="badge.primaryFg"
                    fontSize="12px"
                    fontWeight="500"
                  >
                    Primary
                  </Badge>
                )}
                {row.display === undefined && (
                  <Badge
                    h="20px"
                    px="6px"
                    py="2px"
                    rounded="6px"
                    bg="bg.muted"
                    color="fg.muted"
                    fontSize="12px"
                    fontWeight="500"
                  >
                    Disconnected
                  </Badge>
                )}
                <Text
                  as="span"
                  minW="0"
                  overflow="hidden"
                  fontFamily="mono"
                  fontSize="14px"
                  textAlign="right"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {row.display === undefined
                    ? 'Saved settings return when this display reconnects'
                    : `${row.display.adapter.name} • ${row.display.connection}`}
                </Text>
                {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </Button>
              {editing && row.display === undefined && (
                <IconButton
                  variant="ghost"
                  size="xs"
                  aria-label={`Remove ${row.displayId}`}
                  onClick={() => {
                    onChange(removeDisplayTarget(profile, row.displayId))
                    if (expanded) onExpandedChange(row.displayId, false)
                  }}
                >
                  <Trash2 />
                </IconButton>
              )}
            </Flex>
            {expanded && (
              <Box pt="10px" px="10px">
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
              </Box>
            )}
          </Box>
        )
      })}
    </Stack>
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
          type="button"
          variant="plain"
          minH="26px"
          mt="12px"
          px="10px"
          py="5px"
          gap="10px"
          rounded="6px"
          bg="bg.muted"
          color="inherit"
          fontSize="12px"
        >
          <Copy size={16} display="none" />
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
