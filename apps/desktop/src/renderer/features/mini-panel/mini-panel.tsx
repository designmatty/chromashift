import { Badge, Button, IconButton, Separator } from '@chakra-ui/react'
import {
  ArrowLeft,
  ExternalLink,
  Monitor,
  Settings as SettingsIcon,
  SlidersHorizontal,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ColorSettings } from '@chromashift/core'
import { Empty } from '@/components/layout/presentational'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip } from '@/components/ui/tooltip'
import {
  ColorControls,
  rememberedColorValues,
  resetRememberedColorValues
} from '@/features/profiles/color-controls'
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
  const [color, setColor] = useState<ColorSettings>(override?.color ?? active?.color ?? {})
  const [dirty, setDirty] = useState(override !== null)
  const signature = JSON.stringify(color)

  useProductTheme(product.settings.theme)

  useEffect(() => {
    if (active !== undefined) resetRememberedColorValues(active)
    setColor(override?.color ?? active?.color ?? {})
    setDirty(override !== null)
  }, [active?.id, override?.profileId])

  useEffect(() => {
    if (!dirty || active === undefined || active.displays.length === 0) return
    const timer = setTimeout(() => {
      const request =
        override === null
          ? window.chromaShift.startPreview({ ...active, color }, 'override')
          : window.chromaShift.updatePreview(
              active.id,
              color,
              active.displays.map((item) => item.displayId)
            )
      void run(request, setError)
    }, 100)
    return () => clearTimeout(timer)
  }, [signature, dirty, active?.id, override?.profileId])

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
    <MiniPanelTitleBar
      onClose={() => {
        void run(window.chromaShift.hideMiniPanel(), setError)
      }}
    />
  )

  if (active === undefined) {
    return (
      <div className="mini-panel">
        {titleBar}
        <Empty title="No profiles available" />
      </div>
    )
  }

  return (
    <div className="mini-panel">
      {titleBar}
      {error !== null && <div className="mini-error">{error.message}</div>}
      {picker ? (
        <div className="mini-picker">
          <header>
            <IconButton variant="ghost" onClick={() => setPicker(false)} aria-label="Back">
              <ArrowLeft />
            </IconButton>
            <strong>Profile controls</strong>
          </header>
          <button
            className={
              product.activation.mode.kind === 'automatic' ? 'picker-row selected' : 'picker-row'
            }
            onClick={() => void choose(null)}
          >
            <Checkbox checked={product.activation.mode.kind === 'automatic'} />
            <span>Auto switch</span>
            <Badge colorPalette="brand" variant="subtle">
              Recommended
            </Badge>
          </button>
          <Separator />
          {product.configuration.profiles
            .filter((profile) => profile.enabled)
            .map((profile) => (
              <button
                className={
                  product.activation.mode.kind === 'manual' && active.id === profile.id
                    ? 'picker-row selected'
                    : 'picker-row'
                }
                onClick={() => void choose(profile.id)}
                key={profile.id}
              >
                <Checkbox
                  checked={product.activation.mode.kind === 'manual' && active.id === profile.id}
                />
                <span>{profile.name}</span>
                {profile.id === DEFAULT_ID && (
                  <Badge colorPalette="brand" variant="subtle">
                    Global
                  </Badge>
                )}
              </button>
            ))}
        </div>
      ) : (
        <>
          <div className="mini-controls">
            <ColorControls
              profile={active}
              color={color}
              product={product}
              editable
              onChange={(next) => {
                setColor(next)
                setDirty(JSON.stringify(next) !== JSON.stringify(active.color))
              }}
              compact
            />
          </div>
          {dirty && (
            <div className="mini-save">
              <Button
                colorPalette="brand"
                variant="subtle"
                onClick={() => {
                  resetRememberedColorValues(active)
                  setColor(active.color)
                  setDirty(false)
                  void run(window.chromaShift.cancelPreview(), setError)
                }}
              >
                Reset changes
              </Button>
              <Button
                colorPalette="brand"
                onClick={() =>
                  void run(
                    window.chromaShift.confirmPreview(
                      {
                        ...active,
                        color,
                        lastColorValues:
                          rememberedColorValues.get(active.id) ?? active.lastColorValues
                      },
                      'preserve'
                    ),
                    setError
                  )
                }
              >
                Update profile
              </Button>
            </div>
          )}
          <footer>
            <button className="active-profile" onClick={() => setPicker(true)}>
              <SlidersHorizontal />
              <span>
                <small>
                  {product.activation.mode.kind === 'automatic'
                    ? 'Auto switch'
                    : 'Manually selected'}
                </small>
                <strong>{active.name}</strong>
              </span>
            </button>
            <Tooltip label="Open app panel">
              <IconButton
                variant="ghost"
                onClick={() => void window.chromaShift.openAppPanel('profiles')}
                aria-label="Open app panel"
              >
                <ExternalLink />
              </IconButton>
            </Tooltip>
            <Tooltip label="Open settings">
              <IconButton
                variant="ghost"
                onClick={() => void window.chromaShift.openAppPanel('settings')}
                aria-label="Open settings"
              >
                <SettingsIcon />
              </IconButton>
            </Tooltip>
            <Tooltip label="Open displays">
              <IconButton
                variant="ghost"
                onClick={() => void window.chromaShift.openAppPanel('displays')}
                aria-label="Open displays"
              >
                <Monitor />
              </IconButton>
            </Tooltip>
          </footer>
        </>
      )}
    </div>
  )
}

function MiniPanelTitleBar({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <header className="mini-titlebar">
      <strong>ChromaShift</strong>
      <IconButton variant="ghost" onClick={onClose} aria-label="Close mini panel">
        <X />
      </IconButton>
    </header>
  )
}
