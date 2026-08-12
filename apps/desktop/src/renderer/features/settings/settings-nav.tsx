import { ArrowLeft, BadgeInfo, Eclipse, Monitor } from 'lucide-react'
import { NavButton } from '@/components/layout/presentational'
import type { AppPanelView } from '../../../shared/product-api.js'

export type SettingsPage = Extract<AppPanelView, 'settings' | 'displays' | 'about'>

/**
 * Settings replaces the profile sidebar rather than sitting beside it, so the
 * shell keeps a single two-pane layout and Back returns to the profile list.
 */
export function SettingsNav({
  page,
  onSelect,
  onBack
}: {
  page: SettingsPage
  onSelect(page: SettingsPage): void
  onBack(): void
}): React.JSX.Element {
  return (
    <Flex as="section" data-part="settings-nav" h="full" minH="0" direction="column" gap="10px">
      <Flex as="header" h="20px" align="center" gap="10px" color="fg.muted" fontSize="14px">
        <Text as="strong" fontWeight="500">
          Settings
        </Text>
      </Flex>
      <Stack as="nav" gap="10px">
        <NavButton
          active={page === 'settings'}
          icon={<Eclipse />}
          label="General"
          onClick={() => onSelect('settings')}
        />
        <NavButton
          active={page === 'displays'}
          icon={<Monitor />}
          label="Displays"
          onClick={() => onSelect('displays')}
        />
        <NavButton
          active={page === 'about'}
          icon={<BadgeInfo />}
          label="About"
          onClick={() => onSelect('about')}
        />
      </Stack>
      <Box as="footer" h="20px" mt="auto">
        <Button
          variant="plain"
          h="20px"
          p="0"
          gap="10px"
          color="inherit"
          fontWeight="400"
          aria-label="Back to profiles"
          onClick={onBack}
          _hover={{ bg: 'transparent' }}
        >
          <ArrowLeft size={20} />
          <Text as="span" fontSize="14px">
            Back
          </Text>
        </Button>
      </Box>
    </Flex>
  )
}
import { Box, Button, Flex, Stack, Text } from '@chakra-ui/react'
