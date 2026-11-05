import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Image,
  Menu,
  Portal,
  ScrollArea,
  Stack,
  Text
} from '@chakra-ui/react'
import {
  Copy,
  Ellipsis,
  PanelLeft,
  PanelLeftClose,
  Palette,
  Plus,
  PowerOff,
  GripVertical,
  Settings as SettingsIcon,
  Trash2,
  Power,
  Eye,
  Play
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef } from 'react'
import type { ActivationMode, ColorProfile } from '@chromashift/core'
import type { ProductState, ShortcutBinding } from '@shared/product-api'
import { Tooltip } from '@/components/ui/tooltip'
import { useTextTruncated } from '@/hooks/use-text-truncated'
import {
  liveProfileSubtitle,
  liveProfileColor,
  modeTooltip,
  profileShortcut,
  useProfileKey
} from '@/features/profiles/control-presentation'
import { formatShortcutAccelerator } from '@shared/shortcut-constants'
import { DragDropProvider, DragOverlay } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { RestrictToVerticalAxis } from '@dnd-kit/abstract/modifiers'
import {
  useProfileReorder,
  profileReorderSensors,
  profileReorderAccessibility
} from '@/features/profiles/use-profile-reorder'

const DEFAULT_ID = 'default'

export interface ProfileListProps {
  profiles: ColorProfile[]
  shortcutBindings: readonly ShortcutBinding[]
  selectedId: string | null
  currentId: string | null
  dirtyProfileId: string | null
  previewingProfileId: string | null
  mode: ActivationMode
  controlStatus: ProductState['chromaShift']['status']
  busy: boolean
  collapsed: boolean
  onCollapsedChange(collapsed: boolean): void
  onSelect(profile: ColorProfile): void
  onCreate(): void
  onModeChange(mode: ActivationMode['kind']): void
  onUseProfile(profile: ColorProfile): void
  onOpenSettings(): void
  onDuplicate(profile: ColorProfile): void
  onToggleEnabled(profile: ColorProfile): void
  onDelete(profile: ColorProfile): void
  onReorder(profileIds: string[], interactionId?: string): Promise<void>
}

export function ProfileList(props: ProfileListProps): React.JSX.Element {
  const reorder = useProfileReorder({
    ids: props.profiles.map((profile) => profile.id),
    disabled: props.busy,
    collapsed: props.collapsed,
    selectedProfileId: props.selectedId,
    previewingProfileId: props.previewingProfileId,
    onReorder: props.onReorder
  })
  const reorderInstructionsId = useId()
  const currentLabel = liveProfileSubtitle(props.controlStatus, props.mode)
  function rowProps(profile: ColorProfile, index: number): ProfileListItemProps {
    return {
      profile,
      index,
      selected: profile.id === props.selectedId,
      currentLabel:
        profile.id.toLowerCase() === props.currentId?.toLowerCase() ? currentLabel : null,
      currentColor: liveProfileColor(props.controlStatus),
      shortcut: profileShortcut(profile, props.shortcutBindings),
      busy: props.busy,
      dirty: profile.id === props.dirtyProfileId,
      previewing: profile.id === props.previewingProfileId && profile.id !== props.currentId,
      reorderDisabled: props.busy || reorder.saving || props.profiles.length < 3,
      reorderInstructionsId:
        profile.id.toLowerCase() === DEFAULT_ID ? undefined : reorderInstructionsId,
      collapsed: props.collapsed,
      onKeyDown: (event) => reorder.onKeyDown(profile.id, event),
      suppressClick: reorder.suppressClick,
      onSelect: () => props.onSelect(profile),
      onUseProfile: () => props.onUseProfile(profile),
      onDuplicate: () => props.onDuplicate(profile),
      onToggleEnabled: () => props.onToggleEnabled(profile),
      onDelete: () => props.onDelete(profile)
    }
  }

  const modeToggle = (
    <Flex
      data-part="mode-toggle"
      role="group"
      aria-label="Activation mode"
      w="full"
      p={props.collapsed ? 0 : 1}
      gap="0"
      rounded="lg"
      bg="bg.muted"
    >
      {(['automatic', 'manual'] as const).map((mode) => (
        <Tooltip
          key={mode}
          content={modeTooltip(mode, props.shortcutBindings)}
          positioning={{ placement: props.collapsed ? 'right' : 'top' }}
        >
          <Button
            data-mode={mode}
            aria-label={mode === 'automatic' ? 'Automatic' : 'Manual'}
            aria-pressed={props.mode.kind === mode}
            variant="plain"
            size="sm"
            flex="1"
            minW="0"
            px={props.collapsed ? 0 : 2}
            h="8"
            fontSize={props.collapsed ? 'xs' : 'sm'}
            rounded="md"
            bg={props.mode.kind === mode ? 'bg.panel' : 'transparent'}
            color={props.mode.kind === mode ? 'fg' : 'fg.muted'}
            _hover={{ bg: 'bg.emphasized' }}
            disabled={props.busy || (mode === 'manual' && props.currentId === null)}
            onClick={() => props.onModeChange(mode)}
          >
            {props.collapsed
              ? mode === 'automatic'
                ? 'A'
                : 'M'
              : mode === 'automatic'
                ? 'Automatic'
                : 'Manual'}
          </Button>
        </Tooltip>
      ))}
    </Flex>
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
      {modeToggle}
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
      <Text id={reorderInstructionsId} srOnly>
        Drag to reorder. On the reorder handle, press Space or Enter to pick up, use arrow keys to
        move, then Space or Enter to drop. Escape cancels. Alt and arrow keys move a profile one
        position from either button.
      </Text>
      <Text role="status" aria-live="polite" aria-atomic="true" srOnly>
        {reorder.announcement}
      </Text>
      <DragDropProvider
        sensors={profileReorderSensors}
        plugins={(defaults) => [...defaults, profileReorderAccessibility]}
        onBeforeDragStart={(event) => {
          if (props.busy || reorder.saving) event.preventDefault()
        }}
        onDragStart={reorder.onDragStart}
        onDragOver={reorder.onDragOver}
        onDragEnd={reorder.onDragEnd}
      >
        <ScrollArea.Root size={'xs'} flex="1" minH="0">
          <ScrollArea.Viewport
            ref={reorder.viewportRef}
            data-reordering={reorder.activeId !== null ? '' : undefined}
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
              },
              '&[data-reordering]': { maskImage: 'none' }
            }}
          >
            <ScrollArea.Content style={{ minWidth: 0 }}>
              <Stack data-part="profile-rows" alignContent="start" gap={3}>
                {reorder.ids.map((id, index) => {
                  const profile = props.profiles.find((profile) => profile.id === id)
                  if (profile === undefined) return null
                  return <ProfileListItem key={profile.id} {...rowProps(profile, index)} />
                })}
              </Stack>
            </ScrollArea.Content>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar />
        </ScrollArea.Root>
        <DragOverlay>
          {(source) => {
            const profile = props.profiles.find((profile) => profile.id === source.id)
            if (!profile) return null
            return (
              <Box inert aria-hidden="true">
                <ProfileListRow {...rowProps(profile, reorder.ids.indexOf(profile.id))} overlay />
              </Box>
            )
          }}
        </DragOverlay>
      </DragDropProvider>

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
  index: number
  selected: boolean
  currentLabel: string | null
  currentColor: string
  shortcut: string | undefined
  busy: boolean
  dirty: boolean
  previewing: boolean
  reorderDisabled: boolean
  reorderInstructionsId: string | undefined
  collapsed: boolean
  onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void
  suppressClick(profileId: string): boolean
  onSelect(): void
  onUseProfile(): void
  onDuplicate(): void
  onToggleEnabled(): void
  onDelete(): void
}

function ProfileListItem(props: ProfileListItemProps): React.JSX.Element {
  const isDefault = props.profile.id.toLowerCase() === DEFAULT_ID
  return isDefault ? <ProfileListRow {...props} /> : <SortableProfileListItem {...props} />
}

function SortableProfileListItem(props: ProfileListItemProps): React.JSX.Element {
  const handle = useRef<HTMLElement | null>(null)
  const wasDragging = useRef(false)
  const sortable = useSortable({
    id: props.profile.id,
    index: props.index - 1,
    disabled: props.reorderDisabled,
    data: { name: props.profile.name },
    transition: { duration: 160 },
    modifiers: [RestrictToVerticalAxis]
  })
  const { handleRef: setSortableHandle } = sortable
  const handleRef = useCallback(
    (element: Element | null) => {
      handle.current = element as HTMLElement | null
      setSortableHandle(element)
    },
    [setSortableHandle]
  )
  useEffect(() => {
    if (sortable.isDragSource) wasDragging.current = true
    else if (wasDragging.current) {
      wasDragging.current = false
      // Moving a focused node through the drag overlay can leave focus on body.
      // Restore the handle without taking focus from a different control.
      if (document.activeElement === document.body) handle.current?.focus({ preventScroll: true })
    }
  }, [sortable.isDragSource])
  return <ProfileListRow {...props} sortable={sortable} handleRef={handleRef} />
}

function ProfileListRow(
  props: ProfileListItemProps & {
    sortable?: ReturnType<typeof useSortable>
    handleRef?: (element: Element | null) => void
    overlay?: boolean
  }
): React.JSX.Element {
  const actionsTriggerId = useId()
  const rowRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (props.selected && !props.overlay) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [props.selected, props.collapsed, props.overlay])
  const isDefault = props.profile.id.toLowerCase() === DEFAULT_ID
  const { sortable } = props
  const dragging = sortable?.isDragSource ?? false

  const tooltip = [
    props.profile.name + (props.dirty ? ' • Unsaved changes' : ''),
    props.profile.enabled ? props.currentLabel : 'Disabled',
    props.previewing ? 'Previewing' : null,
    props.profile.enabled ? 'Use this profile (Shift+Enter)' : null,
    props.shortcut === undefined ? null : formatShortcutAccelerator(props.shortcut),
    props.currentLabel?.startsWith('Paused') ? 'Applies when you resume ChromaShift' : null
  ]
    .filter(Boolean)
    .join(' · ')

  const item = (
    <Flex
      ref={sortable?.ref}
      data-part="profile-item"
      data-reorder-id={props.overlay ? undefined : props.profile.id}
      data-selected={props.selected ? '' : undefined}
      data-disabled={props.profile.enabled ? undefined : ''}
      data-dragging={dragging ? '' : undefined}
      data-drag-preview={props.overlay ? '' : undefined}
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
      position="relative"
      userSelect="none"
      _hover={{ bg: 'bg.panel' }}
      _dark={{
        borderWidth: '0',
        bg: props.selected ? 'bg.muted' : 'transparent',
        _hover: {
          bg: 'bg.muted'
        }
      }}
      css={{
        '&[data-dragging]': { visibility: 'hidden' },
        '&[data-drag-preview]': {
          zIndex: 2,
          bg: 'bg.panel',
          boxShadow: 'md',
          outline: '1px solid {colors.border.emphasized}',
          transition: 'none',
          cursor: 'grabbing'
        },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        '& [data-part="profile-reorder-handle"]': {
          opacity: 0,
          transition: 'opacity 120ms ease'
        },
        '&:hover [data-part="profile-reorder-handle"], &:focus-within [data-part="profile-reorder-handle"], &[data-drag-preview] [data-part="profile-reorder-handle"]':
          { opacity: 1 },
        '& [data-part="profile-actions-trigger"] svg': {
          opacity: 0,
          transition: 'opacity 120ms ease'
        },
        '&:hover [data-part="profile-actions-trigger"] svg, &:focus-within [data-part="profile-actions-trigger"] svg, & [data-part="profile-actions-trigger"][aria-expanded="true"] svg':
          { opacity: 1 }
      }}
      className="group"
      isolation="isolate"
      onClickCapture={(event) => {
        if (event.detail > 0 && props.suppressClick(props.profile.id)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
    >
      <Tooltip
        content={tooltip}
        disabled={!props.collapsed || props.overlay}
        positioning={{ placement: 'right' }}
      >
        <Button
          ref={rowRef}
          data-part="profile-select"
          variant="plain"
          minH="30px"
          p="0"
          flex="1"
          minW="0"
          justifyContent={props.collapsed ? 'center' : 'flex-start'}
          gap={3}
          color="inherit"
          textAlign="left"
          aria-label={props.collapsed ? props.profile.name + (props.dirty ? ' •' : '') : undefined}
          aria-current={props.selected ? 'page' : undefined}
          aria-describedby={props.reorderInstructionsId}
          aria-keyshortcuts={props.profile.enabled ? 'Shift+Enter' : undefined}
          onKeyDown={(event) => {
            if (useProfileKey(event, props.profile.enabled, props.busy)) {
              event.preventDefault()
              props.onUseProfile()
            } else if (!isDefault) props.onKeyDown(event)
          }}
          onDragStart={(event) => event.preventDefault()}
          touchAction={isDefault ? undefined : 'none'}
          cursor={dragging ? 'grabbing' : undefined}
          onClick={props.onSelect}
          onDoubleClick={props.profile.enabled ? props.onUseProfile : undefined}
        >
          <Box position="relative" flex="none">
            <ProfileIcon profile={props.profile} />
            {props.previewing && (
              <Flex
                data-part="profile-preview-badge"
                aria-label="Previewing"
                position="absolute"
                left="-3px"
                top="-3px"
                boxSize="4"
                rounded="full"
                bg="bg.panel"
                color="profile.live"
                align="center"
                justify="center"
              >
                <Eye size={12} />
              </Flex>
            )}
          </Box>
          {props.collapsed && props.dirty && (
            <Text position="absolute" right="0" top="0" aria-label="Unsaved changes">
              •
            </Text>
          )}
          {props.currentLabel !== null && (
            <Box
              boxSize={'34px'}
              position={'absolute'}
              left={props.collapsed ? undefined : -0.5}
              opacity={0.7}
              zIndex={-1}
              rounded="full"
              data-part="profile-live-ring"
              bg={props.currentColor}
              aria-label={props.currentLabel}
            />
          )}
          {!props.collapsed && (
            <Flex direction="column" gap={0} flex="1" minW="0" overflow="hidden">
              <ProfileName
                name={props.profile.name}
                dirty={props.dirty}
                enabled={props.profile.enabled}
                overlay={props.overlay ?? false}
              />
              {(props.currentLabel !== null || !props.profile.enabled) && (
                <Text
                  data-part="profile-status"
                  as="small"
                  lineHeight={1}
                  color={props.profile.enabled ? props.currentColor : 'fg.muted'}
                >
                  {props.profile.enabled ? props.currentLabel : 'Disabled'}
                </Text>
              )}
            </Flex>
          )}
        </Button>
      </Tooltip>
      {!isDefault && (
        <IconButton
          ref={props.handleRef}
          srOnly={props.collapsed}
          data-part="profile-reorder-handle"
          aria-label={`Reorder ${props.profile.name}${props.dirty ? ' •' : ''}`}
          aria-describedby={props.reorderInstructionsId}
          aria-pressed={dragging}
          title="Drag to reorder"
          variant="plain"
          size="2xs"
          rounded="full"
          color="fg.muted"
          cursor={dragging ? 'grabbing' : 'grab'}
          touchAction="none"
          disabled={props.reorderDisabled}
          onKeyDown={props.onKeyDown}
        >
          <GripVertical size={14} />
        </IconButton>
      )}
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
                <Menu.Item
                  value="use"
                  disabled={!props.profile.enabled || props.busy}
                  onClick={props.onUseProfile}
                >
                  <Play /> Use this profile
                </Menu.Item>
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
                  <>
                    <Menu.Separator />
                    <Menu.Item value="delete" color="red.fg" onClick={props.onDelete}>
                      <Trash2 /> Delete
                    </Menu.Item>
                  </>
                )}
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      )}
    </Flex>
  )
  return item
}

/**
 * A single-line, ellipsis-truncated profile name. The full name appears in the
 * shared Tooltip on hover only while the name is truncated. The tooltip wraps
 * this text rather than the row button, so row focus, click, double-click, and
 * the separate reorder handle are unaffected.
 */
function ProfileName(props: {
  name: string
  dirty: boolean
  enabled: boolean
  overlay: boolean
}): React.JSX.Element {
  const label = props.name + (props.dirty ? ' •' : '')
  const [nameRef, truncated] = useTextTruncated<HTMLElement>(label)
  return (
    <Tooltip
      content={props.name}
      disabled={!truncated || props.overlay}
      positioning={{ placement: 'top-start' }}
    >
      <Text
        ref={nameRef}
        as="strong"
        data-part="profile-name-text"
        data-truncated={truncated ? '' : undefined}
        display="block"
        maxW="full"
        overflow="hidden"
        color={props.enabled ? 'inherit' : 'fg.muted'}
        fontSize="16px"
        fontWeight="500"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
      >
        {label}
      </Text>
    </Tooltip>
  )
}

function ProfileIcon({ profile }: { profile: ColorProfile }): React.JSX.Element {
  return (
    <Box position="relative">
      <Box
        filter={profile.enabled ? undefined : 'grayscale(1)'}
        opacity={profile.enabled ? 1 : 0.5}
      >
        <ProfileImage profile={profile} />
      </Box>
      {!profile.enabled && (
        <Flex
          data-part="profile-disabled-badge"
          aria-label="Disabled"
          position="absolute"
          right="-3px"
          bottom="-3px"
          boxSize="4"
          rounded="full"
          bg="bg.panel"
          color="fg.muted"
          align="center"
          justify="center"
        >
          <PowerOff size={10} />
        </Flex>
      )}
    </Box>
  )
}

function ProfileImage({ profile }: { profile: ColorProfile }): React.JSX.Element {
  if (profile.id.toLowerCase() === DEFAULT_ID) {
    return (
      <ProfileIconFrame>
        <Palette />
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

function ProfileIconFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Flex
      position="relative"
      boxSize="30px"
      flex="none"
      align="center"
      justify="center"
      overflow="visible"
      rounded="full"
      bg="bg.muted"
      color="fg"
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
