import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  IconButton,
  Input,
  Menu,
  Portal,
  Stack,
  Text
} from '@chakra-ui/react'
import { Copy, Ellipsis, EyeOff, PowerOff, ScanEye, Settings2, Trash2 } from 'lucide-react'
import { useId } from 'react'
import type { ColorProfile } from '@chromashift/core'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import type { ProductError, ProductState } from '../../../shared/product-api.js'
import { ApplicationAssignments } from './application-assignments'
import { DisplayControls } from './display-controls'

const DEFAULT_ID = 'default'

export interface ProfileDetailProps {
  profile: ColorProfile
  product: ProductState
  editing: boolean
  busy: boolean
  dirty: boolean
  previewing: boolean
  active: boolean
  expandedDisplayIds: string[]
  onExpandedDisplaysChange(displayIds: string[]): void
  onEdit(): void
  onChange(profile: ColorProfile): void
  onCancel(): void
  onSave(): void
  onPreview(): void
  onCopy(): void
  onDelete(): void
  onActiveChange(active: boolean): void
  onToggleEnabled(): void
  onError(error: ProductError | null): void
}

export function ProfileDetail(props: ProfileDetailProps): React.JSX.Element {
  const profile = props.profile
  const isDefault = profile.id.toLowerCase() === DEFAULT_ID
  const activationSwitchId = useId()
  const actionsTriggerId = useId()
  const activationDisabledReason = !profile.enabled
    ? 'Turn this profile on from More profile actions before activating it.'
    : isDefault && props.active
      ? 'Default profile remains active until you activate another profile.'
      : null
  const activationSwitch = (
    <Switch
      checked={props.active}
      disabled={activationDisabledReason !== null}
      ids={{ root: activationSwitchId }}
      onCheckedChange={(details) => props.onActiveChange(details.checked)}
      aria-label="Profile active"
    />
  )

  return (
    <Stack
      as="section"
      data-part="profile-detail"
      data-display-target-count={profile.displays.length}
    >
      <Flex as="header" align="center" gap={3}>
        {props.editing ? (
          <>
            <Input
              value={profile.name}
              variant={'subtle'}
              maxLength={65}
              maxW={'300px'}
              aria-label="Profile name"
              bg={{ base: 'bg.subtle', _dark: 'bg.emphasized' }}
              fontSize="lg"
              size={'sm'}
              fontWeight="700"
              onChange={(event) => props.onChange({ ...profile, name: event.target.value })}
            />
            {isDefault && <ProfileBadge>Default</ProfileBadge>}
            <Flex ml="auto" align="center" gap={3}>
              <Button rounded="full" variant={'surface'} size={'2xs'} onClick={props.onCancel}>
                Cancel
              </Button>
              <Button
                rounded="full"
                size={'2xs'}
                disabled={!props.dirty || props.busy || profile.name.trim().length === 0}
                onClick={props.onSave}
              >
                Save
              </Button>
            </Flex>
          </>
        ) : (
          <>
            {activationDisabledReason === null ? (
              activationSwitch
            ) : (
              <Tooltip
                ids={{ trigger: activationSwitchId }}
                content={activationDisabledReason}
                positioning={{ placement: 'bottom-start' }}
              >
                {activationSwitch}
              </Tooltip>
            )}
            <Heading as="h1" data-part="profile-name" size="lg" fontWeight="700">
              {profile.name}
            </Heading>
            {isDefault && <ProfileBadge>Default</ProfileBadge>}
            <Flex ml="auto" align="center" gap="5">
              <Tooltip content={props.previewing ? 'Stop preview' : 'Preview'}>
                <IconButton
                  variant={props.previewing ? 'subtle' : 'ghost'}
                  boxSize="20px"
                  minW="20px"
                  p="0"
                  onClick={props.onPreview}
                  aria-label={props.previewing ? 'Stop preview' : 'Preview'}
                >
                  {props.previewing ? <EyeOff /> : <ScanEye />}
                </IconButton>
              </Tooltip>
              <Tooltip content="Edit profile">
                <IconButton
                  boxSize="20px"
                  minW="20px"
                  p="0"
                  variant="ghost"
                  onClick={props.onEdit}
                  aria-label="Edit profile"
                >
                  <Settings2 />
                </IconButton>
              </Tooltip>
              <Menu.Root ids={{ trigger: actionsTriggerId }}>
                <Tooltip ids={{ trigger: actionsTriggerId }} content="More profile actions">
                  <Menu.Trigger asChild>
                    <IconButton
                      boxSize="20px"
                      minW="20px"
                      p="0"
                      variant="ghost"
                      aria-label="More profile actions"
                    >
                      <Ellipsis />
                    </IconButton>
                  </Menu.Trigger>
                </Tooltip>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content>
                      <Menu.Item value="duplicate" onClick={props.onCopy}>
                        <Copy />
                        Clone profile
                      </Menu.Item>
                      {!isDefault && (
                        <Menu.Item value="toggle" onClick={props.onToggleEnabled}>
                          <PowerOff />
                          {profile.enabled ? 'Turn off' : 'Turn on'}
                        </Menu.Item>
                      )}
                      {!isDefault && (
                        <Menu.Item value="delete" onClick={props.onDelete}>
                          <Trash2 />
                          Delete profile
                        </Menu.Item>
                      )}
                    </Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
            </Flex>
          </>
        )}
      </Flex>

      <Box as="section" pt="10px">
        <SectionHeading title="Display color controls">
          This profile activates on selected displays
        </SectionHeading>
        <DisplayControls
          profile={profile}
          product={props.product}
          editing={props.editing}
          expandedDisplayIds={props.expandedDisplayIds}
          onExpandedChange={props.onExpandedDisplaysChange}
          onChange={props.onChange}
        />
      </Box>

      <Box as="section" pt="10px">
        <SectionHeading title="Applications">
          {isDefault
            ? 'This profile activates for applications without ChromaShift assignments'
            : 'This profile activates for the selected applications'}
        </SectionHeading>
        {!isDefault && (
          <ApplicationAssignments
            profile={profile}
            editing={props.editing}
            onChange={props.onChange}
            onError={props.onError}
          />
        )}
      </Box>
    </Stack>
  )
}

function ProfileBadge({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Badge bg={'colorPalette.muted'} color={'colorPalette.fg'}>
      {children}
    </Badge>
  )
}

function SectionHeading({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Flex mb="10px" align="start" justify="space-between" gap="0" flexDir={'column'}>
      <Heading as="h2" fontSize="lg" fontWeight="500">
        {title}
      </Heading>
      <Text fontSize="sm" color={'fg.muted'}>
        {children}
      </Text>
    </Flex>
  )
}
