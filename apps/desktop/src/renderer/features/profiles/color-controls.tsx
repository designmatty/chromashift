import { Monitor } from 'lucide-react'
import type { ColorProfile, ColorSettings } from '@chromashift/core'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import type { ProductState } from '../../../shared/product-api.js'

type ColorKey = keyof ColorSettings

const controls: Array<{
  key: ColorKey
  label: string
  min: number
  max: number
  step: number
  initial: number
}> = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 100, step: 1, initial: 50 },
  { key: 'contrast', label: 'Contrast', min: 0, max: 100, step: 1, initial: 50 },
  { key: 'gamma', label: 'Gamma', min: 0.5, max: 2.8, step: 0.05, initial: 1 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 100, step: 1, initial: 50 },
  { key: 'hue', label: 'Hue', min: 0, max: 100, step: 1, initial: 50 },
  {
    key: 'colorTemperature',
    label: 'Color temperature',
    min: 0,
    max: 100,
    step: 1,
    initial: 50
  }
]

export const rememberedColorValues = new Map<string, ColorSettings>()

export function resetRememberedColorValues(profile: ColorProfile | null): void {
  if (profile === null) return
  rememberedColorValues.set(profile.id, { ...profile.lastColorValues, ...profile.color })
}

export function ColorControls({
  profile,
  color,
  product,
  editable,
  onChange,
  compact = false
}: {
  profile: ColorProfile
  color: ColorSettings
  product: ProductState
  editable: boolean
  onChange(color: ColorSettings, lastColorValues: ColorSettings): void
  compact?: boolean
}): React.JSX.Element {
  const remembered = { ...profile.lastColorValues, ...rememberedColorValues.get(profile.id) }
  for (const control of controls) {
    const value = color[control.key]
    if (value !== undefined) remembered[control.key] = value
  }
  rememberedColorValues.set(profile.id, remembered)

  return (
    <div className={compact ? 'controls compact' : 'controls'}>
      {controls.map((control) => {
        const support = controlSupport(control.key, profile, product)
        const value = color[control.key]
        const enabled = value !== undefined
        return (
          <div className="control" key={control.key}>
            <div className="control-label">
              <Checkbox
                checked={enabled}
                disabled={!editable || !support.available}
                onCheckedChange={(checked) => {
                  const next = { ...color }
                  if (checked) {
                    next[control.key] = remembered[control.key] ?? control.initial
                  } else {
                    if (value !== undefined) remembered[control.key] = value
                    delete next[control.key]
                  }
                  rememberedColorValues.set(profile.id, remembered)
                  onChange(next, { ...remembered })
                }}
              >
                <strong>{control.label}</strong>
              </Checkbox>
              <span>
                {formatValue(
                  control.key,
                  enabled ? value : (remembered[control.key] ?? control.initial)
                )}
              </span>
            </div>
            <Slider
              value={[value ?? remembered[control.key] ?? control.initial]}
              min={control.min}
              max={control.max}
              step={control.step}
              disabled={!editable || !enabled || !support.available}
              onValueChange={(values) => {
                const next = values[0]
                if (next === undefined) return
                remembered[control.key] = next
                rememberedColorValues.set(profile.id, remembered)
                onChange({ ...color, [control.key]: next }, { ...remembered })
              }}
            />
            <small>{support.available ? support.providers : support.reason}</small>
          </div>
        )
      })}
    </div>
  )
}

export function ColorSummary({ color }: { color: ColorSettings }): React.JSX.Element {
  return (
    <dl className="color-summary">
      {controls.map((control) => {
        const value = color[control.key]
        return (
          <div className={value === undefined ? 'unset' : ''} key={control.key}>
            <dt>{control.label}</dt>
            <dd>{value === undefined ? 'Not overridden' : formatValue(control.key, value)}</dd>
          </div>
        )
      })}
    </dl>
  )
}

export function DisplaySummary({
  profile,
  product
}: {
  profile: ColorProfile
  product: ProductState
}): React.JSX.Element {
  const assigned = profile.displays
    .map((target) => product.displays.find((display) => display.id === target.displayId))
    .filter((display) => display !== undefined)
  if (assigned.length === 0) return <p className="read-only-empty">No displays assigned.</p>

  return (
    <div className="display-summary">
      {assigned.map((display) => (
        <div key={display.id}>
          <Monitor />
          <span>
            <strong>{display.name}</strong>
            <small>
              {display.adapter.name} · {display.primary ? 'Primary' : display.connection}
            </small>
          </span>
        </div>
      ))}
    </div>
  )
}

function controlSupport(
  key: ColorKey,
  profile: ColorProfile,
  product: ProductState
): { available: boolean; reason: string; providers: string } {
  if (profile.displays.length === 0) {
    return { available: false, reason: 'Select a display first.', providers: '' }
  }

  const failures: string[] = []
  const providers = new Set<string>()
  for (const target of profile.displays) {
    const display = product.displays.find((item) => item.id === target.displayId)
    const capability = product.capabilityReports[target.displayId]?.capabilities[key]
    if (display === undefined || capability === undefined || !capability.supported) {
      failures.push(`${display?.name ?? target.displayId}: ${capability?.reason ?? 'Unavailable'}`)
    } else if (
      display.hdr &&
      capability.provider === 'windows' &&
      ['brightness', 'contrast', 'gamma'].includes(key)
    ) {
      failures.push(`${display.name}: unavailable while HDR is active`)
    } else {
      providers.add(capability.provider)
    }
  }

  return failures.length > 0
    ? { available: false, reason: failures.join(' · '), providers: '' }
    : { available: true, reason: '', providers: [...providers].join(' + ') }
}

function formatValue(key: ColorKey, value: number): string {
  return key === 'gamma'
    ? value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    : `${Math.round(value)}%`
}
