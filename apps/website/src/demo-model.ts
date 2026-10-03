// Pure state for the hero "Try it out" demo. The control ranges, gamma envelope,
// and ramp math mirror the desktop app so the browser preview behaves like the
// mini panel, but nothing here talks to a display.

export type ColorKey = 'brightness' | 'contrast' | 'gamma' | 'saturation' | 'hue'
export type ColorSettings = Record<ColorKey, number>

export interface ColorControl {
  key: ColorKey
  label: string
  icon: string
  min: number
  max: number
  step: number
  neutral: number
}

export const colorControls: readonly ColorControl[] = [
  {
    key: 'brightness',
    label: 'Brightness',
    icon: 'brightness',
    min: 0,
    max: 100,
    step: 1,
    neutral: 50
  },
  { key: 'contrast', label: 'Contrast', icon: 'contrast', min: 0, max: 100, step: 1, neutral: 50 },
  { key: 'gamma', label: 'Gamma', icon: 'gauge', min: 0.3, max: 2.8, step: 0.05, neutral: 1 },
  {
    key: 'saturation',
    label: 'Saturation',
    icon: 'saturation',
    min: 0,
    max: 100,
    step: 1,
    neutral: 50
  },
  { key: 'hue', label: 'Hue', icon: 'palette', min: 0, max: 100, step: 1, neutral: 0 }
]

export const neutralColor: Readonly<ColorSettings> = {
  brightness: 50,
  contrast: 50,
  gamma: 1,
  saturation: 50,
  hue: 0
}

/** Mirrors `gammaRangeForBrightness` in `packages/core/src/profiles/model.ts`. */
export function gammaRange(brightness: number): { min: number; max: number } {
  if (brightness < 7) return { min: 0.5, max: 2.8 }
  if (brightness < 30) return { min: 0.4, max: 2.8 }
  if (brightness < 87) return { min: 0.3, max: 2.8 }
  if (brightness < 90) return { min: 0.3, max: 2.7 }
  if (brightness < 92) return { min: 0.3, max: 2.6 }
  if (brightness < 97) return { min: 0.3, max: 2.5 }
  if (brightness < 100) return { min: 0.3, max: 2.4 }
  return { min: 0.3, max: 2.3 }
}

export function allowedRange(key: ColorKey, color: ColorSettings): { min: number; max: number } {
  if (key === 'gamma') return gammaRange(color.brightness)
  const control = controlFor(key)
  return { min: control.min, max: control.max }
}

/** Applies one slider change the way the app's color controls do. */
export function setControl(color: ColorSettings, key: ColorKey, value: number): ColorSettings {
  const control = controlFor(key)
  const next = { ...color }
  const range = allowedRange(key, color)
  next[key] = Number.isFinite(value) ? clamp(value, range.min, range.max) : control.neutral
  if (key === 'brightness') {
    const gamma = gammaRange(next.brightness)
    next.gamma = clamp(next.gamma, gamma.min, gamma.max)
  }
  return next
}

export function sameColor(left: ColorSettings, right: ColorSettings): boolean {
  return colorControls.every(({ key }) => left[key] === right[key])
}

/** Matches the mini panel's compact value label. */
export function formatValue(key: ColorKey, value: number): string {
  return key === 'gamma'
    ? value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    : `${Math.round(value)}%`
}

/**
 * Ports `GammaRampTransform.TransformChannel` from the display helper. Input is
 * one normalized channel value of the captured baseline, here the screenshot.
 */
export function rampValue(input: number, color: ColorSettings): number {
  const brightness = (color.brightness - 50) / 50
  const contrast = (color.contrast - 50) / 50
  let value = Math.pow(input, 1 / color.gamma)

  const power = contrast >= 0 ? 1 + contrast * 2 : 1 / (1 - contrast * 0.75)
  value =
    value <= 0.5 ? 0.5 * Math.pow(value * 2, power) : 1 - 0.5 * Math.pow((1 - value) * 2, power)

  value =
    brightness >= 0
      ? value + brightness * (Math.sqrt(value) - value)
      : value + -brightness * (value * value - value)
  return clamp(value, 0, 1)
}

/** Lookup table for an SVG `feComponentTransfer type="table"`. */
export function rampTable(color: ColorSettings, size = 64): number[] {
  return Array.from({ length: size }, (_, index) =>
    Number(rampValue(index / (size - 1), color).toFixed(4))
  )
}

/**
 * The CSS filter that approximates a profile on the screenshot. Saturation maps
 * to a vibrance-like multiplier and hue to the provider's 0–359° rotation; the
 * gamma ramp runs last, as the display's lookup table does.
 */
export function screenshotFilter(color: ColorSettings, rampFilter: string): string {
  const filters: string[] = []
  if (color.saturation !== neutralColor.saturation) {
    filters.push(`saturate(${round(color.saturation / 50)})`)
  }
  if (color.hue !== neutralColor.hue) filters.push(`hue-rotate(${round(color.hue * 3.59)}deg)`)
  if (
    color.brightness !== neutralColor.brightness ||
    color.contrast !== neutralColor.contrast ||
    color.gamma !== neutralColor.gamma
  ) {
    filters.push(rampFilter)
  }
  return filters.length === 0 ? 'none' : filters.join(' ')
}

export type SceneVariant = 'day' | 'night' | null

export interface DemoProfile {
  id: string
  name: string
  executable: string | null
  /** A demo-only refinement: a night profile applies to the app's night scene. */
  variant: SceneVariant
  color: ColorSettings
}

export const defaultProfileId = 'default'

export function createDemoProfiles(): DemoProfile[] {
  return [
    {
      id: defaultProfileId,
      name: 'Default profile',
      executable: null,
      variant: null,
      color: { ...neutralColor }
    },
    {
      id: 'tarkov',
      name: 'Escape from Tarkov',
      executable: 'EscapeFromTarkov.exe',
      variant: null,
      color: { brightness: 50, contrast: 63, gamma: 0.9, saturation: 84, hue: 0 }
    },
    {
      id: 'tarkov-night',
      name: 'Tarkov night',
      executable: 'EscapeFromTarkov.exe',
      variant: 'night',
      color: { brightness: 37, contrast: 69, gamma: 2.6, saturation: 52, hue: 0 }
    },
    {
      id: 'rust',
      name: 'Rust',
      executable: 'RustClient.exe',
      variant: null,
      color: { brightness: 47, contrast: 54, gamma: 0.85, saturation: 76, hue: 0 }
    },
    {
      id: 'rust-night',
      name: 'Rust night',
      executable: 'RustClient.exe',
      variant: 'night',
      color: { brightness: 62, contrast: 50, gamma: 1.7, saturation: 54, hue: 0 }
    },
    {
      id: 'blender',
      name: 'Blender',
      executable: 'Blender.exe',
      variant: null,
      color: { brightness: 55, contrast: 55, gamma: 1, saturation: 66, hue: 0 }
    }
  ]
}

export type ActivationMode = { kind: 'automatic' } | { kind: 'manual'; profileId: string }

/**
 * Manual selection wins; otherwise the foreground app's profile for the scene's
 * time of day, then the app's general profile, then Default.
 */
export function resolveProfile(
  profiles: readonly DemoProfile[],
  mode: ActivationMode,
  scene: Pick<DemoScene, 'app' | 'variant'>
): DemoProfile {
  const fallback = profiles.find((profile) => profile.id === defaultProfileId) ?? profiles[0]!
  if (mode.kind === 'manual') {
    return profiles.find((profile) => profile.id === mode.profileId) ?? fallback
  }
  // Windows executable names are case-insensitive, as in the app's matcher.
  const executable = scene.app.executable.toLowerCase()
  const forApp = profiles.filter((profile) => profile.executable?.toLowerCase() === executable)
  return (
    forApp.find((profile) => profile.variant !== null && profile.variant === scene.variant) ??
    forApp.find((profile) => profile.variant === null) ??
    fallback
  )
}

export interface CreditPart {
  text: string
  href?: string
}

export interface DemoApp {
  id: string
  name: string
  /** Label for the scene dock. */
  shortName: string
  executable: string
}

export interface DemoScene {
  id: string
  app: DemoApp
  variant: SceneVariant
  src: string
  width: number
  height: number
  credit: CreditPart[]
}

const tarkov: DemoApp = {
  id: 'tarkov',
  name: 'Escape from Tarkov',
  shortName: 'Tarkov',
  executable: 'EscapeFromTarkov.exe'
}
const rust: DemoApp = { id: 'rust', name: 'Rust', shortName: 'Rust', executable: 'RustClient.exe' }
const blender: DemoApp = {
  id: 'blender',
  name: 'Blender',
  shortName: 'Blender',
  executable: 'blender.exe'
}
const figma: DemoApp = {
  id: 'figma',
  name: 'Figma',
  shortName: 'Figma',
  executable: 'Figma.exe'
}

export const demoApps: readonly DemoApp[] = [tarkov, rust, blender, figma]

export const demoScenes: readonly DemoScene[] = [
  {
    id: 'tarkov-day',
    app: tarkov,
    variant: 'day',
    src: '/media/demo/tarkov-day.jpg',
    width: 2560,
    height: 1440,
    credit: [
      { text: 'Escape from Tarkov © Battlestate Games · Video by ' },
      { text: 'Sleek', href: 'https://www.youtube.com/watch?v=3eLOgux0eq0' }
    ]
  },
  {
    id: 'tarkov-night',
    app: tarkov,
    variant: 'night',
    src: '/media/demo/tarkov-night.jpg',
    width: 2560,
    height: 1440,
    credit: [
      { text: 'Escape from Tarkov © Battlestate Games · ' },
      {
        text: 'r/EscapefromTarkov',
        href: 'https://www.reddit.com/r/EscapefromTarkov/comments/1qnoe1p/nvg_worse_than_ever_or_wrong_settings_help_please/'
      }
    ]
  },
  {
    id: 'rust-day',
    app: rust,
    variant: 'day',
    src: '/media/demo/rust-day.jpg',
    width: 1500,
    height: 844,
    credit: [
      { text: 'Rust © Facepunch Studios · ' },
      { text: 'Press media', href: 'https://facepunch.com/games/rust' }
    ]
  },
  {
    id: 'rust-night',
    app: rust,
    variant: 'night',
    src: '/media/demo/rust-night.jpg',
    width: 1920,
    height: 1080,
    credit: [
      { text: 'Rust © Facepunch Studios · ' },
      { text: 'Lighting the Way', href: 'https://rust.facepunch.com/news/lighting-the-way' }
    ]
  },
  {
    id: 'blender',
    app: blender,
    variant: null,
    src: '/media/demo/blender.jpg',
    width: 2560,
    height: 1440,
    credit: [
      { text: 'Blender © Blender Foundation · ' },
      { text: 'Blender 5.1 overview', href: 'https://www.youtube.com/watch?v=8r3xoRwwN6I' }
    ]
  },
  {
    id: 'figma',
    app: figma,
    variant: null,
    src: '/media/demo/figma.jpg',
    width: 2560,
    height: 1440,
    credit: [{ text: 'Figma · ChromaShift designs' }]
  }
]

/** Picks the scene for an app, keeping the current time of day when it exists. */
export function sceneFor(appId: string, variant: SceneVariant): DemoScene {
  const scenes = demoScenes.filter((scene) => scene.app.id === appId)
  return scenes.find((scene) => scene.variant === variant) ?? scenes[0] ?? demoScenes[0]!
}

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** Keeps the dragged panel inside the stage, pinned to the top-left if it can't fit. */
export function clampPosition(position: Point, stage: Size, panel: Size, margin = 8): Point {
  return {
    x: Math.max(margin, Math.min(position.x, stage.width - panel.width - margin)),
    y: Math.max(margin, Math.min(position.y, stage.height - panel.height - margin))
  }
}

function controlFor(key: ColorKey): ColorControl {
  return colorControls.find((control) => control.key === key)!
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
