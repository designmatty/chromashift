import {
  ArrowLeft,
  BadgeInfo,
  Keyboard,
  Monitor,
  PanelLeft,
  PanelLeftClose,
  ScrollText,
  Settings
} from 'lucide-react'
import { Button, Flex, IconButton, Stack, Text } from '@chakra-ui/react'
import { useEffect } from 'react'
import {
  escapeOwnerSelector,
  settingsEscapeGoesBack
} from '@/features/settings/settings-navigation'

import { NavButton } from '@/components/layout/presentational'
import { Tooltip } from '@/components/ui/tooltip'
import type { AppPanelView } from '@shared/product-api.js'

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
  collapsed,
  onCollapsedChange,
  onSelect,
  onBack
}: {
  page: SettingsPage
  collapsed: boolean
  onCollapsedChange(collapsed: boolean): void
  onSelect(page: SettingsPage): void
  onBack(): void
}): React.JSX.Element {
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      const ownsEscape =
        event.target instanceof Element && event.target.closest(escapeOwnerSelector) !== null
      const overlayOpen =
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]'
        ) !== null
      if (!settingsEscapeGoesBack(event, ownsEscape, overlayOpen)) return
      event.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onBack])
  return (
    <Flex
      as="aside"
      data-part="settings-nav"
      h="full"
      direction="column"
      gap="3"
      width={collapsed ? '40px' : '245px'}
      flex="none"
    >
      <Flex align="center" justify={collapsed ? 'center' : 'space-between'}>
        {!collapsed && (
          <Text as="strong" fontWeight="500" color="fg.muted">
            Settings
          </Text>
        )}
      </Flex>
      <Stack as="nav" gap="3">
        <NavButton
          active={page === 'settings'}
          icon={<Settings />}
          label="General"
          collapsed={collapsed}
          onClick={() => onSelect('settings')}
        />
        <NavButton
          active={page === 'shortcuts'}
          icon={<Keyboard />}
          label="Shortcuts"
          collapsed={collapsed}
          onClick={() => onSelect('shortcuts')}
        />
        <NavButton
          active={page === 'displays'}
          icon={<Monitor />}
          label="Displays"
          collapsed={collapsed}
          onClick={() => onSelect('displays')}
        />
        <NavButton
          active={page === 'diagnostics'}
          icon={<ScrollText />}
          label="Diagnostics"
          collapsed={collapsed}
          onClick={() => onSelect('diagnostics')}
        />
        <NavButton
          active={page === 'about'}
          icon={<BadgeInfo />}
          label="About"
          collapsed={collapsed}
          onClick={() => onSelect('about')}
        />
      </Stack>
      <Flex
        as="footer"
        data-part="settings-nav-footer"
        mt="auto"
        position={'sticky'}
        bottom={0}
        align="center"
        direction={collapsed ? 'column' : 'row'}
        gap="1"
        bg={'bg.subtle'}
      >
        <Tooltip content="Back to profiles" disabled={!collapsed}>
          <Button
            size="xs"
            variant="ghost"
            ml={collapsed ? undefined : 'auto'}
            aria-label="Back to profiles"
            onClick={onBack}
            borderRadius="full"
          >
            <ArrowLeft />
            {!collapsed && <Text fontSize="sm">Back</Text>}
          </Button>
        </Tooltip>
        <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? <PanelLeft /> : <PanelLeftClose />}
          </IconButton>
        </Tooltip>
      </Flex>
    </Flex>
  )
}
