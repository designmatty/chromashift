import { Alert, Button, CloseButton, Flex, Heading, Stack, Text, VStack } from '@chakra-ui/react'
import { CircleAlert, Power } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ColorProfile } from '@chromashift/core'
import { Empty, TitleBar } from '@/components/layout/presentational'
import { DisplaysView } from '@/features/settings/displays-view'
import { DiagnosticsPanel } from '@/features/settings/diagnostics-panel'
import { resetRememberedColorValues } from '@/features/profiles/color-controls'
import { ProfileDetail } from '@/features/profiles/profile-detail'
import { ProfileList } from '@/features/profiles/profile-list'
import { DeleteProfileDialog } from '@/features/profiles/delete-profile-dialog'
import { applyOverrideTargets } from '@/features/profiles/override-targets'
import { usePreviewDraft } from '@/features/profiles/use-preview-draft'
import { AboutPanel } from '@/features/settings/about-panel'
import { SettingsNav } from '@/features/settings/settings-nav'
import { SettingsPanel } from '@/features/settings/settings-panel'
import { ShortcutsPanel } from '@/features/settings/shortcuts-panel'
import { useProductTheme } from '@/hooks/use-product-theme'
import { run } from '@/lib/product-result'
import type {
  AppPanelView,
  ProductError,
  ProductResult,
  ProductState
} from '../../shared/product-api.js'

const DEFAULT_ID = 'default'
const LAST_PROFILE_KEY = 'chromashift.app-panel.selected-profile'
const LAST_VIEW_KEY = 'chromashift.app-panel.view'

export function MainApp({ product }: { product: ProductState }): React.JSX.Element {
  const [view, setView] = useState<AppPanelView>(readLastView)
  const [selectedId, setSelectedId] = useState(() => {
    const remembered = localStorage.getItem(LAST_PROFILE_KEY)
    return product.configuration.profiles.some((profile) => profile.id === remembered)
      ? remembered
      : (product.configuration.profiles[0]?.id ?? null)
  })
  const [expandedDisplayIds, setExpandedDisplayIds] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<ProductError | null>(null)
  const [busy, setBusy] = useState(false)
  const [profilePendingDeletion, setProfilePendingDeletion] = useState<ColorProfile | null>(null)
  const { draft, dirty, updateDraft, replaceDraft, resetTo, invalidateSync, rollbackPreview } =
    usePreviewDraft({
      kind: 'edit',
      session: product.preview,
      enabled: editing,
      onError: setError
    })
  const selected =
    product.configuration.profiles.find((profile) => profile.id === selectedId) ??
    product.configuration.profiles[0] ??
    null
  const activeSession = product.preview.state === 'active' ? product.preview : null
  const temporaryOverride = activeSession?.kind === 'override' ? activeSession : null

  useProductTheme(product.settings.theme)

  useEffect(() => {
    localStorage.setItem(LAST_VIEW_KEY, view)
  }, [view])

  useEffect(() => {
    if (selectedId === null) localStorage.removeItem(LAST_PROFILE_KEY)
    else localStorage.setItem(LAST_PROFILE_KEY, selectedId)
  }, [selectedId])

  useEffect(() => {
    if (!editing && selected !== null) replaceDraft(structuredClone(selected))
  }, [selected, editing])

  const connectedDisplayIds = new Set(product.displays.map((display) => display.id.toLowerCase()))
  const selectedDisplayIds =
    selected?.displays
      .map((target) => target.displayId)
      .filter((displayId) => connectedDisplayIds.has(displayId.toLowerCase())) ?? []
  const selectedDisplayIdsSignature = selectedDisplayIds.join('\u0000')

  // Viewing or editing a profile starts with every overridden display open.
  useEffect(() => {
    setExpandedDisplayIds(selectedDisplayIds)
  }, [selected?.id, selectedDisplayIdsSignature, editing])

  async function rollbackExplicitPreview(): Promise<void> {
    const current = await run(window.chromaShift.getState(), setError)
    if (current?.preview.state === 'active' && current.preview.kind === 'preview') {
      await run(window.chromaShift.cancelPreview(), setError)
    }
  }

  async function action<T>(
    request: Promise<ProductResult<T>>,
    done?: (value: T) => void
  ): Promise<void> {
    setBusy(true)
    setError(null)
    const value = await run(request, setError)
    if (value !== undefined) done?.(value)
    setBusy(false)
  }

  async function selectProfile(profile: ColorProfile): Promise<void> {
    if (editing && dirty && !confirm('Discard the changes to this profile?')) return
    const leavingProfile =
      selected !== null && selected.id.toLowerCase() !== profile.id.toLowerCase()
    const rollback = editing
      ? rollbackPreview()
      : leavingProfile
        ? run(window.chromaShift.cancelPreview(), setError)
        : Promise.resolve()
    if (editing) resetRememberedColorValues(selected)
    setSelectedId(profile.id)
    resetTo(profile)
    setEditing(false)
    await rollback
  }

  async function navigate(nextView: AppPanelView): Promise<void> {
    if (nextView === view) return
    if (editing && dirty && !confirm('Discard the changes to this profile?')) return
    const rollback = editing
      ? rollbackPreview()
      : view === 'profiles'
        ? rollbackExplicitPreview()
        : Promise.resolve()
    if (editing) resetRememberedColorValues(selected)
    resetTo(selected)
    setEditing(false)
    setView(nextView)
    await rollback
  }

  useEffect(() => {
    window.chromaShift.onAppPanelNavigation((nextView) => void navigate(nextView))
  })

  useEffect(() => {
    window.chromaShift.onAppPanelProfileSelection((profileId) => {
      const profile = product.configuration.profiles.find(
        (candidate) => candidate.id.toLowerCase() === profileId.toLowerCase()
      )
      if (profile === undefined) return
      setView('profiles')
      void selectProfile(profile)
    })
  })

  useEffect(() => {
    window.chromaShift.onAppPanelClosed(() => {
      if (!editing) return
      const rollback = rollbackPreview()
      resetRememberedColorValues(selected)
      resetTo(selected)
      setEditing(false)
      void rollback
    })
  })

  async function beginEdit(profile: ColorProfile | null = selected): Promise<void> {
    if (profile === null) return
    const changingProfile = selected?.id !== profile.id
    const promotingPreview =
      !changingProfile &&
      activeSession?.kind === 'preview' &&
      activeSession.profileId.toLowerCase() === profile.id.toLowerCase()
    if (changingProfile && editing && dirty && !confirm('Discard the changes to this profile?')) {
      return
    }
    const rollback = editing
      ? rollbackPreview()
      : activeSession?.kind === 'preview' && !promotingPreview
        ? run(window.chromaShift.cancelPreview(), setError)
        : Promise.resolve()
    invalidateSync()
    if (editing) resetRememberedColorValues(selected)
    setSelectedId(profile.id)
    resetTo(profile)
    setEditing(true)
    await rollback
    if (promotingPreview) {
      const result = await window.chromaShift.startPreview(profile, 'edit')
      if (!result.ok) setError(result.error)
    }
  }

  async function previewProfile(profile: ColorProfile): Promise<void> {
    const changingProfile = selected?.id !== profile.id
    if (changingProfile && editing && dirty && !confirm('Discard the changes to this profile?')) {
      return
    }
    const rollback = editing
      ? rollbackPreview()
      : changingProfile
        ? run(window.chromaShift.cancelPreview(), setError)
        : Promise.resolve()
    if (editing) resetRememberedColorValues(selected)
    setSelectedId(profile.id)
    resetTo(profile)
    setEditing(false)
    await rollback
    await action(
      activeSession?.kind === 'preview' && activeSession.profileId === profile.id
        ? window.chromaShift.cancelPreview()
        : window.chromaShift.startPreview(profile, 'preview')
    )
  }

  async function cancelEdit(): Promise<void> {
    const rollback = rollbackPreview()
    resetRememberedColorValues(selected)
    resetTo(selected)
    setEditing(false)
    await rollback
  }

  function requestProfileDeletion(profile: ColorProfile): void {
    // Let the Chakra menu close and restore focus to its trigger before opening
    // the modal dialog. The trigger may disappear after deletion succeeds.
    requestAnimationFrame(() => setProfilePendingDeletion(profile))
  }

  function confirmProfileDeletion(): void {
    const profile = profilePendingDeletion
    if (profile === null) return
    void action(window.chromaShift.deleteProfile(profile.id), () => {
      const deletedProfileWasSelected = selected?.id.toLowerCase() === profile.id.toLowerCase()
      if (deletedProfileWasSelected) {
        invalidateSync()
        if (editing) resetRememberedColorValues(selected)
        setSelectedId(DEFAULT_ID)
        resetTo(null)
        setEditing(false)
      }
      setProfilePendingDeletion(null)
    })
  }

  function toggleProfileEnabled(profile: ColorProfile): void {
    const enabled = !profile.enabled
    const binding = product.settings.shortcutBindings.find(
      (candidate) =>
        candidate.action.kind === 'profile' &&
        candidate.action.profileId.toLowerCase() === profile.id.toLowerCase()
    )
    const removeShortcut = !enabled && binding !== undefined
    if (
      removeShortcut &&
      !confirm(
        `This will remove the ${binding.accelerator} shortcut from "${profile.name}". Continue?`
      )
    ) {
      return
    }
    void action(window.chromaShift.saveProfile({ ...profile, enabled }, removeShortcut))
  }

  const savedProfile = draft ?? selected
  // A temporary override replaces the saved values on the displays it touched, so
  // the read-only view shows what is actually applied right now.
  const shownProfile =
    !editing &&
    temporaryOverride !== null &&
    savedProfile !== null &&
    temporaryOverride.profileId === savedProfile.id
      ? applyOverrideTargets(savedProfile, temporaryOverride.targets)
      : savedProfile

  const inSettings = view !== 'profiles'
  const activeProfileId =
    product.chromaShift.intendedTarget?.kind === 'profile'
      ? product.chromaShift.intendedTarget.profileId
      : null

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
            You have temporary overrides on{' '}
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
          onClick={() => void action(window.chromaShift.cancelPreview())}
        >
          Reset changes
        </Button>
        <Button
          size={'xs'}
          onClick={() => {
            const profile = product.configuration.profiles.find(
              (item) => item.id === temporaryOverride.profileId
            )
            if (profile !== undefined) {
              void action(
                window.chromaShift.confirmPreview(
                  applyOverrideTargets(profile, temporaryOverride.targets),
                  'preserve'
                )
              )
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
        brandAccessory={
          <Button
            data-part="chromashift-control"
            data-status={product.chromaShift.status === 'active' ? 'active' : 'paused'}
            size="2xs"
            variant="subtle"
            colorPalette={product.chromaShift.status === 'active' ? 'green' : 'gray'}
            rounded="sm"
            disabled={product.chromaShift.transitionInProgress}
            loading={product.chromaShift.transitionInProgress}
            aria-label={chromaShiftActionLabel(product)}
            onClick={() =>
              void run(window.chromaShift.controlChromaShift(chromaShiftAction(product)), setError)
            }
          >
            <Power size={14} />
            {product.chromaShift.status === 'active' ? 'Active' : 'Paused'}
          </Button>
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
      <Flex data-part="app-body" overflow={'auto'} gap="4" flex={1} paddingX={4} paddingBottom={4}>
        {inSettings ? (
          <SettingsNav
            page={view}
            onSelect={(page) => void navigate(page)}
            onBack={() => void navigate('profiles')}
          />
        ) : (
          <ProfileList
            profiles={product.configuration.profiles}
            selectedId={shownProfile?.id ?? null}
            activeId={activeProfileId}
            editingProfileId={editing ? (shownProfile?.id ?? null) : null}
            previewingProfileId={activeSession?.kind === 'preview' ? activeSession.profileId : null}
            automatic={product.chromaShift.intendedMode.kind === 'automatic'}
            onSelect={(profile) => void selectProfile(profile)}
            onCreate={() =>
              void action(window.chromaShift.createProfile('New profile'), (profile) => {
                setSelectedId(profile.id)
                replaceDraft(profile)
                setEditing(true)
              })
            }
            onToggleAutomatic={(value) => {
              if (value) void action(window.chromaShift.enableAutomatic())
              else if (activeProfileId !== null) {
                void action(window.chromaShift.activateProfile(activeProfileId))
              }
            }}
            onOpenSettings={() => void navigate('settings')}
            onEdit={(profile) => void beginEdit(profile)}
            onPreview={(profile) => void previewProfile(profile)}
            onDuplicate={(profile) =>
              void action(window.chromaShift.duplicateProfile(profile.id), (copy) => {
                setSelectedId(copy.id)
                replaceDraft(copy)
              })
            }
            onToggleEnabled={toggleProfileEnabled}
            onDelete={requestProfileDeletion}
            onReorder={(profileIds) => void action(window.chromaShift.reorderProfiles(profileIds))}
          />
        )}
        <Flex
          as="main"
          data-part="main-panel"
          flex={1}
          gap={2}
          flexDir={'column'}
          h="full"
          minH="full"
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
                  expandedDisplayIds={expandedDisplayIds}
                  onExpandedDisplaysChange={setExpandedDisplayIds}
                  editing={editing}
                  busy={busy}
                  dirty={dirty}
                  previewing={
                    activeSession?.kind === 'preview' && activeSession.profileId === shownProfile.id
                  }
                  active={activeProfileId?.toLowerCase() === shownProfile.id.toLowerCase()}
                  onEdit={() => void beginEdit()}
                  onChange={(profile) => updateDraft(profile)}
                  onCancel={() => void cancelEdit()}
                  onSave={() =>
                    void action(
                      activeSession?.kind === 'edit'
                        ? window.chromaShift.confirmPreview(shownProfile, 'preserve')
                        : window.chromaShift.saveProfile(shownProfile),
                      (saved) => {
                        resetTo(saved)
                        setEditing(false)
                      }
                    )
                  }
                  onPreview={() =>
                    void action(
                      activeSession?.kind === 'preview'
                        ? window.chromaShift.cancelPreview()
                        : window.chromaShift.startPreview(shownProfile, 'preview')
                    )
                  }
                  onCopy={() =>
                    void action(window.chromaShift.duplicateProfile(shownProfile.id), (copy) => {
                      setSelectedId(copy.id)
                      replaceDraft(copy)
                    })
                  }
                  onDelete={() => requestProfileDeletion(shownProfile)}
                  onActiveChange={(active) =>
                    void action(
                      active
                        ? window.chromaShift.activateProfile(shownProfile.id)
                        : window.chromaShift.enableAutomatic()
                    )
                  }
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
      </Flex>
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
