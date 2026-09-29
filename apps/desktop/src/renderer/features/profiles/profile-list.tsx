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
  Eclipse,
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
} from 'lucide-react'
import { useId, useState } from 'react'
import type { ColorProfile } from '@chromashift/core'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'

const DEFAULT_ID = 'default'

export interface ProfileListProps {
  profiles: ColorProfile[]
  selectedId: string | null
  activeId: string | null
  editingProfileId: string | null
  previewingProfileId: string | null
  automatic: boolean
  collapsed: boolean
  onCollapsedChange(collapsed: boolean): void
  onSelect(profile: ColorProfile): void
  onCreate(): void
  onToggleAutomatic(value: boolean): void
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

  return (
    <Flex
      as="aside"
      data-part="profile-nav"
      direction="column"
      gap="3"
      width={props.collapsed ? '40px' : '245px'}
      flex="none"
    >
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
        <Tooltip content="New profile" positioning={{ placement:  props.collapsed ? "right" : 'bottom-end' }}>
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
            <Plus size={16} />
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
                    active={profile.id === props.activeId}
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
        align="center"
        direction={props.collapsed ? 'column' : 'row'}
        gap={3}
        position={'sticky'}
        bottom={0}
      >
        <Tooltip
          positioning={{ placement: props.collapsed ? 'right' : undefined }}
          content={
            props.automatic
              ? 'Toggle automatic profile switching off'
              : 'Toggle automatic profile switching on'
          }
        >
          <Switch
            checked={props.automatic}
            onCheckedChange={(details) => props.onToggleAutomatic(details.checked)}
            colorPalette={'orange'}
            thumbProps={{
              css: {
                _checked: {
                  bg: {
                    base: 'orange.contrast',
                    _dark: 'fg'
                  },
                  shadow: 'none'
                }
              }
            }}
          >
            {!props.collapsed ? 'Auto switch' : null}
          </Switch>
        </Tooltip>
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
  )
}

interface ProfileListItemProps {
  profile: ColorProfile
  selected: boolean
  active: boolean
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
        onClick={props.onSelect}
      >
        <ProfileIcon profile={props.profile} />
        {props.active && (
          <Box
            boxSize={'34px'}
            position={'absolute'}
            left={props.collapsed ? undefined : -0.5}
            opacity={0.7}
            zIndex={-1}
            rounded="full"
            bg="orange.solid"
            aria-label="Active profile"
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
            {props.active && (
              <Text as="small" lineHeight={1} color="orange.solid">
                Active
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
                    <PowerOff /> {props.profile.enabled ? 'Turn off' : 'Turn on'}
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
  return props.collapsed ? <Tooltip content={props.profile.name} positioning={{ placement: 'right' }}>{item}</Tooltip> : item
}

function ProfileIcon({ profile }: { profile: ColorProfile }): React.JSX.Element {
  if (profile.id.toLowerCase() === DEFAULT_ID) {
    return (
      <ProfileIconFrame>
        <Eclipse />
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
      <Eclipse size={16} />
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
