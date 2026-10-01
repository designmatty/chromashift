import {
  Badge,
  Box,
  Button,
  createListCollection,
  Flex,
  IconButton,
  Image,
  Listbox,
  Menu,
  Popover,
  Portal,
  Radiomark,
  ScrollArea,
  Separator,
  Stack,
  Text,
  useListbox
} from '@chakra-ui/react'
import {
  Copy,
  Ellipsis,
  PanelLeft,
  PanelLeftClose,
  Palette,
  Plus,
  PowerOff,
  Settings as SettingsIcon,
  Edit as EditIcon,
  EyeOff,
  ScanEye,
  Trash2,
  ListVideo,
  Power
} from 'lucide-react'
import { Fragment, useId, useMemo, useRef, useState } from 'react'
import type { ActivationMode, ColorProfile } from '@chromashift/core'
import type { ProductState, ShortcutBinding } from '../../../shared/product-api'
import { Tooltip } from '@/components/ui/tooltip'
import { ShortcutDisplay } from '@/components/ui/shortcut-display'
import { profileSelectionItems, profileSelectionLabel } from './profile-selection'

const DEFAULT_ID = 'default'

export interface ProfileListProps {
  profiles: ColorProfile[]
  shortcutBindings: readonly ShortcutBinding[]
  selectedId: string | null
  currentId: string | null
  editingProfileId: string | null
  previewingProfileId: string | null
  mode: ActivationMode
  controlStatus: ProductState['chromaShift']['status']
  busy: boolean
  collapsed: boolean
  onCollapsedChange(collapsed: boolean): void
  onSelect(profile: ColorProfile): void
  onCreate(): void
  onSelectionChange(profileId: string | null): void
  onOpenSettings(): void
  onEdit(profile: ColorProfile): void
  onPreview(profile: ColorProfile): void
  onDuplicate(profile: ColorProfile): void
  onToggleEnabled(profile: ColorProfile): void
  onDelete(profile: ColorProfile): void
  onReorder(profileIds: string[]): void
}

export function ProfileList(props: ProfileListProps): React.JSX.Element {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerTriggerRef = useRef<HTMLButtonElement>(null)
  const pickerContentRef = useRef<HTMLDivElement>(null)
  const pickerLabelId = useId()
  const collection = useMemo(
    () =>
      createListCollection({
        items: profileSelectionItems(props.profiles, props.shortcutBindings)
      }),
    [props.profiles, props.shortcutBindings]
  )
  const manualId = props.mode.kind === 'manual' ? props.mode.profileId : null
  const selectionValue = manualId === null ? 'automatic' : `profile:${manualId}`
  const selectionLabel = profileSelectionLabel(props.profiles, props.mode, props.currentId)
  const currentLabel = `${props.controlStatus === 'paused' ? 'Will resume' : props.controlStatus === 'safetyBlocked' ? 'Pending' : 'Current'} · ${props.mode.kind === 'automatic' ? 'Automatic' : 'Manual'}`
  const listbox = useListbox({
    collection,
    value: [selectionValue],
    defaultHighlightedValue: selectionValue,
    selectionMode: 'single',
    selectOnHighlight: false,
    deselectable: false,
    loopFocus: true,
    disabled: props.busy,
    onSelect: (details) => selectProfile(details.value)
  })

  function selectProfile(value: string): void {
    if (props.busy) return
    setPickerOpen(false)
    pickerTriggerRef.current?.focus()
    if (value === 'automatic') props.onSelectionChange(null)
    else if (value.startsWith('profile:')) props.onSelectionChange(value.slice(8))
  }

  function dropBefore(targetId: string): void {
    if (draggedId === null || draggedId === targetId) return
    const defaultProfile = props.profiles.find((profile) => profile.id.toLowerCase() === DEFAULT_ID)
    const movable = props.profiles.filter(
      (profile) => profile.id.toLowerCase() !== DEFAULT_ID && profile.id !== draggedId
    )
    const targetIndex = movable.findIndex((profile) => profile.id === targetId)
    const dragged = props.profiles.find((profile) => profile.id === draggedId)
    if (dragged === undefined || targetIndex < 0) return
    movable.splice(targetIndex, 0, dragged)
    props.onReorder([
      ...(defaultProfile === undefined ? [] : [defaultProfile.id]),
      ...movable.map((profile) => profile.id)
    ])
    setDraggedId(null)
  }

  const profileSelector = (
    <Stack gap="1.5" data-part="profile-selection">
      <Text id={pickerLabelId} textStyle="xs" fontWeight="medium" srOnly={props.collapsed}>
        Profile selection
      </Text>
      <Popover.Root
        open={pickerOpen}
        onOpenChange={(details) => {
          if (details.open && props.busy) return
          if (details.open) listbox.highlightValue(selectionValue)
          setPickerOpen(details.open)
        }}
        initialFocusEl={() => pickerContentRef.current}
        finalFocusEl={() => pickerTriggerRef.current}
        positioning={{
          placement: props.collapsed ? 'right-end' : 'top-start'
        }}
        lazyMount
        unmountOnExit
      >
        <Tooltip
          content="Profile selection"
          positioning={{ placement: 'right' }}
          disabled={!props.collapsed}
        >
          <Box>
            <Popover.Trigger asChild>
              <Button
                ref={pickerTriggerRef}
                aria-label="Profile selection"
                aria-describedby={pickerLabelId}
                variant={props.collapsed ? 'ghost' : 'outline'}
                size={props.collapsed ? 'md' : 'sm'}
                w="full"
                h="8"
                rounded="l2"
                fontWeight="normal"
                disabled={props.busy}
                px={props.collapsed ? 0 : 3}
                justifyContent={props.collapsed ? 'center' : 'space-between'}
              >
                {props.collapsed ? (
                  <ListVideo />
                ) : (
                  <>
                    <Text truncate>{selectionLabel}</Text>
                    <ListVideo />
                  </>
                )}
              </Button>
            </Popover.Trigger>
          </Box>
        </Tooltip>
        <Portal>
          <Popover.Positioner>
            <Popover.Content
              data-part="profile-selection-content"
              aria-label="Profile selection"
              w="340px"
              maxW="calc(100vw - 2rem)"
              p="1"
              rounded="2xl"
              overflow="hidden"
            >
              <Listbox.RootProvider value={listbox}>
                <Listbox.Label srOnly>Choose active profile</Listbox.Label>
                <Listbox.Content
                  ref={pickerContentRef}
                  borderWidth="0"
                  onKeyDownCapture={(event) => {
                    // Listbox only emits onSelect for a newly selected value.
                    // Explicitly reselecting the current value must also resume a pause.
                    if (
                      (event.key === 'Enter' || event.key === ' ') &&
                      !event.nativeEvent.isComposing &&
                      listbox.highlightedValue === selectionValue
                    ) {
                      event.preventDefault()
                      selectProfile(selectionValue)
                    }
                  }}
                >
                  {collection.items.map((item) => (
                    <Fragment key={item.value}>
                      <Listbox.Item
                        item={item}
                        title={item.label}
                        rounded="full"
                        flex="none"
                        px="2"
                        py="3"
                        gap="3"
                        fontWeight="700"
                        color="fg/70"
                        _hover={{ bg: 'bg.muted', color: 'fg' }}
                        _selected={{ bg: 'bg.muted', color: 'fg' }}
                        onClick={
                          item.value === selectionValue
                            ? () => selectProfile(item.value)
                            : undefined
                        }
                      >
                        <Radiomark checked={item.value === selectionValue} aria-hidden="true" />
                        <Stack direction="row" flex="1" minW="0" align="start" gap="0.5">
                          <Listbox.ItemText w="full" truncate>
                            {item.label}
                          </Listbox.ItemText>
                          <ShortcutDisplay label={item.label} accelerator={item.shortcut} />
                        </Stack>
                      </Listbox.Item>
                      {item.value === 'automatic' && collection.items.length > 1 && (
                        <Separator my="1" aria-hidden="true" borderColor={'border.muted'} />
                      )}
                    </Fragment>
                  ))}
                </Listbox.Content>
              </Listbox.RootProvider>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
    </Stack>
  )

  return (
    <Flex
      as="aside"
      data-part="profile-nav"
      direction="column"
      gap="3"
      width={props.collapsed ? '40px' : '245px'}
      flex="none"
    >
      {profileSelector}
      <Flex
        as="header"
        align="center"
        justify={props.collapsed ? 'center' : undefined}
        gap="2"
        color="fg.muted"
        flexDir={props.collapsed ? 'column' : 'row'}
      >
        {!props.collapsed && (
          <>
            <Badge aria-label={`${props.profiles.length} profiles`} rounded="full">
              {props.profiles.length}
            </Badge>
            <Text as="strong" fontWeight="500" mr={'auto'}>
              Profiles
            </Text>
          </>
        )}
        <Tooltip
          content="New profile"
          positioning={{ placement: props.collapsed ? 'right' : 'bottom-end' }}
        >
          <Button
            variant="surface"
            size="sm"
            rounded={'full'}
            height="5"
            px={1}
            minW="5"
            mt={0.5}
            gap={0.5}
            aria-label="New profile"
            onClick={props.onCreate}
          >
            New
            <Plus />
          </Button>
        </Tooltip>
      </Flex>
      <ScrollArea.Root size={'xs'}>
        <ScrollArea.Viewport
          css={{
            '--scroll-shadow-size': '4rem',
            maskImage: 'linear-gradient(#000, #000)',
            '&[data-overflow-y]': {
              maskImage:
                'linear-gradient(#000,#000,transparent 0,#000 var(--scroll-shadow-size),#000 calc(100% - var(--scroll-shadow-size)),transparent)',
              '&[data-at-top]': {
                maskImage:
                  'linear-gradient(180deg,#000 calc(100% - var(--scroll-shadow-size)),transparent)'
              },
              '&[data-at-bottom]': {
                maskImage:
                  'linear-gradient(0deg,#000 calc(100% - var(--scroll-shadow-size)),transparent)'
              }
            }
          }}
        >
          <ScrollArea.Content>
            <Stack alignContent="start" gap={3}>
              {props.profiles.map((profile) => {
                const isDefault = profile.id.toLowerCase() === DEFAULT_ID
                return (
                  <ProfileListItem
                    key={profile.id}
                    profile={profile}
                    selected={profile.id === props.selectedId}
                    currentLabel={
                      profile.id.toLowerCase() === props.currentId?.toLowerCase()
                        ? currentLabel
                        : null
                    }
                    editing={profile.id === props.editingProfileId}
                    previewing={profile.id === props.previewingProfileId}
                    dragging={draggedId === profile.id}
                    collapsed={props.collapsed}
                    onDragStart={(event) => {
                      setDraggedId(profile.id)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', profile.id)
                    }}
                    onDragEnd={() => setDraggedId(null)}
                    onDragOver={(event) => {
                      if (!isDefault && draggedId !== null) event.preventDefault()
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      dropBefore(profile.id)
                    }}
                    onSelect={() => props.onSelect(profile)}
                    onEdit={() => props.onEdit(profile)}
                    onPreview={() => props.onPreview(profile)}
                    onDuplicate={() => props.onDuplicate(profile)}
                    onToggleEnabled={() => props.onToggleEnabled(profile)}
                    onDelete={() => props.onDelete(profile)}
                  />
                )
              })}
            </Stack>
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar />
      </ScrollArea.Root>

      <Flex
        as="footer"
        data-part="profile-list-footer"
        mt="auto"
        align="stretch"
        direction="column"
        gap={3}
        position={'sticky'}
        bottom={0}
      >
        <Flex align="center" direction={props.collapsed ? 'column' : 'row'} gap={3}>
          <Tooltip
            content="Settings"
            positioning={{ placement: props.collapsed ? 'right' : 'top-end' }}
          >
            <IconButton
              variant="ghost"
              size="xs"
              ml={props.collapsed ? undefined : 'auto'}
              aria-label="Settings"
              onClick={props.onOpenSettings}
            >
              <SettingsIcon />
            </IconButton>
          </Tooltip>
          <Tooltip
            content={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            positioning={{ placement: props.collapsed ? 'right' : 'top-end' }}
          >
            <IconButton
              variant="ghost"
              size="xs"
              aria-label={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => props.onCollapsedChange(!props.collapsed)}
            >
              {props.collapsed ? <PanelLeft /> : <PanelLeftClose />}
            </IconButton>
          </Tooltip>
        </Flex>
      </Flex>
    </Flex>
  )
}

interface ProfileListItemProps {
  profile: ColorProfile
  selected: boolean
  currentLabel: string | null
  editing: boolean
  previewing: boolean
  dragging: boolean
  collapsed: boolean
  onDragStart(event: React.DragEvent<HTMLDivElement>): void
  onDragEnd(): void
  onDragOver(event: React.DragEvent<HTMLDivElement>): void
  onDrop(event: React.DragEvent<HTMLDivElement>): void
  onSelect(): void
  onEdit(): void
  onPreview(): void
  onDuplicate(): void
  onToggleEnabled(): void
  onDelete(): void
}

function ProfileListItem(props: ProfileListItemProps): React.JSX.Element {
  const actionsTriggerId = useId()
  const isDefault = props.profile.id.toLowerCase() === DEFAULT_ID

  const item = (
    <Flex
      data-part="profile-item"
      data-selected={props.selected ? '' : undefined}
      data-disabled={props.profile.enabled ? undefined : ''}
      w="full"
      h="40px"
      px={props.collapsed ? 0 : 1}
      py="5px"
      align="center"
      gap="1"
      rounded="full"
      bg={props.selected ? 'bg.panel' : 'transparent'}
      borderWidth={props.selected ? '1px' : '0'}
      borderColor="border"
      opacity={props.dragging ? '0.55' : '1'}
      _hover={{ bg: 'bg.panel' }}
      _dark={{
        borderWidth: '0',
        bg: props.selected ? 'bg.muted' : 'transparent',
        _hover: {
          bg: 'bg.muted'
        }
      }}
      css={{
        '& [data-part="profile-actions-trigger"] svg': {
          opacity: 0,
          transition: 'opacity 120ms ease'
        },
        '&:hover [data-part="profile-actions-trigger"] svg, &:focus-within [data-part="profile-actions-trigger"] svg, & [data-part="profile-actions-trigger"][aria-expanded="true"] svg':
          { opacity: 1 }
      }}
      draggable={!isDefault}
      className="group"
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      <Button
        data-part="profile-select"
        variant="plain"
        minH="30px"
        p="0"
        flex="1"
        justifyContent={props.collapsed ? 'center' : 'flex-start'}
        gap={3}
        color="inherit"
        textAlign="left"
        aria-label={props.collapsed ? props.profile.name : undefined}
        aria-current={props.selected ? 'page' : undefined}
        onClick={props.onSelect}
        css={{
          '--current-color': {
            base: 'colors.orange.solid',
            _dark: 'colors.pink.500'
          }
        }}
      >
        <ProfileIcon profile={props.profile} />
        {props.currentLabel !== null && (
          <Box
            boxSize={'34px'}
            position={'absolute'}
            left={props.collapsed ? undefined : -0.5}
            opacity={0.7}
            zIndex={-1}
            rounded="full"
            bg="var(--current-color)"
            aria-label={props.currentLabel}
          />
        )}
        {!props.collapsed && (
          <Flex direction="column" gap={0}>
            <Text
              as="strong"
              flex="1"
              overflow="hidden"
              color={props.profile.enabled ? 'inherit' : 'fg.muted'}
              fontSize="16px"
              fontWeight="500"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {props.profile.name}
            </Text>
            {(props.currentLabel !== null || !props.profile.enabled) && (
              <Text
                data-part="profile-status"
                as="small"
                lineHeight={1}
                color={props.profile.enabled ? 'var(--current-color)' : 'fg.muted'}
              >
                {props.profile.enabled ? props.currentLabel : 'Disabled'}
              </Text>
            )}
          </Flex>
        )}
      </Button>
      {!props.collapsed && (
        <Menu.Root ids={{ trigger: actionsTriggerId }} positioning={{ placement: 'right-start' }}>
          <Tooltip ids={{ trigger: actionsTriggerId }} content="Profile actions">
            <Menu.Trigger asChild>
              <IconButton
                data-part="profile-actions-trigger"
                variant="plain"
                size="2xs"
                borderRadius={'full'}
                aria-label="Profile actions"
              >
                <Ellipsis />
              </IconButton>
            </Menu.Trigger>
          </Tooltip>
          <Portal>
            <Menu.Positioner>
              <Menu.Content>
                {!props.editing && (
                  <>
                    <Menu.Item value="edit" onClick={props.onEdit}>
                      <EditIcon /> Edit
                    </Menu.Item>
                    <Menu.Item value="preview" onClick={props.onPreview}>
                      {props.previewing ? <EyeOff /> : <ScanEye />}
                      {props.previewing ? 'Stop preview' : 'Preview'}
                    </Menu.Item>
                  </>
                )}
                <Menu.Item value="clone" onClick={props.onDuplicate}>
                  <Copy /> Clone
                </Menu.Item>
                {!isDefault && (
                  <Menu.Item value="toggle" onClick={props.onToggleEnabled}>
                    {props.profile.enabled ? <PowerOff /> : <Power />}
                    {props.profile.enabled ? 'Disable profile' : 'Enable profile'}
                  </Menu.Item>
                )}
                {!isDefault && (
                  <Menu.Item value="delete" onClick={props.onDelete}>
                    <Trash2 /> Delete
                  </Menu.Item>
                )}
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      )}
    </Flex>
  )
  return props.collapsed ? (
    <Tooltip
      content={`${props.profile.name}${!props.profile.enabled ? ' · Disabled' : props.currentLabel !== null ? ` · ${props.currentLabel}` : ''}`}
      positioning={{ placement: 'right' }}
    >
      {item}
    </Tooltip>
  ) : (
    item
  )
}

function ProfileIcon({ profile }: { profile: ColorProfile }): React.JSX.Element {
  if (profile.id.toLowerCase() === DEFAULT_ID) {
    return (
      <ProfileIconFrame>
        <Palette />
      </ProfileIconFrame>
    )
  }
  if (!profile.enabled) {
    return (
      <ProfileIconFrame disabled>
        <PowerOff />
      </ProfileIconFrame>
    )
  }
  const applications = profile.applications
  if (applications.length === 0) {
    return (
      <ProfileIconFrame>
        <Palette />
      </ProfileIconFrame>
    )
  }
  const first = applications[0]
  return (
    <ProfileIconFrame>
      <ApplicationIcon rule={first} />
      {applications.length === 2 && <ApplicationIcon rule={applications[1]} secondary />}
      {applications.length > 2 && (
        <Flex
          position="absolute"
          right="-5px"
          bottom="5px"
          boxSize="20px"
          align="center"
          justify="center"
          borderWidth="1px"
          borderColor="border"
          rounded="full"
          bg="bg.inverted"
          color="fg.inverted"
          fontSize="11px"
          fontWeight="700"
        >
          +{applications.length - 1}
        </Flex>
      )}
    </ProfileIconFrame>
  )
}

function ProfileIconFrame({
  children,
  disabled = false
}: {
  children: React.ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <Flex
      position="relative"
      boxSize="30px"
      flex="none"
      align="center"
      justify="center"
      overflow="visible"
      rounded="full"
      bg={disabled ? 'fg.muted' : 'bg.muted'}
      color={disabled ? 'bg' : 'fg'}
      _light={disabled ? { bg: 'bg.panel', color: 'fg.muted' } : undefined}
    >
      {children}
    </Flex>
  )
}

function ApplicationIcon({
  rule,
  secondary = false
}: {
  rule: ColorProfile['applications'][number] | undefined
  secondary?: boolean
}): React.JSX.Element {
  return rule?.iconDataUrl === undefined ? (
    <Flex
      position={secondary ? 'absolute' : 'relative'}
      right={secondary ? '-5px' : undefined}
      bottom={secondary ? '5px' : undefined}
      boxSize={secondary ? '20px' : '30px'}
      align="center"
      justify="center"
      overflow="hidden"
      border={secondary ? '2px solid {colors.border.muted}' : '1px solid {colors.border.muted}'}
      rounded="full"
      bg="bg.emphasized"
    >
      <Palette />
    </Flex>
  ) : (
    <Image
      position={secondary ? 'absolute' : 'relative'}
      right={secondary ? '-5px' : undefined}
      bottom={secondary ? '5px' : undefined}
      boxSize={secondary ? '20px' : '30px'}
      overflow="hidden"
      border={secondary ? '2px solid {colors.border.muted}' : '1px solid {colors.border.muted}'}
      rounded="full"
      objectFit="cover"
      src={rule.iconDataUrl}
      alt={rule.executableName}
    />
  )
}
