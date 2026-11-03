import { Alert, Button, CloseButton, Flex, Heading, Stack, Text, VStack } from '@chakra-ui/react'
import { CircleAlert, Power } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ColorProfile } from '@chromashift/core'
import { Empty, TitleBar } from '@/components/layout/presentational'
import { Tooltip } from '@/components/ui/tooltip'
import { DisplaysView } from '@/features/settings/displays-view'
import { DiagnosticsPanel } from '@/features/settings/diagnostics-panel'
import { ProfileDetail } from '@/features/profiles/profile-detail'
import { ProfileList } from '@/features/profiles/profile-list'
import { ProfileActionDialog } from '@/features/profiles/profile-action-dialog'
import {
  liveProfile,
  shouldPreviewProfile,
  emptyPreviewMessage,
  automaticProfileName
} from '@/features/profiles/app-preview-state'
import { DeleteProfileDialog } from '@/features/profiles/delete-profile-dialog'
import { applyOverrideTargets } from '@/features/profiles/override-targets'
import { commitAppPreview, deleteAppProfile } from '@/features/profiles/app-preview-actions'
import { usePreviewDraft } from '@/features/profiles/use-preview-draft'
import { AboutPanel } from '@/features/settings/about-panel'
import { SettingsNav } from '@/features/settings/settings-nav'
import { SettingsPanel } from '@/features/settings/settings-panel'
import { ShortcutsPanel } from '@/features/settings/shortcuts-panel'
import { useProductTheme } from '@/hooks/use-product-theme'
import { run } from '@/lib/product-result'
import type { AppPanelView, ProductError, ProductResult, ProductState } from '@shared/product-api'
import { formatShortcutAccelerator } from '@shared/shortcut-constants'

const LAST_PROFILE_KEY = 'chromashift.app-panel.selected-profile'
const LAST_VIEW_KEY = 'chromashift.app-panel.view'
const SIDEBAR_COLLAPSED_KEY = 'chromashift.app-panel.sidebar-collapsed'

export function MainApp({ product }: { product: ProductState }): React.JSX.Element {
  const [view, setView] = useState<AppPanelView>(readLastView)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  )
  const [selectedId, setSelectedId] = useState(() => liveProfile(product)?.id ?? null)
  const [error, setError] = useState<ProductError | null>(null)
  const [busy, setBusy] = useState(false)
  const [profilePendingDeletion, setProfilePendingDeletion] = useState<ColorProfile | null>(null)
  const [pendingContinuation, setPendingContinuation] = useState<(() => Promise<void>) | null>(null)
  const [pendingDisable, setPendingDisable] = useState<{
    profile: ColorProfile
    accelerator: string
  } | null>(null)
  const taskTail = useRef(Promise.resolve())
  const followingLive = useRef(true)
  const { draft, dirty, updateDraft, resetTo, invalidateSync, settlePreview, rollbackPreview } =
    usePreviewDraft({
      kind: 'edit',
      session: product.preview,
      enabled: view === 'profiles' && !busy && product.chromaShift.status === 'active',
      onError: setError,
      initialDraft: () => liveProfile(product)
    })
  const selected =
    product.configuration.profiles.find((profile) => profile.id === selectedId) ??
    liveProfile(product)
  const activeSession = product.preview.state === 'active' ? product.preview : null
  const temporaryOverride = activeSession?.kind === 'override' ? activeSession : null
  const currentProfileId = liveProfile(product)?.id ?? null
  const inSettings = view !== 'profiles'
  useProductTheme(product.settings.theme)
  useEffect(() => {
    localStorage.setItem(LAST_VIEW_KEY, view)
  }, [view])
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])
  useEffect(() => {
    if (selectedId === null) localStorage.removeItem(LAST_PROFILE_KEY)
    else localStorage.setItem(LAST_PROFILE_KEY, selectedId)
  }, [selectedId])
  useEffect(() => {
    if (!dirty && selected !== null) resetTo(selected)
  }, [selected])
  useEffect(() => {
    if (followingLive.current && !dirty && activeSession === null) setSelectedId(currentProfileId)
  }, [currentProfileId, activeSession, dirty])

  async function value<T>(request: Promise<ProductResult<T>>): Promise<T> {
    const result = await request
    if (!result.ok) throw result.error
    return result.value
  }
  // Serialize buffered main requests and clicks arriving before the busy paint.
  function perform(work: () => Promise<void>): void {
    taskTail.current = taskTail.current.then(async () => {
      setBusy(true)
      setError(null)
      try {
        await work()
      } catch (cause) {
        setError(
          typeof cause === 'object' && cause !== null && 'code' in cause
            ? (cause as ProductError)
            : {
                code: 'OPERATION_FAILED',
                message: cause instanceof Error ? cause.message : String(cause)
              }
        )
      } finally {
        setBusy(false)
      }
    })
  }
  async function action<T>(
    request: Promise<ProductResult<T>>,
    done?: (result: T) => void
  ): Promise<boolean> {
    const result = await run(request, setError)
    if (result !== undefined) done?.(result)
    return result !== undefined
  }
  async function returnToLive(): Promise<void> {
    const profile = liveProfile(await value(window.chromaShift.getState()))
    followingLive.current = true
    setSelectedId(profile?.id ?? null)
    resetTo(profile)
  }
  async function rollback(): Promise<void> {
    await rollbackPreview(true)
    const state = await value(window.chromaShift.getState())
    if (state.preview.state === 'active')
      throw new Error('The preview could not be ended. Try again.')
  }
  async function updateProfile(profile = draft): Promise<void> {
    if (profile === null) return
    resetTo(await commitAppPreview(profile, settlePreview, window.chromaShift))
  }
  function continueAfterChanges(work: () => Promise<void>): void {
    if (dirty) requestAnimationFrame(() => setPendingContinuation(() => work))
    else perform(work)
  }
  function resolveChanges(update: boolean): void {
    const next = pendingContinuation
    if (next === null) return
    perform(async () => {
      if (update) await updateProfile()
      else {
        await rollback()
        resetTo(selected)
      }
      setPendingContinuation(null)
      await next()
    })
  }
  async function openProfile(profile: ColorProfile): Promise<void> {
    const before = await value(window.chromaShift.getState())
    const keepingOverride =
      before.preview.state === 'active' &&
      before.preview.kind === 'override' &&
      before.preview.profileId === profile.id
    if (before.chromaShift.status !== 'active') await settlePreview()
    else if (!keepingOverride) await rollback()
    const state = await value(window.chromaShift.getState())
    const current = state.configuration.profiles.find((item) => item.id === profile.id)
    if (current === undefined) return
    followingLive.current = liveProfile(state)?.id === current.id
    setSelectedId(current.id)
    resetTo(current)
    setView('profiles')
    if (shouldPreviewProfile(state, current))
      await value(window.chromaShift.startPreview(current, 'preview'))
  }
  function selectProfile(profile: ColorProfile): void {
    if (view === 'profiles' && profile.id === selected?.id && profile.id !== currentProfileId)
      return
    if (!dirty) {
      followingLive.current = profile.id === currentProfileId
      setSelectedId(profile.id)
      resetTo(profile)
      setView('profiles')
    }
    continueAfterChanges(() => openProfile(profile))
  }
  function selectActivation(profileId: string | null): void {
    continueAfterChanges(async () => {
      await rollback()
      await value(
        profileId === null
          ? window.chromaShift.enableAutomatic()
          : window.chromaShift.activateProfile(profileId)
      )
      await returnToLive()
    })
  }
  function navigate(nextView: AppPanelView): void {
    if (nextView === view) return
    if (!dirty) setView(nextView)
    continueAfterChanges(async () => {
      if (view === 'profiles' && temporaryOverride === null) await rollback()
      await returnToLive()
      setView(nextView)
    })
  }
  // Main's buffered navigation and profile requests win over initial selection.
  useLayoutEffect(() => {
    window.chromaShift.onAppPanelNavigation(navigate)
  })
  useLayoutEffect(() => {
    window.chromaShift.onAppPanelProfileSelection((profileId) => {
      const profile = product.configuration.profiles.find(
        (item) => item.id.toLowerCase() === profileId.toLowerCase()
      )
      if (profile !== undefined) selectProfile(profile)
    })
  })
  useEffect(() => {
    const endAppPreview = () => {
      invalidateSync()
      setPendingContinuation(null)
      perform(async () => {
        if (temporaryOverride === null) await rollback()
        await returnToLive()
      })
    }
    window.chromaShift.onAppPanelClosed(endAppPreview)
    window.chromaShift.onAppPanelMinimized(endAppPreview)
  })
  function endPreview(): void {
    continueAfterChanges(async () => {
      await rollback()
      await returnToLive()
    })
  }
  function requestProfileDeletion(profile: ColorProfile): void {
    requestAnimationFrame(() => setProfilePendingDeletion(profile))
  }
  function confirmProfileDeletion(): void {
    const profile = profilePendingDeletion
    if (profile === null) return
    perform(async () => {
      await deleteAppProfile(profile.id, rollback, window.chromaShift)
      setProfilePendingDeletion(null)
      if (selected?.id.toLowerCase() === profile.id.toLowerCase()) await returnToLive()
    })
  }
  function toggleProfileEnabled(profile: ColorProfile): void {
    continueAfterChanges(async () => {
      const state = await value(window.chromaShift.getState())
      const current = state.configuration.profiles.find((item) => item.id === profile.id)
      if (current === undefined) return
      if (current.id === selectedId) followingLive.current = false
      const binding = state.settings.shortcutBindings.find(
        (item) =>
          item.action.kind === 'profile' &&
          item.action.profileId.toLowerCase() === current.id.toLowerCase()
      )
      if (current.enabled && binding !== undefined)
        requestAnimationFrame(() =>
          setPendingDisable({
            profile: current,
            accelerator: formatShortcutAccelerator(binding.accelerator)
          })
        )
      else await value(window.chromaShift.saveProfile({ ...current, enabled: !current.enabled }))
    })
  }
  function createProfile(copy?: ColorProfile): void {
    continueAfterChanges(async () => {
      await rollback()
      const profile = await value(
        copy === undefined
          ? window.chromaShift.createProfile('New profile')
          : window.chromaShift.duplicateProfile(copy.id)
      )
      await openProfile(profile)
    })
  }
  const savedProfile = draft ?? selected
  const shownProfile =
    !dirty &&
    temporaryOverride !== null &&
    savedProfile !== null &&
    temporaryOverride.profileId === savedProfile.id
      ? applyOverrideTargets(savedProfile, temporaryOverride.targets)
      : savedProfile
  const showPreviewBanner =
    view === 'profiles' &&
    product.chromaShift.status === 'active' &&
    temporaryOverride === null &&
    shownProfile !== null &&
    shownProfile.id !== currentProfileId &&
    (activeSession !== null || emptyPreviewMessage(product, shownProfile) !== null)
  const OverrideBanner = () => {
    return temporaryOverride !== null ? (
      <Flex
        data-part="override-banner"
        mx={2.5}
        px="3"
        py="3"
        align="center"
        gap="3"
        rounded="lg"
        bg="bg.inverted"
        color="fg.inverted"
        flex={'none'}
        _dark={{
          bg: 'bg.inverted',
          color: 'fg.inverted'
        }}
      >
        <CircleAlert />
        <Stack flex="1" gap="0">
          <Heading overflow="hidden" size="lg" textOverflow="ellipsis" whiteSpace="nowrap">
            You have unsaved changes on{' '}
            {product.configuration.profiles.find(
              (profile) => profile.id === temporaryOverride.profileId
            )?.name ?? 'profile'}
          </Heading>
          <Text
            overflow="hidden"
            fontFamily="mono"
            fontSize="xs"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            lineHeight={1}
          >
            The applied values differ from the saved profile
          </Text>
        </Stack>
        <Button
          size={'xs'}
          variant={'subtle'}
          disabled={busy}
          onClick={() => {
            invalidateSync()
            perform(async () => {
              await rollback()
              await returnToLive()
            })
          }}
        >
          Discard changes
        </Button>
        <Button
          size={'xs'}
          disabled={busy}
          onClick={() => {
            invalidateSync()
            const profile = product.configuration.profiles.find(
              (item) => item.id === temporaryOverride.profileId
            )
            if (profile !== undefined) {
              perform(async () => {
                await updateProfile(
                  dirty && draft?.id === profile.id
                    ? draft
                    : applyOverrideTargets(profile, temporaryOverride.targets)
                )
                await returnToLive()
              })
            }
          }}
        >
          Update profile
        </Button>
      </Flex>
    ) : (
      <></>
    )
  }

  return (
    <VStack data-part="app-shell" w="full" h="full" gap="4" alignItems={'stretch'} bg={'bg.subtle'}>
      <TitleBar
        onShowMiniPanel={() =>
          continueAfterChanges(async () => {
            if (temporaryOverride === null) await rollback()
            await returnToLive()
            await value(window.chromaShift.showMiniPanel())
          })
        }
        brandAccessory={
          <Tooltip content={chromaShiftActionLabel(product)}>
            <Button
              data-part="chromashift-control"
              data-status={product.chromaShift.status}
              size="2xs"
              variant="subtle"
              colorPalette={
                product.chromaShift.status === 'active'
                  ? 'green'
                  : product.chromaShift.status === 'safetyBlocked'
                    ? 'red'
                    : 'gray'
              }
              rounded="sm"
              disabled={product.chromaShift.transitionInProgress}
              loading={product.chromaShift.transitionInProgress}
              aria-label={chromaShiftActionLabel(product)}
              onClick={() => {
                const control = async (): Promise<void> => {
                  if (product.chromaShift.status === 'active') await rollback()
                  await value(window.chromaShift.controlChromaShift(chromaShiftAction(product)))
                  if (!dirty) await returnToLive()
                }
                if (product.chromaShift.status === 'active') continueAfterChanges(control)
                else perform(control)
              }}
            >
              <Power size={14} />
              Status:{' '}
              {product.chromaShift.status === 'active'
                ? 'Active'
                : product.chromaShift.status === 'safetyBlocked'
                  ? 'Safety blocked'
                  : 'Paused'}
            </Button>
          </Tooltip>
        }
      />
      <OverrideBanner />
      {error !== null && (
        <Alert.Root status="error" flex={'none'} size={'sm'} mx={2} width={'auto'}>
          <Alert.Indicator />
          <Alert.Title width={'full'}>{error.message}</Alert.Title>
          <CloseButton
            size={'2xs'}
            boxSize={'16px'}
            padding={0}
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          />
        </Alert.Root>
      )}
      <Flex
        data-part="app-body"
        overflow="hidden"
        minH={0}
        gap="4"
        flex={1}
        paddingX={4}
        paddingBottom={4}
      >
        {inSettings ? (
          <SettingsNav
            page={view}
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
            onSelect={(page) => void navigate(page)}
            onBack={() => void navigate('profiles')}
          />
        ) : (
          <ProfileList
            profiles={product.configuration.profiles}
            shortcutBindings={product.settings.shortcutBindings}
            selectedId={shownProfile?.id ?? null}
            currentId={currentProfileId}
            dirtyProfileId={dirty ? (shownProfile?.id ?? null) : null}
            previewingProfileId={activeSession?.kind === 'preview' ? activeSession.profileId : null}
            mode={product.chromaShift.intendedMode}
            controlStatus={product.chromaShift.status}
            busy={busy || product.chromaShift.transitionInProgress}
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
            onSelect={(profile) => void selectProfile(profile)}
            onCreate={() => createProfile()}
            onSelectionChange={selectActivation}
            onOpenSettings={() => navigate('settings')}
            onDuplicate={createProfile}
            onToggleEnabled={toggleProfileEnabled}
            onDelete={requestProfileDeletion}
            onReorder={async (profileIds, interactionId) => {
              if (!(await action(window.chromaShift.reorderProfiles(profileIds, interactionId))))
                throw new Error('Could not save profile order.')
            }}
          />
        )}
        <Flex flex={1} minW={0} minH={0} flexDir="column" gap={3}>
          <Flex
            as="main"
            data-part="main-panel"
            flex={1}
            gap={2}
            flexDir={'column'}
            minH={0}
            p="20px"
            overflow="auto"
            rounded="xl"
            bg={{ base: 'bg', _dark: 'bg.muted' }}
          >
            {view === 'profiles' && (
              <>
                {shownProfile === null ? (
                  <Empty title="No profile selected" />
                ) : (
                  <ProfileDetail
                    profile={shownProfile}
                    product={product}
                    busy={busy}
                    dirty={dirty}
                    onChange={updateDraft}
                    onCancel={() =>
                      perform(async () => {
                        await rollback()
                        await returnToLive()
                      })
                    }
                    onSave={() =>
                      perform(async () => {
                        await updateProfile()
                        await returnToLive()
                      })
                    }
                    onCopy={() => createProfile(shownProfile)}
                    onDelete={() => requestProfileDeletion(shownProfile)}
                    onToggleEnabled={() => toggleProfileEnabled(shownProfile)}
                    onError={setError}
                  />
                )}
              </>
            )}
            {view === 'displays' && <DisplaysView product={product} onError={setError} />}
            {view === 'settings' && <SettingsPanel product={product} onError={setError} />}
            {view === 'shortcuts' && <ShortcutsPanel product={product} onError={setError} />}
            {view === 'diagnostics' && <DiagnosticsPanel onError={setError} />}
            {view === 'about' && <AboutPanel version={product.version} />}
          </Flex>
          {showPreviewBanner && shownProfile !== null && (
            <Flex
              data-part="preview-banner"
              flexShrink={0}
              p="3"
              gap="3"
              align="center"
              rounded="lg"
              bg="colorPalette.subtle"
              color="fg"
              colorPalette="blue"
            >
              <Stack flex="1" minW="0" gap="0">
                <Text fontWeight="medium" truncate>
                  ◉ Previewing {shownProfile.name}
                </Text>
                <Text color="fg.muted" fontSize="sm">
                  Automatic would use: {automaticProfileName(product)}
                </Text>
                {emptyPreviewMessage(product, shownProfile) !== null && (
                  <Text color="fg.muted" fontSize="sm">
                    {emptyPreviewMessage(product, shownProfile)}
                  </Text>
                )}
              </Stack>
              <Button
                size="xs"
                disabled={busy}
                onClick={() => {
                  if (!shownProfile.enabled) {
                    toggleProfileEnabled(shownProfile)
                    return
                  }
                  perform(async () => {
                    if (dirty) await updateProfile()
                    else await rollback()
                    await value(window.chromaShift.activateProfile(shownProfile.id))
                    await returnToLive()
                  })
                }}
              >
                {shownProfile.enabled ? 'Use this profile' : 'Enable'}
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={endPreview}>
                End preview
              </Button>
            </Flex>
          )}
        </Flex>
      </Flex>
      <ProfileActionDialog
        open={pendingContinuation !== null}
        title={`${shownProfile?.name ?? 'Profile'} has unsaved changes`}
        description="Update or discard them before continuing."
        primaryLabel="Update profile"
        busy={busy}
        onPrimary={() => resolveChanges(true)}
        onDiscard={() => resolveChanges(false)}
        onCancel={() => setPendingContinuation(null)}
      />
      <ProfileActionDialog
        open={pendingDisable !== null}
        title={`Disable ${pendingDisable?.profile.name ?? 'profile'}?`}
        description={`Its shortcut ${pendingDisable?.accelerator ?? ''} will be removed.`}
        primaryLabel="Disable"
        danger
        busy={busy}
        onPrimary={() => {
          const pending = pendingDisable
          if (pending === null) return
          perform(async () => {
            await value(
              window.chromaShift.saveProfile({ ...pending.profile, enabled: false }, true)
            )
            setPendingDisable(null)
          })
        }}
        onCancel={() => setPendingDisable(null)}
      />
      <DeleteProfileDialog
        profile={profilePendingDeletion}
        busy={busy}
        onCancel={() => setProfilePendingDeletion(null)}
        onConfirm={confirmProfileDeletion}
      />
    </VStack>
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

const appPanelViews: AppPanelView[] = [
  'profiles',
  'displays',
  'settings',
  'shortcuts',
  'diagnostics',
  'about'
]

function readLastView(): AppPanelView {
  const remembered = localStorage.getItem(LAST_VIEW_KEY)
  return appPanelViews.find((candidate) => candidate === remembered) ?? 'profiles'
}
