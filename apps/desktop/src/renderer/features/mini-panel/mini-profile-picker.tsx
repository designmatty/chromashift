import { Badge, Box, Flex, RadioGroup, Stack, Text } from '@chakra-ui/react'
import { ShortcutDisplay } from '@/components/ui/shortcut-display'
import { miniProfilePickerStatus } from '@/features/mini-panel/mini-profile-picker-status'
import { profileShortcut } from '@/features/profiles/control-presentation'
import { ProfileIcon } from '@/features/profiles/profile-icon'
import type { ProductState } from '@shared/product-api'
import type { ColorProfile } from '@chromashift/core'

export const AUTOMATIC_ID = '__automatic__'

export function MiniProfilePickerOptions({
  product,
  value,
  onChoose
}: {
  product: ProductState
  value: string
  onChoose(profileId: string | null): void
}): React.JSX.Element {
  const profiles = product.configuration.profiles
  const current = miniProfilePickerStatus(product)
  const disabledCount = profiles.filter((profile) => !profile.enabled).length
  return (
    <>
      <Box
        position="sticky"
        top="0"
        bg="bg.panel"
        zIndex="1"
        px="2"
        py="1"
        borderBottomWidth="1px"
        borderColor="border.muted"
      >
        <MiniProfilePickerOption
          label="Automatic"
          value={AUTOMATIC_ID}
          selected={value === AUTOMATIC_ID}
          using={current.using}
          onSelect={() => onChoose(null)}
        />
      </Box>
      <Flex gap="1" px="2" py="4" minW="0" direction="column">
        {profiles
          .filter((profile) => profile.enabled)
          .map((profile) => (
            <MiniProfilePickerOption
              key={profile.id}
              label={profile.name}
              value={profile.id}
              profile={profile}
              shortcut={profileShortcut(profile, product.settings.shortcutBindings)}
              selected={value === profile.id}
              live={current.liveProfileId === profile.id}
              onSelect={() => onChoose(profile.id)}
            />
          ))}
      </Flex>
      {(disabledCount > 0 || product.chromaShift.status === 'paused') && (
        <Stack
          position="sticky"
          bottom="0"
          bg="bg.panel"
          zIndex="1"
          gap="2"
          px="4"
          py="3"
          borderTopWidth="1px"
          borderColor="border.muted"
          color="fg.muted"
          fontSize="sm"
        >
          {disabledCount > 0 && (
            <Text data-part="disabled-profiles-count">
              {disabledCount} disabled {disabledCount === 1 ? 'profile' : 'profiles'}
            </Text>
          )}
          {product.chromaShift.status === 'paused' && (
            <Text data-part="paused-picker-hint">
              ChromaShift is paused — your choice applies when you resume
            </Text>
          )}
        </Stack>
      )}
    </>
  )
}

function MiniProfilePickerOption({
  label,
  value,
  profile,
  shortcut,
  selected,
  live = false,
  using,
  onSelect
}: {
  label: string
  value: string
  profile?: ColorProfile
  shortcut?: string
  selected: boolean
  live?: boolean
  using?: string
  onSelect(): void
}): React.JSX.Element {
  return (
    <RadioGroup.Item
      value={value}
      width="full"
      minW="0"
      alignItems="center"
      gap="3"
      fontWeight="500"
      color="fg"
      paddingX="2"
      paddingY="3"
      borderRadius="xl"
      _hover={{ bg: 'bg.muted' }}
      _checked={{ bg: 'bg.muted' }}
      onClick={selected ? onSelect : undefined}
    >
      <RadioGroup.ItemHiddenInput />
      <RadioGroup.ItemIndicator flexShrink="0" />
      {profile !== undefined && (
        <Box flexShrink="0">
          <ProfileIcon profile={profile} />
        </Box>
      )}
      <Stack gap="0" minW="0" flex="1">
        <RadioGroup.ItemText data-part="mini-profile-name" minW="0" truncate>
          {label}
        </RadioGroup.ItemText>
        {using !== undefined && (
          <Text data-part="automatic-using" fontSize="sm" color="fg.muted" truncate>
            Using: {using}
          </Text>
        )}
      </Stack>
      <Stack gap="1" align="end" flexShrink="0">
        <Flex gap="1">
          {profile?.id.toLowerCase() === 'default' && (
            <Badge size="sm" colorPalette="gray">
              Default
            </Badge>
          )}
          {live && (
            <Badge
              data-part="mini-profile-live"
              size="sm"
              bg="profile.live/12"
              color="profile.previewFg"
            >
              Live
            </Badge>
          )}
        </Flex>
        <ShortcutDisplay label={label} accelerator={shortcut ?? null} />
      </Stack>
    </RadioGroup.Item>
  )
}
