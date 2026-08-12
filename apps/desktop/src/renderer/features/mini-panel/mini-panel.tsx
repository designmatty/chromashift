import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  IconButton,
  Menu,
  Portal,
  Stack,
  Text
} from '@chakra-ui/react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Monitor,
  RefreshCcwDot,
  Settings as SettingsIcon,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  activeColorTargets,
  colorSettingNames,
  findDisplayTarget,
  setDisplayTarget,
  type ColorProfile,
  type ColorSettings
} from '@chromashift/core'
import { Brand, Empty, PanelViewToggle } from '@/components/layout/presentational'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip } from '@/components/ui/tooltip'
import { ColorControls, resetRememberedColorValues } from '@/features/profiles/color-controls'
import { applyOverrideTargets } from '@/features/profiles/override-targets'
import { useProductTheme } from '@/hooks/use-product-theme'
import { run } from '@/lib/product-result'
import type { ProductError, ProductState } from '../../../shared/product-api.js'

const DEFAULT_ID = 'default'

export function MiniPanel({ product }: { product: ProductState }): React.JSX.Element {
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState<ProductError | null>(null)
  const activeId =
    product.activation.currentTarget?.kind === 'profile'
      ? product.activation.currentTarget.profileId
      : DEFAULT_ID
  const active =
    product.configuration.profiles.find((profile) => profile.id === activeId) ??
    product.configuration.profiles.find((profile) => profile.id === DEFAULT_ID) ??
    product.configuration.profiles[0]
  const override =
    product.preview.state === 'active' &&
    product.preview.kind === 'override' &&
    product.preview.profileId === active?.id
      ? product.preview
      : null
  const appliedProfile = useMemo(
    () =>
      active === undefined
        ? undefined
        : override === null
          ? active
          : applyOverrideTargets(active, override.targets),
    [active, override]
  )
  const [draft, setDraft] = useState<ColorProfile | undefined>(() =>
    appliedProfile === undefined ? undefined : structuredClone(appliedProfile)
  )
  const [dirty, setDirty] = useState(override !== null)
  const [selectedDisplayId, setSelectedDisplayId] = useState<string | null>(() =>
    chooseInitialDisplay(product, appliedProfile)
  )

  useProductTheme(product.settings.theme)

  useEffect(() => {
    if (active !== undefined) resetRememberedColorValues(active)
    setDraft(appliedProfile === undefined ? undefined : structuredClone(appliedProfile))
    setSelectedDisplayId((current) =>
      current !== null && product.displays.some((display) => display.id === current)
        ? current
        : chooseInitialDisplay(product, appliedProfile)
    )
    setDirty(override !== null)
  }, [active?.id, override?.profileId])

  useEffect(() => {
    const view = picker ? 'picker' : dirty ? 'override' : 'controls'
    void window.chromaShift.setMiniPanelView(view)
  }, [picker, dirty])

  const draftSignature = JSON.stringify(draft)
  useEffect(() => {
    if (!dirty || active === undefined || draft === undefined) return
    const timer = setTimeout(() => {
      const request =
        override === null
          ? window.chromaShift.startPreview(draft, 'override')
          : window.chromaShift.updatePreview(active.id, activeColorTargets(draft))
      void run(request, setError)
    }, 100)
    return () => clearTimeout(timer)
  }, [draftSignature, dirty, active?.id, override?.profileId])

  async function choose(profileId: string | null): Promise<void> {
    if (product.preview.state === 'active') {
      await run(window.chromaShift.cancelPreview(), setError)
    }
    resetRememberedColorValues(active ?? null)
    if (profileId === null) await run(window.chromaShift.enableAutomatic(), setError)
    else await run(window.chromaShift.activateProfile(profileId), setError)
    setPicker(false)
    setDirty(false)
  }

  const titleBar = (
    <MiniPanelTitleBar onClose={() => void run(window.chromaShift.hideMiniPanel(), setError)} />
  )

  if (active === undefined || draft === undefined) {
    return (
      <MiniPanelFrame>
        {titleBar}
        <Empty title="No profiles available" />
      </MiniPanelFrame>
    )
  }

  if (picker) {
    return (
      <MiniPanelFrame picker>
        {titleBar}
        <Box h="43px" minH="43px" mx="10px">
          <Button
            variant="plain"
            w="full"
            h="43px"
            px="20px"
            py="0"
            justifyContent="flex-start"
            gap="10px"
            color="inherit"
            textAlign="left"
            onClick={() => setPicker(false)}
          >
            <ArrowLeft size={20} />
            <Text as="strong" fontSize="18px" fontWeight="700">
              Color controls
            </Text>
          </Button>
        </Box>
        <Box
          minH="0"
          flex="1"
          mx="10px"
          mb="10px"
          p="20px"
          overflowY="auto"
          borderWidth="1px"
          borderColor="bg.muted"
          rounded="20px"
          scrollbarWidth="thin"
        >
          <PickerRow
            selected={product.activation.mode.kind === 'automatic'}
            onClick={() => void choose(null)}
          >
            <Checkbox checked={product.activation.mode.kind === 'automatic'} />
            <Text as="span">Auto switch</Text>
          </PickerRow>
          <Box
            h="25px"
            borderTopWidth="1px"
            borderColor="bg.muted"
            transform="translateY(12px)"
            aria-hidden="true"
          />
          <Stack gap="12px">
            {product.configuration.profiles
              .filter((profile) => profile.enabled)
              .map((profile) => (
                <PickerRow
                  selected={product.activation.mode.kind === 'manual' && active.id === profile.id}
                  onClick={() => void choose(profile.id)}
                  key={profile.id}
                >
                  <Checkbox
                    checked={product.activation.mode.kind === 'manual' && active.id === profile.id}
                  />
                  <Text as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                    {profile.name}
                  </Text>
                  {profile.id === DEFAULT_ID && (
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
                      Global
                    </Badge>
                  )}
                </PickerRow>
              ))}
          </Stack>
        </Box>
      </MiniPanelFrame>
    )
  }

  const selectedDisplay = product.displays.find((display) => display.id === selectedDisplayId)
  const selectedTarget =
    selectedDisplayId === null ? undefined : findDisplayTarget(draft, selectedDisplayId)
  const selectedColor = selectedTarget?.color ?? {}

  return (
    <MiniPanelFrame>
      {titleBar}
      {dirty && (
        <Grid
          h="46px"
          minH="46px"
          mx="10px"
          p="10px"
          templateColumns="repeat(2, minmax(0, 1fr))"
          gap="10px"
        >
          <Button
            variant="subtle"
            h="26px"
            minH="26px"
            px="10px"
            py="5px"
            rounded="26px"
            bg="bg.muted"
            color="fg"
            fontSize="12px"
            onClick={() => {
              resetRememberedColorValues(active)
              setDraft(structuredClone(active))
              setDirty(false)
              void run(window.chromaShift.cancelPreview(), setError)
            }}
          >
            Reset changes
          </Button>
          <Button
            h="26px"
            minH="26px"
            px="10px"
            py="5px"
            rounded="26px"
            bg="white"
            color="#111114"
            fontSize="12px"
            onClick={() =>
              void run(window.chromaShift.confirmPreview(draft, 'preserve'), setError).then(
                (saved) => {
                  if (saved === undefined) return
                  setDraft(structuredClone(saved))
                  setDirty(false)
                }
              )
            }
          >
            Update profile
          </Button>
        </Grid>
      )}
      {error !== null && (
        <Box
          mx="10px"
          mb="8px"
          px="10px"
          py="7px"
          rounded="6px"
          bg="status.errorBg"
          color="fg.error"
        >
          {error.message}
        </Box>
      )}
      <Box
        minH="0"
        flex="1"
        mx="10px"
        p="20px"
        overflow="hidden"
        borderWidth="1px"
        borderColor="bg.muted"
        rounded="20px"
        bg="bg.panel"
      >
        {product.displays.length > 1 && selectedDisplay !== undefined && (
          <MiniDisplaySelect
            displays={product.displays}
            selectedId={selectedDisplay.id}
            onSelect={setSelectedDisplayId}
          />
        )}
        {selectedDisplay === undefined || selectedDisplayId === null ? (
          <Empty title="No displays connected" />
        ) : (
          <ColorControls
            profileId={draft.id}
            displayId={selectedDisplayId}
            color={selectedColor}
            lastColorValues={selectedTarget?.lastColorValues}
            product={product}
            editable
            onChange={(color, lastColorValues) => {
              const next = setDisplayTarget(draft, {
                displayId: selectedDisplayId,
                color,
                lastColorValues
              })
              if (sameAppliedColors(next, active)) {
                resetRememberedColorValues(active)
                setDraft(structuredClone(active))
                setDirty(false)
                if (dirty || override !== null) {
                  void run(window.chromaShift.cancelPreview(), setError)
                }
                return
              }
              setDraft(next)
              setDirty(true)
            }}
            compact
          />
        )}
      </Box>
      <Flex as="footer" h="66px" minH="66px" mx="10px" p="10px" align="center" gap="20px">
        <Button
          data-part="active-profile"
          variant="plain"
          minW="0"
          w="196px"
          h="46px"
          p="0"
          mr="auto"
          display="grid"
          gridTemplateColumns="20px minmax(0, 1fr)"
          alignItems="center"
          gap="10px"
          color="inherit"
          textAlign="left"
          onClick={() => setPicker(true)}
        >
          <ChevronsUpDown size={20} />
          <Stack minW="0" gap="0">
            <Text
              as="small"
              overflow="hidden"
              color="fg.muted"
              fontSize="18px"
              fontWeight="400"
              lineHeight="23px"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {product.activation.mode.kind === 'automatic' ? 'Auto switch' : 'Manually selected'}
            </Text>
            <Text
              as="strong"
              overflow="hidden"
              fontSize="18px"
              fontWeight="700"
              lineHeight="23px"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {active.name}
            </Text>
          </Stack>
        </Button>
        <Tooltip label="Open settings">
          <IconButton
            variant="ghost"
            boxSize="20px"
            minW="20px"
            p="0"
            onClick={() => void window.chromaShift.openAppPanel('settings')}
            aria-label="Open settings"
          >
            <SettingsIcon size={20} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Restore original display settings">
          <IconButton
            variant="ghost"
            boxSize="20px"
            minW="20px"
            p="0"
            onClick={() => void run(window.chromaShift.restoreBaseline(), setError)}
            aria-label="Restore original display settings"
          >
            <RefreshCcwDot size={20} />
          </IconButton>
        </Tooltip>
      </Flex>
    </MiniPanelFrame>
  )
}

function MiniPanelFrame({
  children,
  picker = false
}: {
  children: React.ReactNode
  picker?: boolean
}): React.JSX.Element {
  return (
    <Flex
      data-part="mini-panel"
      w="400px"
      h={picker ? '335px' : '100vh'}
      overflow="hidden"
      direction="column"
      rounded="20px"
      borderWidth="1px"
      borderColor="border"
      bg="bg.frame"
      color="fg"
      fontFamily="body"
      _dark={{ borderWidth: '0' }}
    >
      {children}
    </Flex>
  )
}

function PickerRow({
  children,
  selected,
  onClick
}: {
  children: React.ReactNode
  selected: boolean
  onClick(): void
}): React.JSX.Element {
  return (
    <Button
      variant="plain"
      w="full"
      h="21px"
      minH="21px"
      p="0"
      display="grid"
      gridTemplateColumns="20px minmax(0, 1fr) auto"
      alignItems="center"
      gap="10px"
      color={selected ? 'fg' : 'fg.muted'}
      fontSize="16px"
      textAlign="left"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function MiniPanelTitleBar({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <Flex
      as="header"
      position="relative"
      h="46px"
      minH="46px"
      mx="10px"
      align="center"
      userSelect="none"
      css={{ WebkitAppRegion: 'drag' }}
      _dark={{ h: '42px', minH: '42px' }}
    >
      <Brand compact />
      <PanelViewToggle mini />
      <Tooltip label="Close mini panel">
        <IconButton
          variant="ghost"
          boxSize="20px"
          minW="20px"
          ml="auto"
          p="0"
          css={{ WebkitAppRegion: 'no-drag' }}
          onClick={onClose}
          aria-label="Close mini panel"
        >
          <X size={20} />
        </IconButton>
      </Tooltip>
    </Flex>
  )
}

function MiniDisplaySelect({
  displays,
  selectedId,
  onSelect
}: {
  displays: ProductState['displays']
  selectedId: string
  onSelect(displayId: string): void
}): React.JSX.Element {
  const selected = displays.find((display) => display.id === selectedId) ?? displays[0]
  return (
    <Menu.Root positioning={{ sameWidth: true }}>
      <Menu.Trigger asChild>
        <Button
          variant="plain"
          w="full"
          h="30px"
          minH="30px"
          mb="20px"
          px="10px"
          py="5px"
          justifyContent="flex-start"
          gap="10px"
          rounded="6px"
          bg="bg.muted"
          color="fg.muted"
          fontSize="12px"
        >
          <Monitor size={20} />
          <Text
            as="span"
            minW="0"
            flex="1"
            overflow="hidden"
            textAlign="left"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
          >
            {selected?.name}
          </Text>
          <ChevronDown size={16} />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content>
            {displays.map((display) => (
              <Menu.Item key={display.id} value={display.id} onClick={() => onSelect(display.id)}>
                {display.id === selectedId && <Check />}
                {display.name}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}

function chooseInitialDisplay(
  product: ProductState,
  profile: ColorProfile | undefined
): string | null {
  const targeted = profile?.displays.find((target) =>
    product.displays.some((display) => display.id === target.displayId)
  )
  return (
    targeted?.displayId ??
    product.displays.find((display) => display.primary)?.id ??
    product.displays[0]?.id ??
    null
  )
}

/**
 * Mini-panel dirtiness represents a change to display output, not a change to
 * remembered control metadata. This lets an on/off round trip collapse back to
 * the saved profile and cancel the temporary preview immediately.
 */
function sameAppliedColors(left: ColorProfile, right: ColorProfile): boolean {
  const rightTargets = new Map(
    activeColorTargets(right).map((target) => [target.displayId.toLowerCase(), target.color])
  )
  const leftTargets = activeColorTargets(left)
  if (leftTargets.length !== rightTargets.size) return false
  return leftTargets.every((target) => {
    const rightColor = rightTargets.get(target.displayId.toLowerCase())
    return rightColor !== undefined && sameColorSettings(target.color, rightColor)
  })
}

function sameColorSettings(left: ColorSettings, right: ColorSettings): boolean {
  return colorSettingNames.every((setting) => left[setting] === right[setting])
}
