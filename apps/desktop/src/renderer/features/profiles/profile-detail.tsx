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
  onExpandDisplay(displayId: string, expanded: boolean): void
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
      h="full"
      minH="full"
      p="20px"
      gap="20px"
      overflow="auto"
      rounded="16px"
      bg="bg.panel"
    >
      <Flex as="header" minH="27px" align="center" gap="10px">
        {props.editing ? (
          <>
            <Input
              value={profile.name}
              maxLength={100}
              aria-label="Profile name"
              w="min(303px, 55%)"
              h="27px"
              px="10px"
              py="2px"
              border="0"
              rounded="6px"
              bg="bg.emphasized"
              color="fg"
              fontSize="18px"
              fontWeight="700"
              onChange={(event) => props.onChange({ ...profile, name: event.target.value })}
            />
            {isDefault && <ProfileBadge>Default</ProfileBadge>}
            <Flex ml="auto" align="center" gap="10px">
              <Button
                h="26px"
                minH="26px"
                px="10px"
                py="5px"
                rounded="26px"
                bg="bg.muted"
                color="fg"
                fontSize="12px"
                onClick={props.onCancel}
              >
                Cancel
              </Button>
              <Button
                h="26px"
                minH="26px"
                px="10px"
                py="5px"
                rounded="26px"
                bg="fg"
                color="bg"
                fontSize="12px"
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
              <Tooltip ids={{ trigger: activationSwitchId }} label={activationDisabledReason}>
                {activationSwitch}
              </Tooltip>
            )}
            <Heading
              as="h1"
              data-part="profile-name"
              fontSize="18px"
              fontWeight="700"
              lineHeight="23px"
            >
              {profile.name}
            </Heading>
            {isDefault && <ProfileBadge>Default</ProfileBadge>}
            <Flex ml="auto" align="center" gap="20px">
              <Tooltip label={props.previewing ? 'Stop preview' : 'Preview'}>
                <IconButton
                  variant={props.previewing ? 'subtle' : 'ghost'}
                  boxSize="20px"
                  minW="20px"
                  p="0"
                  onClick={props.onPreview}
                  aria-label={props.previewing ? 'Stop preview' : 'Preview'}
                >
                  {props.previewing ? <EyeOff size={20} /> : <ScanEye size={20} />}
                </IconButton>
              </Tooltip>
              <Tooltip label="Edit profile">
                <IconButton
                  boxSize="20px"
                  minW="20px"
                  p="0"
                  variant="ghost"
                  onClick={props.onEdit}
                  aria-label="Edit profile"
                >
                  <Settings2 size={20} />
                </IconButton>
              </Tooltip>
              <Menu.Root ids={{ trigger: actionsTriggerId }}>
                <Tooltip ids={{ trigger: actionsTriggerId }} label="More profile actions">
                  <Menu.Trigger asChild>
                    <IconButton
                      boxSize="20px"
                      minW="20px"
                      p="0"
                      variant="ghost"
                      aria-label="More profile actions"
                    >
                      <Ellipsis size={20} />
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
          onExpandedChange={props.onExpandDisplay}
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
    <Flex h="22px" mb="10px" align="center" justify="space-between" gap="12px">
      <Heading as="h2" fontSize="18px" fontWeight="500" lineHeight="23px">
        {title}
      </Heading>
      <Text
        minW="0"
        overflow="hidden"
        fontSize="14px"
        textAlign="right"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
      >
        {children}
      </Text>
    </Flex>
  )
}
