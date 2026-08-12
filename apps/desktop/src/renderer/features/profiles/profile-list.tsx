import { Box, Button, Flex, IconButton, Image, Menu, Portal, Stack, Text } from '@chakra-ui/react'
import {
  AppWindow,
  Copy,
  Eclipse,
  Ellipsis,
  Palette,
  Plus,
  PowerOff,
  Settings as SettingsIcon,
  Settings2 as EditIcon,
  EyeOff,
  ScanEye,
  Trash2
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
    <Flex as="section" data-part="profile-list" h="full" minH="0" direction="column" gap="10px">
      <Flex as="header" h="20px" align="center" gap="10px" color="fg.muted" fontSize="14px">
        <Text as="strong" fontWeight="500">
          Profiles
        </Text>
        <Flex ml="auto" align="center" gap="10px">
          <Tooltip label="New profile">
            <IconButton
              variant="ghost"
              size="xs"
              boxSize="16px"
              minW="16px"
              p="0"
              aria-label="New profile"
              onClick={props.onCreate}
            >
              <Plus size={16} />
            </IconButton>
          </Tooltip>
          <Flex
            boxSize="20px"
            align="center"
            justify="center"
            rounded="full"
            bg="bg.panel"
            color="fg"
            fontSize="12px"
            fontWeight="700"
            aria-label={`${props.profiles.length} profiles`}
          >
            {props.profiles.length}
          </Flex>
        </Flex>
      </Flex>
      <Stack alignContent="start" gap="10px">
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
      <Flex
        as="footer"
        data-part="profile-list-footer"
        h="20px"
        mt="auto"
        align="center"
        gap="10px"
      >
        <Switch
          checked={props.automatic}
          onCheckedChange={(details) => props.onToggleAutomatic(details.checked)}
        >
          Auto switch
        </Switch>
        <Tooltip label="Settings">
          <IconButton
            variant="ghost"
            size="xs"
            boxSize="20px"
            minW="20px"
            ml="auto"
            p="0"
            aria-label="Settings"
            onClick={props.onOpenSettings}
          >
            <SettingsIcon size={20} />
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

  return (
    <Flex
      data-part="profile-item"
      data-selected={props.selected ? '' : undefined}
      data-disabled={props.profile.enabled ? undefined : ''}
      w="full"
      minW="0"
      h="40px"
      pl="6px"
      pr="7px"
      py="5px"
      align="center"
      gap="4px"
      rounded="33px"
      bg={props.selected ? 'bg.panel' : 'transparent'}
      borderWidth={props.selected ? '1px' : '0'}
      borderColor="border"
      opacity={props.dragging ? '0.55' : '1'}
      _hover={{ bg: 'bg.panel' }}
      _dark={{ borderWidth: '0' }}
      css={{
        '& [data-part="profile-actions-trigger"] svg': {
          opacity: 0,
          transition: 'opacity 120ms ease'
        },
        '&:hover [data-part="profile-actions-trigger"] svg, &:focus-within [data-part="profile-actions-trigger"] svg, & [data-part="profile-actions-trigger"][aria-expanded="true"] svg':
          { opacity: 1 }
      }}
      draggable={!isDefault}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      <Button
        data-part="profile-select"
        variant="plain"
        minW="0"
        minH="30px"
        p="0"
        flex="1"
        justifyContent="flex-start"
        gap="10px"
        color="inherit"
        textAlign="left"
        onClick={props.onSelect}
      >
        <ProfileIcon profile={props.profile} />
        <Text
          as="strong"
          minW="0"
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
          <Box
            boxSize="6px"
            flex="none"
            rounded="full"
            bg="accent.active"
            aria-label="Active profile"
          />
        )}
      </Button>
      <Menu.Root ids={{ trigger: actionsTriggerId }} positioning={{ placement: 'right-start' }}>
        <Tooltip ids={{ trigger: actionsTriggerId }} label="Profile actions">
          <Menu.Trigger asChild>
            <IconButton
              data-part="profile-actions-trigger"
              variant="ghost"
              size="xs"
              boxSize="16px"
              minW="16px"
              p="0"
              aria-label="Profile actions"
            >
              <Ellipsis size={16} />
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
    </Flex>
  )
}

function ProfileIcon({ profile }: { profile: ColorProfile }): React.JSX.Element {
  if (profile.id.toLowerCase() === DEFAULT_ID) {
    return (
      <ProfileIconFrame>
        <Eclipse size={20} />
      </ProfileIconFrame>
    )
  }
  if (!profile.enabled) {
    return (
      <ProfileIconFrame disabled>
        <PowerOff size={20} />
      </ProfileIconFrame>
    )
  }
  const applications = profile.applications
  if (applications.length === 0) {
    return (
      <ProfileIconFrame>
        <Palette size={20} />
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
          bottom="0"
          boxSize="20px"
          align="center"
          justify="center"
          borderWidth="1px"
          borderColor="border"
          rounded="full"
          bg="bg.panel"
          color="white"
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
      bottom={secondary ? '0' : undefined}
      boxSize={secondary ? '20px' : '30px'}
      align="center"
      justify="center"
      overflow="hidden"
      borderWidth="1px"
      borderColor="border"
      rounded="full"
      bg="bg.emphasized"
    >
      <AppWindow size={16} />
    </Flex>
  ) : (
    <Image
      position={secondary ? 'absolute' : 'relative'}
      right={secondary ? '-5px' : undefined}
      bottom={secondary ? '0' : undefined}
      boxSize={secondary ? '20px' : '30px'}
      overflow="hidden"
      borderWidth="1px"
      borderColor="border"
      rounded="full"
      objectFit="cover"
      src={rule.iconDataUrl}
      alt=""
    />
  )
}
