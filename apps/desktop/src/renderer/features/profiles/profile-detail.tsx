import { Badge, Button, IconButton, Input, Separator } from '@chakra-ui/react'
import { Check, Copy, Edit3, Monitor, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { ColorProfile, ColorSettings } from '@chromashift/core'
import { SectionTitle } from '@/components/layout/presentational'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import type { ProductError, ProductState } from '../../../shared/product-api.js'
import { ApplicationAssignments } from './application-assignments'
import { ColorControls, ColorSummary, DisplaySummary } from './color-controls'

const DEFAULT_ID = 'default'

export interface ProfileDetailProps {
  profile: ColorProfile
  color: ColorSettings
  product: ProductState
  editing: boolean
  busy: boolean
  dirty: boolean
  previewing: boolean
  onEdit(): void
  onChange(profile: ColorProfile): void
  onCancel(): void
  onSave(): void
  onPreview(): void
  onCopy(): void
  onDelete(): void
  onEnabled(value: boolean): void
  onError(error: ProductError | null): void
}

export function ProfileDetail(props: ProfileDetailProps): React.JSX.Element {
  const profile = props.profile
  return (
    <section className="profile-detail">
      <header className="detail-header">
        <div>
          <div className="title-row">
            {props.editing ? (
              <Input
                className="profile-name-input"
                value={profile.name}
                maxLength={100}
                aria-label="Profile name"
                onChange={(event) => props.onChange({ ...profile, name: event.target.value })}
              />
            ) : (
              <h1>{profile.name}</h1>
            )}
            {profile.id === DEFAULT_ID && (
              <Badge colorPalette="brand" variant="subtle">
                Global profile
              </Badge>
            )}
          </div>
          <p>
            {profile.id === DEFAULT_ID
              ? 'The catch-all profile for applications without assignments.'
              : 'Activates when an assigned application is in the foreground.'}
          </p>
        </div>
        <div className="header-actions">
          <Switch
            checked={profile.enabled}
            disabled={profile.id === DEFAULT_ID || props.editing}
            onCheckedChange={props.onEnabled}
            aria-label="Profile enabled"
          />
          {props.editing ? (
            <>
              <Button colorPalette="brand" variant="outline" onClick={props.onCancel}>
                Cancel
              </Button>
              <Button
                colorPalette="brand"
                disabled={!props.dirty || props.busy || profile.name.trim().length === 0}
                onClick={props.onSave}
              >
                <Check />
                Save
              </Button>
            </>
          ) : (
            <>
              <Button
                colorPalette="brand"
                variant={props.previewing ? 'subtle' : 'outline'}
                onClick={props.onPreview}
              >
                {props.previewing ? <RotateCcw /> : <SlidersHorizontal />}
                {props.previewing ? 'Stop preview' : 'Preview'}
              </Button>
              <Button colorPalette="brand" onClick={props.onEdit}>
                <Edit3 />
                Edit
              </Button>
              <IconButton variant="ghost" onClick={props.onCopy} aria-label="Copy profile">
                <Copy />
              </IconButton>
              {profile.id !== DEFAULT_ID && (
                <IconButton variant="ghost" onClick={props.onDelete} aria-label="Delete profile">
                  <Trash2 />
                </IconButton>
              )}
            </>
          )}
        </div>
      </header>
      <Separator />
      <section className="detail-section">
        <SectionTitle
          title="Displays"
          description="All selected displays receive the same supported settings."
        />
        {props.editing ? (
          <div className="display-options">
            {props.product.displays.map((display) => {
              const checked = profile.displays.some((item) => item.displayId === display.id)
              return (
                <Checkbox
                  className={checked ? 'display-option checked' : 'display-option'}
                  checked={checked}
                  key={display.id}
                  onCheckedChange={(value) =>
                    props.onChange({
                      ...profile,
                      displays: value
                        ? [...profile.displays, { displayId: display.id }]
                        : profile.displays.filter((item) => item.displayId !== display.id)
                    })
                  }
                >
                  <Monitor />
                  <span>
                    <strong>{display.name}</strong>
                    <small>
                      {display.adapter.name} · {display.primary ? 'Primary' : display.connection}
                    </small>
                  </span>
                </Checkbox>
              )
            })}
          </div>
        ) : (
          <DisplaySummary profile={profile} product={props.product} />
        )}
      </section>
      <Separator />
      <section className="detail-section">
        <SectionTitle
          title={props.editing ? 'Color controls' : 'Color settings'}
          description={
            props.editing
              ? 'Changes are previewed live on every selected display.'
              : 'Saved overrides for this profile.'
          }
        />
        {props.editing ? (
          <ColorControls
            profile={profile}
            color={props.color}
            product={props.product}
            editable
            onChange={(color, lastColorValues) =>
              props.onChange({ ...profile, color, lastColorValues })
            }
          />
        ) : (
          <ColorSummary color={profile.color} />
        )}
      </section>
      {profile.id !== DEFAULT_ID && (
        <>
          <Separator />
          <section className="detail-section">
            <ApplicationAssignments
              profile={profile}
              editing={props.editing}
              onChange={props.onChange}
              onError={props.onError}
            />
          </section>
        </>
      )}
    </section>
  )
}
