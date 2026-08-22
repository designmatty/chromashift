import { ArrowLeft, BadgeInfo, Eclipse, Keyboard, Monitor, ScrollText } from 'lucide-react'
import { Box, Button, Flex, Stack, Text } from '@chakra-ui/react'

import { NavButton } from '@/components/layout/presentational'
import type { AppPanelView } from '../../../shared/product-api.js'

export type SettingsPage = Extract<
  AppPanelView,
  'settings' | 'shortcuts' | 'displays' | 'diagnostics' | 'about'
>

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
    <Flex as="aside" data-part="settings-nav" h="full" direction="column" gap="3" width={'245px'}>
      <Text as="strong" fontWeight="500" color="fg.muted">
        Settings
      </Text>
      <Stack as="nav" gap="3">
        <NavButton
          active={page === 'settings'}
          icon={<Eclipse />}
          label="General"
          onClick={() => onSelect('settings')}
        />
        <NavButton
          active={page === 'shortcuts'}
          icon={<Keyboard />}
          label="Shortcuts"
          onClick={() => onSelect('shortcuts')}
        />
        <NavButton
          active={page === 'displays'}
          icon={<Monitor />}
          label="Displays"
          onClick={() => onSelect('displays')}
        />
        <NavButton
          active={page === 'diagnostics'}
          icon={<ScrollText />}
          label="Diagnostics"
          onClick={() => onSelect('diagnostics')}
        />
        <NavButton
          active={page === 'about'}
          icon={<BadgeInfo />}
          label="About"
          onClick={() => onSelect('about')}
        />
      </Stack>
      <Box as="footer" mt="auto" position={'sticky'} bottom={0} bg={'bg.subtle'}>
        <Button size={'xs'} aria-label="Back to profiles" onClick={onBack} borderRadius={'full'}>
          <ArrowLeft />
          <Text fontSize="sm">Back</Text>
        </Button>
      </Box>
    </Flex>
  )
}
