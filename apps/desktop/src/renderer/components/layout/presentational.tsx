import { Box, Button, Flex, Heading, Icon, IconButton, Image, Stack, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Palette, PanelsTopLeft, PanelTop } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import logoDark from '../../../../../../chromashift-logo-darkmode.png'
import logoLight from '../../../../../../chromashift-logo-lightmode.png'
import iconDark from '../../../../../../chromashift-icon-darkmode.png'
import iconLight from '../../../../../../chromashift-icon-lightmode.png'

export function Brand({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const source = compact
    ? { light: iconLight, dark: iconDark }
    : { light: logoLight, dark: logoDark }

  return (
    <Box position="relative" display="block" w={compact ? '22px' : '143px'} h="22px" flex="none">
      <Image
        position="absolute"
        inset="0"
        boxSize="full"
        objectFit="contain"
        src={source.light}
        alt="chromashift"
        _dark={{ display: 'none' }}
      />
      <Image
        position="absolute"
        inset="0"
        boxSize="full"
        objectFit="contain"
        src={source.dark}
        alt=""
        display="none"
        _dark={{ display: 'block' }}
      />
    </Box>
  )
}

/**
 * Draws the title-bar content inside the region Windows leaves free. The bar is
 * a drag region; interactive children opt out with `no-drag` so the native
 * caption buttons, keyboard handling, DPI scaling, and Snap behavior are intact.
 */
export function TitleBar({ children }: { children?: ReactNode }): React.JSX.Element {
  return (
    <Flex
      as="header"
      data-part="title-bar"
      position="relative"
      w="full"
      h="41px"
      px="10px"
      align="center"
      css={{ WebkitAppRegion: 'drag' }}
      _dark={{ h: '37px' }}
    >
      <Brand />
      <PanelViewToggle />
      {children !== undefined && (
        <Flex ml="auto" align="center" gap="10px" css={{ WebkitAppRegion: 'no-drag' }}>
          {children}
        </Flex>
      )}
    </Flex>
  )
}

/** Switches between the app panel and the mini panel (Figma 35:1609). */
export function PanelViewToggle({ mini = false }: { mini?: boolean }): React.JSX.Element {
  return (
    <Flex
      data-part="panel-toggle"
      position="absolute"
      top={mini ? '5px' : '0'}
      left={mini ? '50%' : 'calc(50% + 12px)'}
      transform="translateX(-50%)"
      h="32px"
      p="4px"
      align="center"
      gap="6px"
      borderWidth="1px"
      borderColor="border"
      rounded="6px"
      bg="bg.panel"
      css={{ WebkitAppRegion: 'no-drag' }}
    >
      <Tooltip label="App panel">
        <IconButton
          variant={mini ? 'ghost' : 'subtle'}
          size="xs"
          aria-label="App panel"
          aria-pressed={!mini}
          onClick={() => void window.chromaShift.openAppPanel('profiles')}
          boxSize="24px"
          minW="24px"
          p="4px"
          rounded="4px"
          _pressed={{ bg: 'control.active' }}
        >
          <PanelsTopLeft size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip label="Mini panel">
        <IconButton
          variant={mini ? 'subtle' : 'ghost'}
          size="xs"
          aria-label="Mini panel"
          aria-pressed={mini}
          onClick={() => void window.chromaShift.showMiniPanel()}
          disabled={mini}
          boxSize="24px"
          minW="24px"
          p="4px"
          rounded="4px"
          _pressed={{ bg: 'control.active' }}
        >
          <PanelTop size={16} />
        </IconButton>
      </Tooltip>
    </Flex>
  )
}

export function NavButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick(): void
}): React.JSX.Element {
  return (
    <Button
      variant="plain"
      w="full"
      h="40px"
      px="6px"
      py="5px"
      justifyContent="flex-start"
      gap="10px"
      rounded="33px"
      bg={active ? 'bg.panel' : 'transparent'}
      color="inherit"
      textAlign="left"
      _hover={{ bg: 'bg.panel' }}
      onClick={onClick}
    >
      <Flex
        boxSize="30px"
        p="5px"
        flex="none"
        align="center"
        justify="center"
        rounded="full"
        bg="bg.emphasized"
        color="fg.muted"
        _light={{ bg: active ? 'bg.emphasized' : 'bg.panel' }}
      >
        {icon}
      </Flex>
      <Text as="span" fontSize="16px" fontWeight="500">
        {label}
      </Text>
    </Button>
  )
}

export function SectionTitle({
  title,
  description
}: {
  title: string
  description: string
}): React.JSX.Element {
  return (
    <Stack gap="2px">
      <Heading as="h2" fontSize="16px" lineHeight="20px" fontWeight="600">
        {title}
      </Heading>
      <Text color="fg.muted">{description}</Text>
    </Stack>
  )
}

export function Empty({ title }: { title: string }): React.JSX.Element {
  return (
    <Stack minH="260px" placeContent="center" align="center" gap="10px" color="fg.muted">
      <Icon as={Palette} boxSize="20px" />
      <Heading as="h2" color="fg" fontSize="16px">
        {title}
      </Heading>
    </Stack>
  )
}

export function SettingsRow({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <Flex
      data-part="settings-row"
      minH="58px"
      px="10px"
      py="8px"
      align="center"
      justify="space-between"
      gap="20px"
      borderWidth="1px"
      borderColor="border"
      rounded="6px"
      bg="bg.subtle"
    >
      <Box minW="0">
        <Heading as="h2" fontSize="18px" fontWeight="500" lineHeight="23px">
          {title}
        </Heading>
        {description !== '' && (
          <Text
            overflow="hidden"
            fontFamily="mono"
            fontSize="14px"
            lineHeight="18px"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            color="fg.subtle"
          >
            {description}
          </Text>
        )}
      </Box>
      {children}
    </Flex>
  )
}
