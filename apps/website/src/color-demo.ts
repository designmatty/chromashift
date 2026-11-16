import {
  allowedRange,
  clampPosition,
  colorControls,
  createDemoProfiles,
  demoApps,
  formatValue,
  rampTable,
  resolveProfile,
  sameColor,
  sceneFor,
  screenshotFilter,
  setControl,
  type ActivationMode,
  type ColorKey,
  type ColorSettings,
  type DemoProfile,
  type DemoScene,
  type Point
} from '@/demo-model'
import { createTour, type TourStep } from '@/demo-tour'
import { initTooltips } from '@/tooltip'

const rampFilter = 'url(#demo-ramp)'
const svgNamespace = 'http://www.w3.org/2000/svg'
const tourSeenKey = 'chromashift.demo-tour-seen'

interface DemoState {
  scene: DemoScene
  mode: ActivationMode
  profiles: DemoProfile[]
  appliedProfileId: string
  draft: ColorSettings
  paused: boolean
  restored: boolean
  comparing: boolean
  /** Hold to compare in the mini panel: show the saved profile instead of the draft. */
  comparingSaved: boolean
  picker: boolean
}

interface ControlElements {
  row: HTMLElement
  input: HTMLInputElement
  value: HTMLElement
  reset: HTMLButtonElement
  limit: HTMLElement
}

/** Profile icons, as the app shows each executable's own icon. */
const profileIcons: Record<string, string> = {
  'escapefromtarkov.exe': '/media/app-icons/tarkov.png',
  'rustclient.exe': '/media/app-icons/rust.png',
  'blender.exe': '/media/app-icons/blender.png'
}

export function initColorDemo(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#color-demo')
  const openers = document.querySelectorAll<HTMLButtonElement>('[data-demo-open]')
  if (dialog === null || openers.length === 0 || typeof dialog.showModal !== 'function') return

  const part = <T extends Element = HTMLElement>(selector: string): T => {
    const element = dialog.querySelector<T>(selector)
    if (element === null) throw new Error(`Missing demo element ${selector}`)
    return element
  }
  initTooltips(dialog)
  const stage = part('[data-demo-stage]')
  const screen = part<HTMLImageElement>('[data-demo-screen]')
  const loading = part('[data-demo-loading]')
  const original = part('[data-demo-original]')
  const originalLabel = part('[data-demo-original-label]')
  const credit = part('[data-demo-credit]')
  const compare = part<HTMLButtonElement>('[data-demo-compare]')
  const appGroup = part('[data-demo-apps]')
  const variantButtons = dialog.querySelectorAll<HTMLButtonElement>('[data-demo-variant]')
  const dock = part('[data-mini-dock]')
  const mini = part('[data-mini]')
  const dragHandle = part('[data-mini-drag]')
  const power = part<HTMLButtonElement>('[data-mini-power]')
  const controlsView = part('[data-mini-controls-view]')
  const pickerView = part('[data-mini-picker-view]')
  const override = part('[data-mini-override]')
  const modeLabel = part('[data-mini-mode]')
  const profileLabel = part('[data-mini-profile]')
  const pickerOpen = part<HTMLButtonElement>('[data-mini-picker-open]')
  const restore = part<HTMLButtonElement>('[data-mini-restore]')
  const rampFunctions = document.querySelectorAll(
    '#demo-ramp feFuncR, #demo-ramp feFuncG, #demo-ramp feFuncB'
  )

  const profiles = createDemoProfiles()
  const firstScene = sceneFor('tarkov', 'night')
  const firstProfile = resolveProfile(profiles, { kind: 'automatic' }, firstScene)
  const state: DemoState = {
    scene: firstScene,
    mode: { kind: 'automatic' },
    profiles,
    appliedProfileId: firstProfile.id,
    draft: { ...firstProfile.color },
    paused: false,
    restored: false,
    comparing: false,
    comparingSaved: false,
    picker: false
  }

  const controls = buildControls(part('[data-mini-controls]'))
  const liveBadges = new Map<string, HTMLElement>()
  const options = buildPicker(part('[data-mini-picker]'))
  const appButtons = buildAppButtons(appGroup)
  const tourStart = part<HTMLButtonElement>('[data-tour-start]')
  const tourSteps: TourStep[] = [
    {
      target: () => mini,
      side: 'left',
      radius: 16,
      title: 'This is the mini panel',
      body: 'A working copy of ChromaShift’s mini panel. Drag its title bar to move it anywhere.'
    },
    {
      target: () => visible(part('[data-mini-controls]')) ?? mini,
      side: 'left',
      radius: 16,
      title: 'Adjust the colors',
      body: 'Brightness, contrast, gamma, saturation, and hue. The screenshot changes the way your display would.'
    },
    {
      target: () => appGroup,
      side: 'top',
      radius: 999,
      title: 'Switch apps',
      body: 'Pick another foreground app. ChromaShift applies that app’s profile automatically, or Default when it has none.'
    },
    {
      target: () => part('.demo__times'),
      side: 'top',
      radius: 999,
      title: 'Day or night',
      body: 'Tarkov and Rust each have a night profile in this demo.'
    },
    {
      target: () => compare,
      side: 'top',
      radius: 999,
      title: 'Compare with the original',
      body: 'Hold this button to see the screenshot without ChromaShift.'
    }
  ]
  const tour = createTour(part('[data-tour]'), tourSteps, () => {
    remember(tourSeenKey)
    tourStart.focus()
  })
  let lastRamp = ''
  let position: Point | null = null
  let panelHeight = 0
  let sceneRequest = 0

  function activeProfile(): DemoProfile {
    return resolveProfile(state.profiles, state.mode, state.scene)
  }

  /** A new effective profile replaces any unsaved override, as in the app. */
  function syncProfile(): void {
    const profile = activeProfile()
    if (profile.id === state.appliedProfileId) return
    state.appliedProfileId = profile.id
    state.draft = { ...profile.color }
    state.restored = false
    flashProfile()
  }

  function render(): void {
    const profile = activeProfile()
    const dirty = !sameColor(state.draft, profile.color)
    if (!dirty) state.comparingSaved = false
    const shown = state.comparingSaved ? profile.color : state.draft
    const showOriginal = state.paused || state.restored || state.comparing

    const ramp = rampTable(shown).join(' ')
    if (ramp !== lastRamp) {
      for (const fn of rampFunctions) fn.setAttribute('tableValues', ramp)
      lastRamp = ramp
    }
    screen.style.filter = showOriginal ? 'none' : screenshotFilter(shown, rampFilter)
    original.hidden = !showOriginal
    originalLabel.textContent = state.paused
      ? 'ChromaShift paused'
      : state.restored
        ? 'Original display settings'
        : 'Original colors'
    compare.classList.toggle('is-active', state.comparing)

    const powerLabel = state.paused ? 'Resume ChromaShift' : 'Pause ChromaShift'
    power.dataset.status = state.paused ? 'paused' : dirty ? 'on-hold' : 'active'
    power.setAttribute('aria-label', powerLabel)
    power.dataset.tooltip =
      dirty && !state.paused ? 'Auto-switching on hold — unsaved changes' : powerLabel
    restore.disabled = state.paused

    controlsView.hidden = state.picker
    pickerView.hidden = !state.picker
    override.hidden = !dirty
    modeLabel.textContent = state.mode.kind === 'automatic' ? 'Automatic' : 'Manually selected'
    profileLabel.textContent = profile.name
    pickerOpen.setAttribute('aria-label', `Active profile: ${profile.name}. Choose profile`)

    for (const control of colorControls) {
      const elements = controls.get(control.key)!
      const value = shown[control.key]
      const range = allowedRange(control.key, shown)
      const span = control.max - control.min
      const limited = range.min > control.min || range.max < control.max
      elements.limit.hidden = !limited
      elements.limit.dataset.tooltip = `Min ${range.min.toFixed(2)}, max ${range.max.toFixed(2)} at brightness ${Math.round(shown.brightness)}%`
      elements.limit.setAttribute('aria-label', elements.limit.dataset.tooltip)
      elements.input.value = String(value)
      elements.input.disabled = state.paused || state.comparingSaved
      elements.input.setAttribute('aria-valuemin', String(range.min))
      elements.input.setAttribute('aria-valuemax', String(range.max))
      elements.input.setAttribute('aria-valuetext', formatValue(control.key, value))
      elements.input.style.setProperty('--p', String((value - control.min) / span))
      elements.input.style.setProperty('--lo', `${((range.min - control.min) / span) * 100}%`)
      elements.input.style.setProperty('--hi', `${((control.max - range.max) / span) * 100}%`)
      elements.value.textContent = formatValue(control.key, value)
      elements.reset.hidden = state.paused || state.comparingSaved || value === control.neutral
    }

    const selected = state.mode.kind === 'automatic' ? 'automatic' : state.mode.profileId
    for (const option of options) option.checked = option.value === selected
    for (const [id, badge] of liveBadges) badge.hidden = id !== profile.id

    for (const button of appButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.demoApp === state.scene.app.id))
    }
    for (const button of variantButtons) {
      button.disabled = state.scene.variant === null
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.demoVariant === state.scene.variant)
      )
    }
    credit.replaceChildren(
      ...state.scene.credit.map((piece) => {
        if (piece.href === undefined) return document.createTextNode(piece.text)
        const link = document.createElement('a')
        link.href = piece.href
        link.target = '_blank'
        link.rel = 'noreferrer noopener'
        link.textContent = piece.text
        return link
      })
    )
  }

  function changeControl(key: ColorKey, value: number): void {
    if (state.paused) return
    state.draft = setControl(state.draft, key, value)
    state.restored = false
    render()
  }

  function choose(mode: ActivationMode): void {
    state.mode = mode
    // An explicit selection resumes a user pause and drops unsaved changes.
    state.paused = false
    state.picker = false
    state.appliedProfileId = ''
    syncProfile()
    render()
    pickerOpen.focus()
  }

  async function showScene(scene: DemoScene): Promise<void> {
    state.scene = scene
    syncProfile()
    render()
    if (screen.getAttribute('src') === scene.src) return

    const request = ++sceneRequest
    const next = new Image()
    next.src = scene.src
    screen.classList.add('is-loading')
    const slow = window.setTimeout(() => {
      loading.textContent = 'Loading screenshot…'
      loading.hidden = false
    }, 250)
    try {
      await next.decode()
    } catch {
      if (request !== sceneRequest) return
      window.clearTimeout(slow)
      loading.textContent = 'This screenshot could not be loaded.'
      loading.hidden = false
      return
    }
    window.clearTimeout(slow)
    if (request !== sceneRequest) return
    screen.src = scene.src
    screen.width = scene.width
    screen.height = scene.height
    screen.alt = `${scene.app.name}${scene.variant === null ? '' : ` at ${scene.variant}`}`
    loading.hidden = true
    screen.classList.remove('is-loading')
  }

  function flashProfile(): void {
    const text = profileLabel.parentElement!
    text.classList.remove('is-switching')
    void text.offsetWidth
    text.classList.add('is-switching')
  }

  function placePanel(): void {
    const stageBox = stage.getBoundingClientRect()
    const panelBox = dock.getBoundingClientRect()
    const stageSize = { width: stageBox.width, height: stageBox.height }
    const panelSize = { width: panelBox.width, height: panelBox.height }
    if (position === null) {
      const narrow = stageSize.width < 720
      position = {
        x: narrow
          ? (stageSize.width - panelSize.width) / 2
          : stageSize.width - panelSize.width - 32,
        y: stageSize.height - panelSize.height - (narrow ? 120 : 86)
      }
    } else if (panelHeight > 0) {
      // Grow upward, as the anchored desktop panel does, so the slider under
      // the pointer stays put when the override bar appears.
      position = { x: position.x, y: position.y - (panelSize.height - panelHeight) }
    }
    panelHeight = panelSize.height
    position = clampPosition(position, stageSize, panelSize)
    dock.style.translate = `${Math.round(position.x)}px ${Math.round(position.y)}px`
    tour.update()
  }

  function buildControls(container: HTMLElement): Map<ColorKey, ControlElements> {
    const elements = new Map<ColorKey, ControlElements>()
    for (const control of colorControls) {
      const row = document.createElement('div')
      row.className = 'mini-control'
      row.dataset.control = control.key

      const head = document.createElement('div')
      head.className = 'mini-control__head'
      const label = document.createElement('label')
      label.textContent = control.label
      label.htmlFor = `demo-${control.key}`
      const reset = document.createElement('button')
      reset.type = 'button'
      reset.className = 'mini-control__reset'
      reset.textContent = '↺'
      reset.dataset.tooltip = 'Reset to neutral'
      reset.setAttribute('aria-label', `Reset ${control.label.toLowerCase()} to neutral`)
      reset.addEventListener('click', () => changeControl(control.key, control.neutral))
      const limit = document.createElement('span')
      limit.className = 'mini-control__limit'
      limit.setAttribute('role', 'img')
      limit.hidden = true
      limit.append(icon('shield-alert'))
      const value = document.createElement('span')
      value.className = 'mini-control__value'
      value.setAttribute('aria-hidden', 'true')
      head.append(icon(control.icon), label, limit, reset, value)

      const input = document.createElement('input')
      input.type = 'range'
      input.className = 'mini-slider'
      if (control.key === 'saturation' || control.key === 'hue') input.dataset.track = control.key
      input.style.setProperty(
        '--n',
        String((control.neutral - control.min) / (control.max - control.min))
      )
      input.id = `demo-${control.key}`
      input.min = String(control.min)
      input.max = String(control.max)
      input.step = String(control.step)
      input.addEventListener('input', () => changeControl(control.key, Number(input.value)))

      row.append(head, input)
      container.append(row)
      elements.set(control.key, { row, input, value, reset, limit })
    }
    return elements
  }

  function buildPicker(container: HTMLElement): HTMLInputElement[] {
    const pinned = document.createElement('div')
    pinned.className = 'mini__picker-pinned'
    const list = document.createElement('div')
    list.className = 'mini__picker-list'
    const items = [
      { value: 'automatic', label: 'Automatic', isDefault: false, executable: undefined },
      ...state.profiles.map((profile) => ({
        value: profile.id,
        label: profile.name,
        isDefault: profile.executable === null,
        executable: profile.executable
      }))
    ]
    const inputs = items.map((item) => {
      const option = document.createElement('label')
      option.className = 'mini-option'
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = 'demo-profile'
      input.value = item.value
      input.addEventListener('click', () =>
        choose(
          item.value === 'automatic'
            ? { kind: 'automatic' }
            : { kind: 'manual', profileId: item.value }
        )
      )
      const mark = document.createElement('span')
      mark.className = 'mini-option__mark'
      mark.setAttribute('aria-hidden', 'true')
      option.append(input, mark)
      if (item.executable !== undefined) option.append(profileIcon(item.executable))
      const name = document.createElement('span')
      name.className = 'mini-option__name'
      name.textContent = item.label
      option.append(name)
      if (item.isDefault) {
        const badge = document.createElement('span')
        badge.className = 'cs-badge mini-option__badge'
        badge.textContent = 'Default'
        option.append(badge)
      }
      if (item.value !== 'automatic') {
        const live = document.createElement('span')
        live.className = 'cs-badge mini-option__badge mini-option__badge--live'
        live.textContent = 'Live'
        live.hidden = true
        liveBadges.set(item.value, live)
        option.append(live)
      }
      ;(item.value === 'automatic' ? pinned : list).append(option)
      return input
    })
    container.append(pinned, list)
    return inputs
  }

  function buildAppButtons(container: HTMLElement): HTMLButtonElement[] {
    return demoApps.map((app) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.demoApp = app.id
      button.textContent = app.shortName
      button.setAttribute('aria-label', app.name)
      button.addEventListener('click', () => void showScene(sceneFor(app.id, state.scene.variant)))
      const preload = (): void => {
        new Image().src = sceneFor(app.id, state.scene.variant).src
      }
      button.addEventListener('pointerenter', preload, { once: true })
      button.addEventListener('focus', preload, { once: true })
      container.append(button)
      return button
    })
  }

  for (const button of variantButtons) {
    button.addEventListener('click', () => {
      const variant = button.dataset.demoVariant === 'night' ? 'night' : 'day'
      void showScene(sceneFor(state.scene.app.id, variant))
    })
  }

  for (const close of dialog.querySelectorAll('[data-demo-close]')) {
    close.addEventListener('click', () => dialog.close())
  }

  power.addEventListener('click', () => {
    state.paused = !state.paused
    state.restored = false
    render()
  })
  restore.addEventListener('click', () => {
    state.restored = true
    render()
  })
  part('[data-mini-reset]').addEventListener('click', () => {
    state.draft = { ...activeProfile().color }
    render()
  })
  part('[data-mini-update]').addEventListener('click', () => {
    const profile = activeProfile()
    profile.color = { ...state.draft }
    updateHero(profile)
    render()
  })
  pickerOpen.addEventListener('click', () => {
    state.picker = true
    render()
    options.find((option) => option.checked)?.focus()
  })
  part('[data-mini-picker-close]').addEventListener('click', () => {
    state.picker = false
    render()
    pickerOpen.focus()
  })

  holdButton(compare, (comparing) => {
    if (state.comparing === comparing) return
    state.comparing = comparing
    render()
  })
  holdButton(part<HTMLButtonElement>('[data-mini-compare]'), (comparing) => {
    if (state.comparingSaved === comparing) return
    state.comparingSaved = comparing
    render()
  })

  dragHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('button') !== null) return
    if (position === null) return
    event.preventDefault()
    dragHandle.setPointerCapture(event.pointerId)
    const offset = { x: event.clientX - position.x, y: event.clientY - position.y }
    mini.classList.add('is-dragging')
    const move = (moveEvent: PointerEvent): void => {
      position = { x: moveEvent.clientX - offset.x, y: moveEvent.clientY - offset.y }
      placePanel()
    }
    const end = (): void => {
      dragHandle.removeEventListener('pointermove', move)
      dragHandle.removeEventListener('lostpointercapture', end)
      mini.classList.remove('is-dragging')
    }
    dragHandle.addEventListener('pointermove', move)
    dragHandle.addEventListener('lostpointercapture', end)
  })

  new ResizeObserver(() => {
    if (dialog.open) placePanel()
  }).observe(dock)
  window.addEventListener('resize', () => {
    if (dialog.open) placePanel()
  })

  tourStart.addEventListener('click', () => tour.start())

  // Escape closes the innermost layer first: the tour, then the picker.
  dialog.addEventListener('cancel', (event) => {
    if (tour.active) {
      event.preventDefault()
      tour.stop()
      return
    }
    if (!state.picker) return
    event.preventDefault()
    state.picker = false
    render()
    pickerOpen.focus()
  })
  dialog.addEventListener('close', () => {
    if (tour.active) tour.stop()
    state.comparing = false
    state.comparingSaved = false
    state.picker = false
    render()
  })

  for (const opener of openers) {
    opener.hidden = false
    opener.addEventListener('click', () => {
      render()
      dialog.showModal()
      placePanel()
      void showScene(state.scene)
      if (!remembered(tourSeenKey)) {
        // Wait for the panel's entrance animation so the spotlight lands on it.
        const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600
        window.setTimeout(() => {
          if (dialog.open && !tour.active) tour.start()
        }, delay)
      }
    })
  }
}

function visible(element: Element): Element | null {
  return element.getClientRects().length > 0 ? element : null
}

// Storage can be unavailable (private modes, blocked cookies); the tour then
// simply shows again next time.
function remembered(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null
  } catch {
    return false
  }
}

function remember(key: string): void {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // Ignored; see remembered().
  }
}

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS(svgNamespace, 'svg')
  svg.setAttribute('class', 'i')
  svg.setAttribute('aria-hidden', 'true')
  const use = document.createElementNS(svgNamespace, 'use')
  use.setAttribute('href', `#i-${name}`)
  svg.append(use)
  return svg
}

/** The executable's icon, or the palette for Default, in a 30px circle. */
function profileIcon(executable: string | null): HTMLElement {
  const frame = document.createElement('span')
  frame.className = 'mini-option__icon'
  const src = executable === null ? undefined : profileIcons[executable.toLowerCase()]
  if (src === undefined) {
    frame.append(icon('palette'))
  } else {
    const image = document.createElement('img')
    image.src = src
    image.width = 30
    image.height = 30
    image.alt = ''
    frame.append(image)
  }
  return frame
}

/** Wires a press-and-hold button: pointer, Space, or Enter held down. */
function holdButton(button: HTMLButtonElement, set: (held: boolean) => void): void {
  button.addEventListener('pointerdown', (event) => {
    button.setPointerCapture(event.pointerId)
    set(true)
  })
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
    button.addEventListener(type, () => set(false))
  }
  button.addEventListener('keydown', (event) => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault()
      set(true)
    }
  })
  button.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') set(false)
  })
  button.addEventListener('contextmenu', (event) => event.preventDefault())
}

/** Saving the Tarkov profile in the demo also updates the hero's app replica. */
function updateHero(profile: DemoProfile): void {
  if (profile.id !== 'tarkov') return
  for (const control of colorControls) {
    const row = document.querySelector<HTMLElement>(
      `[data-hero-controls] [data-control="${control.key}"]`
    )
    if (row === null) continue
    const value = profile.color[control.key]
    row.querySelector('[data-value]')!.textContent = formatValue(control.key, value)
    row.querySelector<HTMLElement>('[data-reset]')!.hidden = value === control.neutral
    row
      .querySelector<HTMLElement>('[data-track]')
      ?.style.setProperty('--p', String((value - control.min) / (control.max - control.min)))
  }
}
