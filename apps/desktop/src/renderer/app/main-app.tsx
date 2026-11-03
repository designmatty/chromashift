import { Alert, Button, CloseButton, Flex, Icon, Stack, Text, VStack } from '@chakra-ui/react'
import { Power } from 'lucide-react'
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
  isProfileClickNoop,
  keepsPreviewBannerWhileSwitching,
  previewBannerVisible,
  discardPlan,
  updatePlan
} from '@/features/profiles/app-preview-state'
import { DeleteProfileDialog } from '@/features/profiles/delete-profile-dialog'
import { applyOverrideTargets } from '@/features/profiles/override-targets'
import {
  commitAppPreview,
  deleteAppProfile,
  revertAppPreview,
  saveAppPreview
} from '@/features/profiles/app-preview-actions'
import { usePreviewDraft } from '@/features/profiles/use-preview-draft'
import { AboutPanel } from '@/features/settings/about-panel'
import { SettingsNav } from '@/features/settings/settings-nav'
import { SettingsPanel } from '@/features/settings/settings-panel'
import { ShortcutsPanel } from '@/features/settings/shortcuts-panel'
import { useProductTheme } from '@/hooks/use-product-theme'
import { run } from '@/lib/product-result'
import type { AppPanelView, ProductError, ProductResult, ProductState } from '@shared/product-api'
import { formatShortcutAccelerator } from '@shared/shortcut-constants'
import { autoSwitchingOnHold, hasUnsavedSession } from '@shared/unsaved-changes'
import {
  appSessionDraft,
  initialAppView,
  shouldEndPreviewOnMinimize
} from '@/features/profiles/app-preview-state'

const LAST_PROFILE_KEY = 'chromashift.app-panel.selected-profile'
const LAST_VIEW_KEY = 'chromashift.app-panel.view'
const SIDEBAR_COLLAPSED_KEY = 'chromashift.app-panel.sidebar-collapsed'

export function MainApp({ product }: { product: ProductState }): React.JSX.Element {
  const [view, setView] = useState<AppPanelView>(() => initialAppView(product, readLastView()))
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  )
  const [selectedId, setSelectedId] = useState(() => appSessionDraft(product)?.id ?? null)
  const [error, setError] = useState<ProductError | null>(null)
  const [busy, setBusy] = useState(false)
  const [namingProfileId, setNamingProfileId] = useState<string | null>(null)
  const [profilePendingDeletion, setProfilePendingDeletion] = useState<ColorProfile | null>(null)
  // Destination of a preview-to-preview switch, keeping the banner mounted
  // while the previous session rolls back and the next one starts.
  const [pendingPreviewId, setPendingPreviewId] = useState<string | null>(null)
  const [pendingContinuation, setPendingContinuation] = useState<(() => Promise<void>) | null>(null)
  const [pendingDisable, setPendingDisable] = useState<{
    profile: ColorProfile
    accelerator: string
  } | null>(null)
  const taskTail = useRef(Promise.resolve())
  const followingLive = useRef(true)
  const locallyEdited = useRef(false)
  const {
    draft,
    dirty,
    updateDraft: changeDraft,
    resetTo: resetDraft,
    invalidateSync,
    settlePreview,
    rollbackPreview
  } = usePreviewDraft({
    kind: 'edit',
    session: product.preview,
    enabled: view === 'profiles' && !busy && product.chromaShift.status === 'active',
    onError: setError,
    initialDraft: () => appSessionDraft(product),
    savedProfile:
      product.configuration.profiles.find((profile) => profile.id === selectedId) ?? null
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
    // Main can still publish an older dirty draft after the user has reverted it.
    if (!dirty && !locallyEdited.current && selected !== null) {
      const unsaved = hasUnsavedSession(product.preview) && activeSession?.profileId === selected.id
      resetTo(unsaved ? appSessionDraft(product) : selected, { dirty: unsaved })
    }
  }, [selected, activeSession?.profileId, activeSession?.kind])
  useEffect(() => {
    if (followingLive.current && !dirty && activeSession === null) setSelectedId(currentProfileId)
  }, [currentProfileId, activeSession, dirty])
  useEffect(() => {
    if (pendingPreviewId !== null && activeSession?.profileId === pendingPreviewId)
      setPendingPreviewId(null)
  }, [activeSession, pendingPreviewId])

  function updateDraft(profile: ColorProfile): void {
    locallyEdited.current = true
    changeDraft(profile)
  }
  function resetTo(profile: ColorProfile | null, options?: { dirty?: boolean }): void {
    locallyEdited.current = false
    resetDraft(profile, options)
  }

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
    setPendingPreviewId(null)
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
  // Header Update stays on the shown profile. Only the live profile commits and
  // ends its session; any other profile saves while its preview keeps running.
  async function updateShownProfile(): Promise<void> {
    if (draft === null) return
    const state = await value(window.chromaShift.getState())
    if (updatePlan(state, draft.id) === 'commit') {
      await updateProfile()
      await returnToLive()
      return
    }
    const saved = await saveAppPreview(draft, settlePreview, window.chromaShift)
    followingLive.current = false
    setSelectedId(saved.id)
    resetTo(saved)
  }
  // Header Discard stays on the shown profile, previewing its saved values as
  // if it had just been clicked.
  async function discardShownChanges(): Promise<void> {
    const profileId = draft?.id ?? selected?.id
    if (profileId === undefined) return
    await settlePreview()
    const state = await value(window.chromaShift.getState())
    const saved = state.configuration.profiles.find((item) => item.id === profileId)
    const plan = discardPlan(state, saved)
    if (plan === 'returnToLive' || saved === undefined) {
      await rollback()
      await returnToLive()
      return
    }
    followingLive.current = false
    setSelectedId(saved.id)
    if (plan === 'revertSession') {
      await revertAppPreview(saved, settlePreview, window.chromaShift)
      resetTo(saved)
      return
    }
    const previews = shouldPreviewProfile(state, saved)
    if (previews) setPendingPreviewId(saved.id)
    try {
      await rollback()
      resetTo(saved)
      if (previews) await value(window.chromaShift.startPreview(saved, 'preview'))
    } catch (cause) {
      setPendingPreviewId(null)
      throw cause
    }
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
    if (keepsPreviewBannerWhileSwitching(before, profile)) setPendingPreviewId(profile.id)
    try {
      const keepingOverride =
        before.preview.state === 'active' &&
        before.preview.kind === 'override' &&
        before.preview.profileId === profile.id
      if (before.chromaShift.status !== 'active') await settlePreview()
      else if (!keepingOverride) await rollback()
      const state = await value(window.chromaShift.getState())
      const current = state.configuration.profiles.find((item) => item.id === profile.id)
      if (current === undefined) {
        setPendingPreviewId(null)
        return
      }
      followingLive.current = liveProfile(state)?.id === current.id
      setSelectedId(current.id)
      resetTo(keepingOverride ? appSessionDraft(state) : current, { dirty: keepingOverride })
      setView('profiles')
      // The pending destination clears once its session reaches the renderer.
      if (shouldPreviewProfile(state, current))
        await value(window.chromaShift.startPreview(current, 'preview'))
      else setPendingPreviewId(null)
    } catch (cause) {
      setPendingPreviewId(null)
      throw cause
    }
  }
  function selectProfile(profile: ColorProfile): void {
    if (isProfileClickNoop(view, profile.id, selected?.id ?? null)) return
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
    const endAppPreview = (includeOverride = false) => {
      invalidateSync()
      setPendingContinuation(null)
      perform(async () => {
        if (includeOverride || temporaryOverride === null) await rollback()
        await returnToLive()
      })
    }
    window.chromaShift.onAppPanelClosed(endAppPreview)
    window.chromaShift.onAppPanelMinimized(() => {
      if (shouldEndPreviewOnMinimize(dirty)) endAppPreview(true)
    })
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
      // Reselect before closing: the dialog restores focus to the selected
      // profile row when it closes, and the deleted row is gone by then.
      if (selected?.id.toLowerCase() === profile.id.toLowerCase()) await returnToLive()
      setProfilePendingDeletion(null)
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
      if (copy === undefined) setNamingProfileId(profile.id)
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
    view === 'profiles' && previewBannerVisible(product, shownProfile, pendingPreviewId)
  const onHold = autoSwitchingOnHold(product) || (dirty && product.chromaShift.status === 'active')
  const queued = product.activation.queuedTarget
  const queuedName =
    queued?.kind === 'profile'
      ? (product.configuration.profiles.find((profile) => profile.id === queued.profileId)?.name ??
        'Profile')
      : 'Original settings'

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
          <Tooltip
            content={
              onHold
                ? 'Auto-switching on hold — unsaved changes. Update profile or discard changes to continue.'
                : chromaShiftActionLabel(product)
            }
          >
            <Button
              data-part="chromashift-control"
              data-status={product.chromaShift.status}
              size="2xs"
              variant="subtle"
              colorPalette={
                product.chromaShift.status === 'active'
                  ? onHold
                    ? 'yellow'
                    : 'green'
                  : product.chromaShift.status === 'safetyBlocked'
                    ? 'red'
                    : 'gray'
              }
              rounded="sm"
              _hover={{ bg: 'colorPalette.muted' }}
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
                ? onHold
                  ? 'Auto-switching on hold'
                  : 'Active'
                : product.chromaShift.status === 'safetyBlocked'
                  ? 'Safety blocked'
                  : 'Paused'}
            </Button>
          </Tooltip>
        }
      />
      {onHold && queued != null && (
        <Flex
          data-part="blocked-switch-toast"
          role="status"
          position="fixed"
          top="12"
          right="4"
          zIndex="toast"
          p="3"
          gap="3"
          align="center"
          rounded="lg"
          bg="bg.panel"
          borderWidth="1px"
          shadow="md"
        >
          <Text>
            {queuedName} not applied — unsaved changes on{' '}
            {shownProfile?.name ?? activeSession?.draft?.name ?? 'profile'}
          </Text>
          <Button
            size="xs"
            disabled={busy}
            onClick={() =>
              perform(async () => {
                await updateProfile()
                await returnToLive()
              })
            }
          >
            Update
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() =>
              perform(async () => {
                await rollback()
                await returnToLive()
              })
            }
          >
            Discard
          </Button>
        </Flex>
      )}
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
                    key={shownProfile.id}
                    startNaming={namingProfileId === shownProfile.id}
                    onNamingEnded={() => setNamingProfileId(null)}
                    profile={shownProfile}
                    product={product}
                    busy={busy}
                    dirty={dirty}
                    onChange={updateDraft}
                    onCancel={() => perform(discardShownChanges)}
                    onSave={() => perform(updateShownProfile)}
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
              <Icon asChild size="md">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 3H8" />
                  <path d="M12 17v4" />
                  <path d="M14 17H4a2 2 0 01-2-2v-2.536" />
                  <path d="M14 3h6a2 2 0 012 2v6.536" />
                  <path d="M20 15v4" />
                  <path d="M22 17h-4" />
                  <path d="M4 5v4" />
                  <path d="M6 7H2" />
                  <path d="M8 21h8" />
                  <path d="M9 2v2" />
                </svg>
              </Icon>
              <Stack flex="1" minW="0" gap="0">
                <Text truncate>Previewing: {shownProfile.name}</Text>
              </Stack>
              <Button
                size="2xs"
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
              <Button size="2xs" variant="outline" disabled={busy} onClick={endPreview}>
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
