import { Box, Button, Center, Flex, Heading, Icon, IconButton, Image, Text } from '@chakra-ui/react'
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
    <>
      <Image h="22px" src={source.light} alt="chromashift" _dark={{ display: 'none' }} />
      <Image
        h="22px"
        src={source.dark}
        alt="chromashift"
        display="none"
        _dark={{ display: 'block' }}
      />
    </>
  )
}

/**
 * Draws the title-bar content inside the region Windows leaves free. The bar is
 * a drag region; interactive children opt out with `no-drag` so the native
 * caption buttons, keyboard handling, DPI scaling, and Snap behavior are intact.
 */
export function TitleBar({
  brandAccessory,
  children
}: {
  brandAccessory?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  return (
    <Flex
      as="header"
      data-part="title-bar"
      position="relative"
      w="full"
      px={2.5}
      py={2.5}
      align="center"
      css={{ WebkitAppRegion: 'drag' }}
    >
      <Brand />
      {brandAccessory !== undefined && (
        <Flex ml="2" align="center" css={{ WebkitAppRegion: 'no-drag' }}>
          {brandAccessory}
        </Flex>
      )}
      <PanelViewToggle />
      {children !== undefined && (
        <Flex ml="auto" align="center" gap={3} css={{ WebkitAppRegion: 'no-drag' }}>
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
      top={'50%'}
      left={'50%'}
      transform="translate(-50%, -50%)"
      h="32px"
      p="4px"
      align="center"
      gap="6px"
      borderWidth="1px"
      borderColor="border"
      rounded="l3"
      bg="bg.panel"
      css={{ WebkitAppRegion: 'no-drag' }}
    >
      <Tooltip content="App view">
        <IconButton
          variant={mini ? 'ghost' : 'subtle'}
          size="2xs"
          aria-label="App view"
          aria-pressed={!mini}
          onClick={() => void window.chromaShift.openAppPanel('profiles')}
          _pressed={{ bg: 'control.active' }}
        >
          <PanelsTopLeft size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Mini view">
        <IconButton
          variant={mini ? 'subtle' : 'ghost'}
          size="2xs"
          aria-label="Mini view"
          aria-pressed={mini}
          onClick={() => void window.chromaShift.showMiniPanel()}
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
      px={1}
      justifyContent="flex-start"
      gap={3}
      rounded="full"
      bg={active ? 'bg.panel' : 'transparent'}
      borderWidth={active ? '1px' : '0'}
      borderColor="border"
      color="inherit"
      textAlign="left"
      _hover={{ bg: 'bg.panel' }}
      onClick={onClick}
      _dark={{
        borderWidth: '0',
        bg: active ? 'bg.muted' : 'transparent',
        _hover: {
          bg: 'bg.muted'
        }
      }}
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

export function Empty({ title }: { title: string }): React.JSX.Element {
  return (
    <Center
      height={'full'}
      flex={1}
      gap={1}
      color="fg.muted"
      userSelect={'none'}
      pointerEvents={'none'}
      flexDir={'column'}
    >
      <Icon as={Palette} boxSize="20px" />
      <Heading as="h2" color="fg" size={'md'}>
        {title}
      </Heading>
    </Center>
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
      px="4"
      py="2"
      align="center"
      justify="space-between"
      gap="5"
      borderWidth="1px"
      borderColor={{ base: 'border', _dark: 'border.muted' }}
      bg={'bg.subtle'}
      _first={{
        borderTopRadius: 'lg'
      }}
      _last={{
        borderBottomRadius: 'lg'
      }}
    >
      <Box>
        <Heading as="h2" fontSize="md" lineHeight={'short'}>
          {title}
        </Heading>
        {description !== '' && (
          <Text fontFamily="mono" fontSize="sm" color="fg.muted">
            {description}
          </Text>
        )}
      </Box>
      {children}
    </Flex>
  )
}
