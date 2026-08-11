import { Button, IconButton } from '@chakra-ui/react'
import { Monitor, Palette, RotateCcw, Save, Settings as SettingsIcon, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ColorProfile } from '@chromashift/core'
import { Brand, Empty, NavButton } from '@/components/layout/presentational'
import { DisplaysView } from '@/features/displays/displays-view'
import { resetRememberedColorValues } from '@/features/profiles/color-controls'
import { ProfileDetail } from '@/features/profiles/profile-detail'
import { ProfileList } from '@/features/profiles/profile-list'
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

export function MainApp({ product }: { product: ProductState }): React.JSX.Element {
  const [view, setView] = useState<AppPanelView>('profiles')
  const [selectedId, setSelectedId] = useState(product.configuration.profiles[0]?.id ?? null)
  const [draft, setDraft] = useState<ColorProfile | null>(null)
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
    if (!editing && selected !== null) setDraft(structuredClone(selected))
  }, [selected, editing])

  const draftSignature = JSON.stringify(draft)
  useEffect(() => {
    if (!editing || draft === null || draft.displays.length === 0) return
    const generation = editPreviewGeneration.current
    const timer = setTimeout(() => {
      if (generation !== editPreviewGeneration.current) return
      const request =
        activeSession?.kind === 'edit' && activeSession.profileId === draft.id
          ? window.chromaShift.updatePreview(
              draft.id,
              draft.color,
              draft.displays.map((item) => item.displayId)
            )
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

  async function beginEdit(): Promise<void> {
    if (activeSession?.kind === 'preview') {
      await run(window.chromaShift.cancelPreview(), setError)
    }
    editPreviewGeneration.current += 1
    resetRememberedColorValues(selected)
    setDraft(structuredClone(selected))
    setEditing(true)
    setDirty(false)
  }

  async function cancelEdit(): Promise<void> {
    const rollback = rollbackEditPreview()
    resetRememberedColorValues(selected)
    setDraft(selected === null ? null : structuredClone(selected))
    setEditing(false)
    setDirty(false)
    await rollback
  }

  const shownProfile = draft ?? selected
  const shownColor =
    !editing && temporaryOverride !== null && temporaryOverride.profileId === shownProfile?.id
      ? temporaryOverride.color
      : (shownProfile?.color ?? {})

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav>
          <NavButton
            active={view === 'profiles'}
            icon={<Palette />}
            label="Profiles"
            onClick={() => void navigate('profiles')}
          />
          <NavButton
            active={view === 'displays'}
            icon={<Monitor />}
            label="Displays"
            onClick={() => void navigate('displays')}
          />
          <NavButton
            active={view === 'settings'}
            icon={<SettingsIcon />}
            label="Settings"
            onClick={() => void navigate('settings')}
          />
        </nav>
      </aside>
      <main className="main-panel">
        {error !== null && (
          <div className="error-banner" role="alert">
            <span>{error.message}</span>
            <IconButton variant="ghost" aria-label="Dismiss error" onClick={() => setError(null)}>
              <X />
            </IconButton>
          </div>
        )}
        {temporaryOverride !== null && (
          <div className="override-banner">
            <div>
              <strong>Temporary overrides active</strong>
              <span>The applied values differ from the saved profile.</span>
            </div>
            <Button
              colorPalette="brand"
              variant="outline"
              onClick={() => void action(window.chromaShift.cancelPreview())}
            >
              <RotateCcw />
              Reset changes
            </Button>
            <Button
              colorPalette="brand"
              onClick={() => {
                const profile = product.configuration.profiles.find(
                  (item) => item.id === temporaryOverride.profileId
                )
                if (profile !== undefined) {
                  void action(
                    window.chromaShift.confirmPreview(
                      { ...profile, color: temporaryOverride.color },
                      'preserve'
                    )
                  )
                }
              }}
            >
              <Save />
              Update profile
            </Button>
          </div>
        )}
        {view === 'profiles' && (
          <div className="profile-workspace">
            <ProfileList
              profiles={product.configuration.profiles}
              selectedId={shownProfile?.id ?? null}
              onSelect={(profile) => void selectProfile(profile)}
              onCreate={() =>
                void action(window.chromaShift.createProfile('New profile'), (profile) => {
                  setSelectedId(profile.id)
                  setDraft(profile)
                  setEditing(true)
                })
              }
            />
            {shownProfile === null ? (
              <Empty title="No profile selected" />
            ) : (
              <ProfileDetail
                profile={shownProfile}
                color={shownColor}
                product={product}
                editing={editing}
                busy={busy}
                dirty={dirty}
                previewing={
                  activeSession?.kind === 'preview' && activeSession.profileId === shownProfile.id
                }
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
                onEnabled={(enabled) =>
                  void action(window.chromaShift.saveProfile({ ...shownProfile, enabled }))
                }
                onError={setError}
              />
            )}
          </div>
        )}
        {view === 'displays' && <DisplaysView product={product} />}
        {view === 'settings' && <SettingsPanel product={product} onError={setError} />}
      </main>
    </div>
  )
}
