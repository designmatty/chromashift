import { Box, Button, Flex, Grid, Heading, IconButton, Stack, Text } from '@chakra-ui/react'
import { CircleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { activeColorTargets, type ColorProfile } from '@chromashift/core'
import { Empty, TitleBar } from '@/components/layout/presentational'
import { DisplaysView } from '@/features/displays/displays-view'
import { resetRememberedColorValues } from '@/features/profiles/color-controls'
import { ProfileDetail } from '@/features/profiles/profile-detail'
import { ProfileList } from '@/features/profiles/profile-list'
import { applyOverrideTargets } from '@/features/profiles/override-targets'
import { AboutPanel } from '@/features/settings/about-panel'
import { SettingsNav } from '@/features/settings/settings-nav'
import { SettingsPanel } from '@/features/settings/settings-panel'
import { useProductTheme } from '@/hooks/use-product-theme'
import { run } from '@/lib/product-result'
import {
  DEFAULT_SIDEBAR_WIDTH,
  resolveSidebarWidth,
  shouldStackPanels
} from '../../shared/layout.js'
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
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<ProductError | null>(null)
  const [busy, setBusy] = useState(false)
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
    const onResize = (): void => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (selectedId === null) localStorage.removeItem(LAST_PROFILE_KEY)
    else localStorage.setItem(LAST_PROFILE_KEY, selectedId)
  }, [selectedId])

  useEffect(() => {
    if (!editing && selected !== null) setDraft(structuredClone(selected))
  }, [selected, editing])

  // Switching profiles opens the first display this profile overrides.
  useEffect(() => {
    const first = selected?.displays[0]?.displayId ?? product.displays[0]?.id
    setExpandedDisplayIds(first === undefined ? [] : [first])
  }, [selected?.id])

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
  const stacked = shouldStackPanels(windowWidth)
  const sidebarWidth = resolveSidebarWidth(
    product.settings.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
    windowWidth
  )

  return (
    <Grid
      data-part="app-shell"
      w="full"
      h="full"
      p="10px"
      templateRows={temporaryOverride === null ? '41px minmax(0, 1fr)' : '41px 47px minmax(0, 1fr)'}
      gap="20px"
      overflow={stacked ? 'auto' : 'hidden'}
      borderWidth="1px"
      borderColor="border"
      rounded="20px"
      bg="bg"
      _dark={{
        borderWidth: '0',
        gridTemplateRows:
          temporaryOverride === null ? '37px minmax(0, 1fr)' : '37px 47px minmax(0, 1fr)'
      }}
    >
      <TitleBar />
      {temporaryOverride !== null && (
        <Flex
          data-part="override-banner"
          w="full"
          px="3"
          py="8"
          align="center"
          gap="3"
          rounded="lg"
          bg="bg.inverted"
          color="fg.inverted"
          _dark={{
            bg: 'bg.muted',
            color: 'fg.muted'
          }}
        >
          <CircleAlert size={20} />
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
      )}
      <Grid
        data-part="app-body"
        minW="0"
        minH="0"
        pl="10px"
        templateColumns={stacked ? 'minmax(0, 1fr)' : 'auto minmax(0, 1fr)'}
        templateRows={stacked ? 'auto minmax(520px, 1fr)' : undefined}
        gap="10px"
      >
        <Box
          as="aside"
          data-part="sidebar"
          w={stacked ? 'auto' : `${sidebarWidth}px`}
          minW="0"
          minH={stacked ? '260px' : '0'}
          py="10px"
          overflow="hidden"
        >
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
              previewingProfileId={
                activeSession?.kind === 'preview' ? activeSession.profileId : null
              }
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
                void action(
                  window.chromaShift.saveProfile({ ...profile, enabled: !profile.enabled })
                )
              }
              onDelete={(profile) => {
                if (confirm(`Delete “${profile.name}”?`)) {
                  void action(window.chromaShift.deleteProfile(profile.id), () =>
                    setSelectedId(DEFAULT_ID)
                  )
                }
              }}
              onReorder={(profileIds) =>
                void action(window.chromaShift.reorderProfiles(profileIds))
              }
            />
          )}
        </Box>
        <Box
          as="main"
          data-part="main-panel"
          minW="0"
          minH="0"
          overflow="auto"
          scrollbarWidth="thin"
        >
          {error !== null && (
            <Flex
              mb="10px"
              px="11px"
              py="9px"
              align="center"
              justify="space-between"
              gap="10px"
              rounded="6px"
              bg="status.errorBg"
              color="fg.error"
              role="alert"
            >
              <Text>{error.message}</Text>
              <IconButton variant="ghost" aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={20} />
              </IconButton>
            </Flex>
          )}
          {view === 'profiles' && (
            <Box minW="0" h="full" minH="full">
              {shownProfile === null ? (
                <Empty title="No profile selected" />
              ) : (
                <ProfileDetail
                  profile={shownProfile}
                  product={product}
                  expandedDisplayIds={expandedDisplayIds}
                  onExpandDisplay={(displayId, expanded) =>
                    setExpandedDisplayIds((current) =>
                      expanded
                        ? current.includes(displayId)
                          ? current
                          : [...current, displayId]
                        : current.filter((id) => id !== displayId)
                    )
                  }
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
                  onDelete={() => {
                    if (confirm(`Delete “${shownProfile.name}”?`)) {
                      void action(window.chromaShift.deleteProfile(shownProfile.id), () =>
                        setSelectedId(DEFAULT_ID)
                      )
                    }
                  }}
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
            </Box>
          )}
          {view === 'displays' && <DisplaysView product={product} onError={setError} />}
          {view === 'settings' && <SettingsPanel product={product} onError={setError} />}
          {view === 'about' && <AboutPanel version={product.version} />}
        </Box>
      </Grid>
    </Grid>
  )
}

const appPanelViews: AppPanelView[] = ['profiles', 'displays', 'settings', 'about']

function readLastView(): AppPanelView {
  const remembered = localStorage.getItem(LAST_VIEW_KEY)
  return appPanelViews.find((candidate) => candidate === remembered) ?? 'profiles'
}
