import {
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Heading,
  Icon,
  IconButton,
  Input,
  Menu,
  Portal,
  Stack,
  Text
} from '@chakra-ui/react'
import {
  Copy,
  Ellipsis,
  PowerOff,
  Trash2,
  Monitor,
  AppWindow,
  Power,
  SquarePen
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { ColorProfile } from '@chromashift/core'
import { Tooltip } from '@/components/ui/tooltip'
import { useTextTruncated } from '@/hooks/use-text-truncated'
import type { ProductError, ProductState } from '@shared/product-api.js'
import { ApplicationAssignments } from '@/features/profiles/application-assignments'
import { DisplayControls } from '@/features/profiles/display-controls'

const DEFAULT_ID = 'default'

export interface ProfileDetailProps {
  profile: ColorProfile
  product: ProductState
  busy: boolean
  dirty: boolean
  startNaming?: boolean
  onNamingEnded?(): void
  onChange(profile: ColorProfile): void
  onCancel(): void
  onSave(): void
  onCopy(): void
  onDelete(): void
  onToggleEnabled(): void
  onError(error: ProductError | null): void
}

export function ProfileDetail(props: ProfileDetailProps): React.JSX.Element {
  const profile = props.profile
  const isDefault = profile.id.toLowerCase() === DEFAULT_ID
  const actionsTriggerId = useId()
  const [naming, setNaming] = useState(props.startNaming ?? false)
  const [name, setName] = useState(profile.name)
  const nameInput = useRef<HTMLInputElement>(null)
  const [titleRef, titleTruncated] = useTextTruncated<HTMLSpanElement>(profile.name)
  useEffect(() => {
    if (!naming) setName(profile.name)
  }, [profile.name, naming])
  useEffect(() => {
    if (props.startNaming) setNaming(true)
  }, [props.startNaming])
  useEffect(() => {
    if (naming) {
      nameInput.current?.focus()
      nameInput.current?.select()
    }
  }, [naming])
  function finishNaming(commit: boolean): void {
    if (!naming) return
    const next = name.trim()
    if (commit && next.length > 0 && next !== profile.name)
      props.onChange({ ...profile, name: next })
    else setName(profile.name)
    setNaming(false)
    props.onNamingEnded?.()
  }

  return (
    <Stack
      as="section"
      data-part="profile-detail"
      data-display-target-count={profile.displays.length}
    >
      <Flex as="header" align="center" gap={3}>
        {!naming && (
          <Tooltip content={profile.name} disabled={!titleTruncated}>
            <Button
              data-part="profile-title"
              variant="plain"
              px="1"
              gap="2"
              fontSize="lg"
              fontWeight="700"
              minW="0"
              maxW="300px"
              _hover={{ bg: 'bg.muted', '& [data-part="rename-icon"]': { opacity: 1 } }}
              _focusVisible={{ bg: 'bg.muted', '& [data-part="rename-icon"]': { opacity: 1 } }}
              disabled={props.busy || props.product.chromaShift.status !== 'active'}
              aria-label={`Rename ${profile.name}`}
              onClick={() => {
                setName(profile.name)
                setNaming(true)
              }}
            >
              <Text as="span" ref={titleRef} data-part="profile-title-text" minW="0" truncate>
                {profile.name}
              </Text>
              <Icon
                data-part="rename-icon"
                aria-hidden="true"
                boxSize="4"
                flexShrink="0"
                opacity="0"
                transition="opacity 120ms ease-out"
                _motionReduce={{ transition: 'none' }}
              >
                <SquarePen />
              </Icon>
            </Button>
          </Tooltip>
        )}
        <Input
          ref={nameInput}
          hidden={!naming}
          data-part="profile-name"
          value={naming ? name : profile.name}
          variant="subtle"
          maxLength={100}
          maxW="300px"
          aria-label="Profile name"
          bg={{ base: 'bg.subtle', _dark: 'bg.emphasized' }}
          fontSize="lg"
          size="sm"
          fontWeight="700"
          disabled={props.busy || props.product.chromaShift.status !== 'active'}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => finishNaming(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault()
              finishNaming(event.key === 'Enter')
            }
          }}
        />
        {isDefault && <ProfileBadge>Default</ProfileBadge>}
        {!profile.enabled && <ProfileBadge>Disabled</ProfileBadge>}
        <Flex ml="auto" align="center" gap="5">
          {props.dirty && (
            <Flex data-part="unsaved-changes-actions" gap="2" align="center">
              <Button size="xs" variant="outline" disabled={props.busy} onClick={props.onCancel}>
                Discard changes
              </Button>
              <Button
                size="xs"
                disabled={
                  props.busy ||
                  profile.name.trim().length === 0 ||
                  props.product.chromaShift.status !== 'active'
                }
                onClick={props.onSave}
              >
                Update profile
              </Button>
            </Flex>
          )}
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
                      {profile.enabled ? <PowerOff /> : <Power />}
                      {profile.enabled ? 'Disable profile' : 'Enable profile'}
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
      </Flex>

      {props.product.chromaShift.status !== 'active' && (
        <Flex align="center" gap="3" role="status">
          <Text color="fg.muted">
            {props.product.chromaShift.status === 'paused'
              ? 'ChromaShift is paused'
              : 'ChromaShift is safety blocked'}
          </Text>
          <Button
            size="xs"
            variant="outline"
            disabled={props.busy || props.product.chromaShift.transitionInProgress}
            onClick={() =>
              void window.chromaShift.controlChromaShift('resume').then((result) => {
                if (!result.ok) props.onError(result.error)
              })
            }
          >
            Resume
          </Button>
        </Flex>
      )}
      <Box as="section" pt="10px">
        <SectionHeading title="Display color controls" icon={<Monitor size={20} />}>
          Select the display you would like to change
        </SectionHeading>
        <DisplayControls
          profile={profile}
          product={props.product}
          editing={props.product.chromaShift.status === 'active' && !props.busy}
          onChange={props.onChange}
        />
      </Box>

      <Box as="section" pt="10px">
        <SectionHeading title="Applications" icon={<AppWindow size={20} />}>
          {isDefault
            ? 'Used in Automatic mode when no application profile matches'
            : profile.applications.length === 0
              ? 'No applications assigned. Add applications for automatic switching.'
              : 'Used in Automatic mode when one of these applications is active.'}
        </SectionHeading>
        {!isDefault && (
          <ApplicationAssignments
            profile={profile}
            editing={props.product.chromaShift.status === 'active' && !props.busy}
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
  icon,
  children
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Flex mb="10px" align="start" justify="space-between" gap="0" flexDir={'column'}>
      <Group>
        {icon}
        <Heading as="h2" fontSize="lg" fontWeight="500">
          {title}
        </Heading>
      </Group>
      <Text fontSize="sm" color={'fg.muted'}>
        {children}
      </Text>
    </Flex>
  )
}
