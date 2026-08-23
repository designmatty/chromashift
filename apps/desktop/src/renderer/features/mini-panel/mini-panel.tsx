import {
  Badge,
  Box,
  Button,
  createListCollection,
  Flex,
  Grid,
  HStack,
  Icon,
  IconButton,
  Portal,
  RadioGroup,
  Select,
  Stack,
  Text
} from '@chakra-ui/react'
import {
  ArrowLeft,
  Bug,
  ChevronsUpDown,
  Monitor,
  Power,
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
import { Tooltip } from '@/components/ui/tooltip'
import { ColorControls, resetRememberedColorValues } from '@/features/profiles/color-controls'
import { applyOverrideTargets } from '@/features/profiles/override-targets'
import { usePreviewDraft } from '@/features/profiles/use-preview-draft'
import { useProductTheme } from '@/hooks/use-product-theme'
import { run } from '@/lib/product-result'
import type { ProductError, ProductState } from '../../../shared/product-api.js'

const DEFAULT_ID = 'default'
const AUTOMATIC_ID = '__automatic__'

interface MiniProfilePickerItem {
  label: string
  value: string
  global?: boolean
}

export function MiniPanel({ product }: { product: ProductState }): React.JSX.Element {
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState<ProductError | null>(null)
  const activeId =
    product.chromaShift.intendedTarget?.kind === 'profile'
      ? product.chromaShift.intendedTarget.profileId
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
  const { draft, dirty, updateDraft, resetTo, rollbackPreview } = usePreviewDraft({
    kind: 'override',
    session: product.preview,
    enabled: active !== undefined && product.chromaShift.status === 'active',
    onError: setError,
    initialDraft: () => (appliedProfile === undefined ? null : structuredClone(appliedProfile)),
    initialDirty: () => override !== null
  })
  const [selectedDisplayId, setSelectedDisplayId] = useState<string | null>(() =>
    chooseInitialDisplay(product, appliedProfile)
  )
  const pickerItems = useMemo(
    () =>
      [
        { label: 'Auto switch', value: AUTOMATIC_ID },
        ...product.configuration.profiles
          .filter((profile) => profile.enabled)
          .map((profile) => ({
            label: profile.name,
            value: profile.id,
            global: profile.id === DEFAULT_ID
          }))
      ] satisfies MiniProfilePickerItem[],
    [product.configuration.profiles]
  )

  useProductTheme(product.settings.theme)

  useEffect(() => {
    if (active !== undefined) resetRememberedColorValues(active)
    resetTo(appliedProfile ?? null, { dirty: override !== null })
    setSelectedDisplayId((current) =>
      current !== null && product.displays.some((display) => display.id === current)
        ? current
        : chooseInitialDisplay(product, appliedProfile)
    )
  }, [active?.id, override?.profileId])

  useEffect(() => {
    const view = picker ? 'picker' : dirty ? 'override' : 'controls'
    void window.chromaShift.setMiniPanelView(view)
  }, [picker, dirty])

  async function choose(profileId: string | null): Promise<void> {
    if (product.preview.state === 'active') {
      await rollbackPreview()
    }
    resetRememberedColorValues(active ?? null)
    if (profileId === null) await run(window.chromaShift.enableAutomatic(), setError)
    else await run(window.chromaShift.activateProfile(profileId), setError)
    setPicker(false)
    resetTo(active ?? null)
  }

  function renderContent(): React.ReactNode {
    if (active === undefined || draft === null) {
      return <Empty title="No profiles available" />
    }

    if (picker) {
      const pickerValue =
        product.chromaShift.intendedMode.kind === 'automatic' ? AUTOMATIC_ID : active.id
      const [automaticItem, ...profileItems] = pickerItems

      return (
        <>
          <Box
            flex="1"
            mx="3"

            borderWidth="1px"
            borderColor="border"
            rounded="2xl"
            bg="bg.panel"
            overflowY="auto"
            alignContent={'stretch'}
          >
            <RadioGroup.Root
              display={'flex'}
              flexDirection={'column'}
              value={pickerValue}
              onValueChange={(details) => {
                void choose(details.value === AUTOMATIC_ID ? null : details.value)
              }}
            >
              <RadioGroup.Label srOnly>Choose active profile</RadioGroup.Label>
              {automaticItem !== undefined && (
                <Box
                  position={'sticky'}
                  top={0}
                  bg={'bg.panel'}
                  zIndex={1}
                  px={2}
                  py={1}
                  borderBottomWidth="1px"
                  borderColor="border.muted"
                >
                  <MiniProfilePickerOption
                    item={automaticItem}
                    selected={automaticItem.value === pickerValue}
                    onSelect={() => void choose(null)}
                  />
                </Box>
              )}
              {profileItems.length > 0 && (
                <>
                  <Flex gap={1} px={2} py={4} flexDirection={'column'}>
                    {profileItems.map((item) => (
                      <MiniProfilePickerOption
                        item={item}
                        selected={item.value === pickerValue}
                        onSelect={() => void choose(item.value)}
                        key={item.value}
                      />
                    ))}
                  </Flex>
                </>
              )}
            </RadioGroup.Root>
          </Box>
          <Flex as="footer" mx="5" py="3" align="center" gap="2">
            <Button
              variant="plain"
              padding={0}
              w="full"
              justifyContent="flex-start"
              gap={3}
              textAlign="left"
              onClick={() => setPicker(false)}
            >
              <ArrowLeft />
              <Text as="strong" fontSize="18px" fontWeight="700">
                Back
              </Text>
            </Button>
          </Flex>
        </>
      )
    }

    const selectedDisplay = product.displays.find((display) => display.id === selectedDisplayId)
    const selectedTarget =
      selectedDisplayId === null ? undefined : findDisplayTarget(draft, selectedDisplayId)
    const selectedColor = selectedTarget?.color ?? {}

    return (
      <>
        {dirty && (
          <Grid p="3" templateColumns="repeat(2, minmax(0, 1fr))" gap={3}>
            <Button
              variant="solid"
              size={'2xs'}
              borderRadius={'full'}
              onClick={() => {
                resetRememberedColorValues(active)
                resetTo(active)
                void rollbackPreview()
              }}
            >
              Reset changes
            </Button>
            <Button
              variant="subtle"
              size={'2xs'}
              borderRadius={'full'}
              onClick={() =>
                void run(window.chromaShift.confirmPreview(draft, 'preserve'), setError).then(
                  (saved) => {
                    if (saved === undefined) return
                    resetTo(saved)
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
            mx={3}
            mb="2"
            px="4"
            py="1.5"
            rounded="lg"
            bg="bg.error"
            color="fg.error"
            fontWeight={'700'}
          >
            {error.message}
          </Box>
        )}
        <MiniPanelContent>
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
              editable={product.chromaShift.status === 'active'}
              onChange={(color, lastColorValues) => {
                const next = setDisplayTarget(draft, {
                  displayId: selectedDisplayId,
                  color,
                  lastColorValues
                })
                if (sameAppliedColors(next, active)) {
                  resetRememberedColorValues(active)
                  resetTo(active)
                  if (dirty || override !== null) {
                    void rollbackPreview()
                  }
                  return
                }
                updateDraft(next)
              }}
              compact
            />
          )}
        </MiniPanelContent>
        <Flex as="footer" mx="5" py="3" align="center" gap="2">
          <Button
            data-part="active-profile"
            variant="plain"
            padding={0}
            width="210px"
            mr="auto"
            display="flex"
            alignItems="center"
            gap={3}
            textAlign="left"
            size={'sm'}
            _hover={{
              color: 'fg'
            }}
            onClick={() => setPicker(true)}
          >
            <Stack gap="0" flex={1} width={'full'}>
              <Text color="fg.muted" fontSize="md">
                {product.chromaShift.intendedMode.kind === 'automatic'
                  ? 'Auto switch'
                  : 'Manually selected'}
              </Text>
              <Text
                overflow="hidden"
                fontSize="lg"
                fontWeight="700"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
              >
                {active.name}
              </Text>
            </Stack>
            <Icon size={'sm'}>
              <ChevronsUpDown />
            </Icon>
          </Button>
          <Tooltip content="Open settings">
            <IconButton
              size={'md'}
              variant="ghost"
              onClick={() => void window.chromaShift.openAppPanel('settings')}
              aria-label="Open settings"
            >
              <SettingsIcon />
            </IconButton>
          </Tooltip>
          <Tooltip content="Restore original display settings">
            <IconButton
              size={'md'}
              variant="ghost"
              onClick={() => void run(window.chromaShift.restoreBaseline(), setError)}
              aria-label="Restore original display settings"
              disabled={product.chromaShift.status !== 'active'}
            >
              <RefreshCcwDot />
            </IconButton>
          </Tooltip>
        </Flex>
      </>
    )
  }

  return (
    <MiniPanelFrame>
      <MiniPanelTitleBar
        product={product}
        onError={setError}
        onOpenDebugger={() => void run(window.chromaShift.openMiniPanelDevTools(), setError)}
        onClose={() => void run(window.chromaShift.hideMiniPanel(), setError)}
      />
      {renderContent()}
    </MiniPanelFrame>
  )
}

function MiniPanelContent({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Box
      flex="1"
      mx="3"
      px={2.5}
      py={4}
      borderWidth="1px"
      borderColor="border"
      rounded="2xl"
      bg={{ base: 'bg.panel', _dark: 'bg.muted' }}
      overflow={'auto'}
    >
      {children}
    </Box>
  )
}

function MiniPanelFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Flex
      data-part="mini-panel"
      w="400px"
      overflow="hidden"
      direction="column"
      rounded="2xl"
      borderWidth="1px"
      borderColor="border"
      bg={'bg.subtle/80'}
      height={'full'}
    >
      {children}
    </Flex>
  )
}

function MiniProfilePickerOption({
  item,
  selected,
  onSelect
}: {
  item: MiniProfilePickerItem
  selected: boolean
  onSelect(): void
}): React.JSX.Element {
  return (
    <RadioGroup.Item
      value={item.value}
      width="full"
      alignItems="center"
      gap={3}
      fontWeight={'700'}
      color="fg/70"
      paddingX={2}
      paddingY={3}
      borderRadius={'full'}
      _hover={{
        bg: 'bg.muted',
        color: 'fg'
      }}
      _checked={{ color: 'fg', bg: 'bg.muted' }}
      onClick={selected ? onSelect : undefined}
    >
      <RadioGroup.ItemHiddenInput />
      <RadioGroup.ItemIndicator />
      <RadioGroup.ItemText
        minW="0"
        flex="1"
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
      >
        {item.label}
      </RadioGroup.ItemText>
      {item.global === true && (
        <Badge size={'sm'} colorPalette={'blue'}>
          Global
        </Badge>
      )}
    </RadioGroup.Item>
  )
}

function MiniPanelTitleBar({
  product,
  onError,
  onOpenDebugger,
  onClose
}: {
  product: ProductState
  onError(error: ProductError | null): void
  onOpenDebugger(): void
  onClose(): void
}): React.JSX.Element {
  return (
    <Flex
      as="header"
      position="relative"
      h="46px"
      minH="46px"
      mx="3"
      align="center"
      userSelect="none"
      css={{ WebkitAppRegion: 'drag' }}
    >
      <Brand compact />
      <Tooltip content={chromaShiftActionLabel(product)}>
        <IconButton
          data-part="chromashift-control"
          data-status={product.chromaShift.status === 'active' ? 'active' : 'paused'}
          variant="ghost"
          size="2xs"
          ml="1"
          colorPalette={product.chromaShift.status === 'active' ? 'green' : 'gray'}
          css={{ WebkitAppRegion: 'no-drag' }}
          disabled={product.chromaShift.transitionInProgress}
          loading={product.chromaShift.transitionInProgress}
          onClick={() =>
            void run(window.chromaShift.controlChromaShift(chromaShiftAction(product)), onError)
          }
          aria-label={chromaShiftActionLabel(product)}
        >
          <Power size={16} />
        </IconButton>
      </Tooltip>
      {import.meta.env.DEV && (
        <Tooltip content="Open browser inspector">
          <IconButton
            variant="ghost"
            size="2xs"
            ml="1"
            css={{ WebkitAppRegion: 'no-drag' }}
            onClick={onOpenDebugger}
            aria-label="Open browser inspector"
          >
            <Bug size={16} />
          </IconButton>
        </Tooltip>
      )}
      <PanelViewToggle mini />
      <Tooltip content="Close mini panel">
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
          <X />
        </IconButton>
      </Tooltip>
    </Flex>
  )
}

function chromaShiftAction(product: ProductState): 'pause' | 'resume' | 'retry' {
  if (product.chromaShift.status === 'active') return 'pause'
  return product.chromaShift.status === 'safetyBlocked' ? 'retry' : 'resume'
}

function chromaShiftActionLabel(product: ProductState): string {
  if (product.chromaShift.status === 'active') return 'Pause ChromaShift'
  return product.chromaShift.status === 'safetyBlocked'
    ? 'Retry ChromaShift safety check'
    : 'Resume ChromaShift'
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
  const collection = useMemo(
    () =>
      createListCollection({
        items: displays.map((display) => ({ label: display.name, value: display.id }))
      }),
    [displays]
  )

  return (
    <Select.Root
      collection={collection}
      value={selected === undefined ? [] : [selected.id]}
      positioning={{ sameWidth: true }}
      size="xs"
      w="full"
      mb="5"

      onValueChange={(details) => {
        const displayId = details.value[0]
        if (displayId !== undefined) onSelect(displayId)
      }}
    >
      <Select.HiddenSelect />
      <Select.Label srOnly>Select display</Select.Label>
      <Select.Control>
        <Select.Trigger aria-label="Select display" gap={3} bg="bg.subtle" borderRadius={'md'}>
          <HStack>
            <Icon size={'sm'}>
              <Monitor />
            </Icon>
            <Select.ValueText />
          </HStack>
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator color="fg.muted" />
        </Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content borderWidth="1px" borderColor="border" color="fg">
            {collection.items.map((item) => (
              <Select.Item item={item} key={item.value}>
                <Select.ItemText>{item.label}</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
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
