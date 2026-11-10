import { Box, Flex, Image } from '@chakra-ui/react'
import { Palette, PowerOff } from 'lucide-react'
import type { ColorProfile } from '@chromashift/core'

const DEFAULT_ID = 'default'

/** The profile's app icon (or palette), with a badge when the profile is disabled. */
export function ProfileIcon({ profile }: { profile: ColorProfile }): React.JSX.Element {
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
