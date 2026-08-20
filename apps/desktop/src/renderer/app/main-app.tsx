import { Alert, Button, CloseButton, Flex, Heading, Stack, Text, VStack } from '@chakra-ui/react'
import { CircleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { activeColorTargets, type ColorProfile } from '@chromashift/core'
import { Empty, TitleBar } from '@/components/layout/presentational'
import { DisplaysView } from '@/features/settings/displays-view'
import { resetRememberedColorValues } from '@/features/profiles/color-controls'
import { ProfileDetail } from '@/features/profiles/profile-detail'
import { ProfileList } from '@/features/profiles/profile-list'
import { DeleteProfileDialog } from '@/features/profiles/delete-profile-dialog'
import { applyOverrideTargets } from '@/features/profiles/override-targets'
import { AboutPanel } from '@/features/settings/about-panel'
import { SettingsNav } from '@/features/settings/settings-nav'
import { SettingsPanel } from '@/features/settings/settings-panel'
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
  const [draft, setDraft] = useState<ColorProfile | null>(null)
  const [expandedDisplayIds, setExpandedDisplayIds] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<ProductError | null>(null)
  const [busy, setBusy] = useState(false)
  const [profilePendingDeletion, setProfilePendingDeletion] = useState<ColorProfile | null>(null)
  const editPreviewGeneration = useRef(0)
  const pendingEditPreviews = useRef(new Set<Promise<unknown>>())
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
    if (!editing && selected !== null) setDraft(structuredClone(selected))
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

  const draftSignature = JSON.stringify(draft)
  useEffect(() => {
    if (!editing || draft === null || draft.displays.length === 0) return
    const generation = editPreviewGeneration.current
    const timer = setTimeout(() => {
      if (generation !== editPreviewGeneration.current) return
      const request =
        activeSession?.kind === 'edit' && activeSession.profileId === draft.id
          ? window.chromaShift.updatePreview(draft.id, activeColorTargets(draft))
          : window.chromaShift.startPreview(draft, 'edit')
      const pending = run(request, setError)
      pendingEditPreviews.current.add(pending)
      void pending.finally(() => pendingEditPreviews.current.delete(pending))
    }, 120)
    return () => clearTimeout(timer)
  }, [editing, draftSignature, activeSession?.kind, activeSession?.profileId])

  async function rollbackEditPreview(): Promise<void> {
    editPreviewGeneration.current += 1
    await Promise.allSettled([...pendingEditPreviews.current])
    await run(window.chromaShift.cancelPreview(), setError)
  }

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
      ? rollbackEditPreview()
      : leavingProfile
        ? run(window.chromaShift.cancelPreview(), setError)
        : Promise.resolve()
    if (editing) resetRememberedColorValues(selected)
    setSelectedId(profile.id)
    setDraft(structuredClone(profile))
    setEditing(false)
    setDirty(false)
    await rollback
  }

  async function navigate(nextView: AppPanelView): Promise<void> {
    if (nextView === view) return
    if (editing && dirty && !confirm('Discard the changes to this profile?')) return
    const rollback = editing
      ? rollbackEditPreview()
      : view === 'profiles'
        ? rollbackExplicitPreview()
        : Promise.resolve()
    if (editing) resetRememberedColorValues(selected)
    setDraft(selected === null ? null : structuredClone(selected))
    setEditing(false)
    setDirty(false)
    setView(nextView)
    await rollback
  }

  useEffect(() => {
    window.chromaShift.onAppPanelNavigation((nextView) => void navigate(nextView))
  })

  useEffect(() => {
    window.chromaShift.onAppPanelClosed(() => {
      if (!editing) return
      const rollback = rollbackEditPreview()
      resetRememberedColorValues(selected)
      setDraft(selected === null ? null : structuredClone(selected))
      setEditing(false)
      setDirty(false)
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
      ? rollbackEditPreview()
      : activeSession?.kind === 'preview' && !promotingPreview
        ? run(window.chromaShift.cancelPreview(), setError)
        : Promise.resolve()
    editPreviewGeneration.current += 1
    if (editing) resetRememberedColorValues(selected)
    setSelectedId(profile.id)
    setDraft(structuredClone(profile))
    setEditing(true)
    setDirty(false)
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
      ? rollbackEditPreview()
      : changingProfile
        ? run(window.chromaShift.cancelPreview(), setError)
        : Promise.resolve()
    if (editing) resetRememberedColorValues(selected)
    setSelectedId(profile.id)
    setDraft(structuredClone(profile))
    setEditing(false)
    setDirty(false)
    await rollback
    await action(
      activeSession?.kind === 'preview' && activeSession.profileId === profile.id
        ? window.chromaShift.cancelPreview()
        : window.chromaShift.startPreview(profile, 'preview')
    )
  }

  async function cancelEdit(): Promise<void> {
    const rollback = rollbackEditPreview()
    resetRememberedColorValues(selected)
    setDraft(selected === null ? null : structuredClone(selected))
    setEditing(false)
    setDirty(false)
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
        editPreviewGeneration.current += 1
        if (editing) resetRememberedColorValues(selected)
        setSelectedId(DEFAULT_ID)
        setDraft(null)
        setEditing(false)
        setDirty(false)
      }
      setProfilePendingDeletion(null)
    })
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
    product.activation.currentTarget?.kind === 'profile'
      ? product.activation.currentTarget.profileId
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
      <TitleBar />
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
            automatic={product.activation.mode.kind === 'automatic'}
            onSelect={(profile) => void selectProfile(profile)}
            onCreate={() =>
              void action(window.chromaShift.createProfile('New profile'), (profile) => {
                setSelectedId(profile.id)
                setDraft(profile)
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
                setDraft(copy)
              })
            }
            onToggleEnabled={(profile) =>
              void action(window.chromaShift.saveProfile({ ...profile, enabled: !profile.enabled }))
            }
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
                  onChange={(profile) => {
                    setDraft(profile)
                    setDirty(true)
                  }}
                  onCancel={() => void cancelEdit()}
                  onSave={() =>
                    void action(
                      activeSession?.kind === 'edit'
                        ? window.chromaShift.confirmPreview(shownProfile, 'preserve')
                        : window.chromaShift.saveProfile(shownProfile),
                      (saved) => {
                        setDraft(saved)
                        setEditing(false)
                        setDirty(false)
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
                      setDraft(copy)
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
                  onToggleEnabled={() =>
                    void action(
                      window.chromaShift.saveProfile({
                        ...shownProfile,
                        enabled: !shownProfile.enabled
                      })
                    )
                  }
                  onError={setError}
                />
              )}
            </>
          )}
          {view === 'displays' && <DisplaysView product={product} onError={setError} />}
          {view === 'settings' && <SettingsPanel product={product} onError={setError} />}
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

const appPanelViews: AppPanelView[] = ['profiles', 'displays', 'settings', 'about']

function readLastView(): AppPanelView {
  const remembered = localStorage.getItem(LAST_VIEW_KEY)
  return appPanelViews.find((candidate) => candidate === remembered) ?? 'profiles'
}
