// A small guided tour for the demo, in the spirit of react-joyride: a spotlight
// around one element and a bubble that explains it. It never blocks the demo,
// and Escape, the close button, or "Skip tour" dismiss it.

export type Side = 'top' | 'bottom' | 'left' | 'right'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Placement {
  side: Side | null
  x: number
  y: number
  /** Arrow offset along the bubble edge that faces the target. */
  arrow: number
}

const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/**
 * Places the bubble beside the target, trying the preferred side, then its
 * opposite, then the others. If no side fits, it centers near the bottom.
 */
export function placeBubble(
  target: Rect,
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: Side,
  gap = 14,
  margin = 12
): Placement {
  const order: Side[] = [preferred, opposite[preferred], 'top', 'bottom', 'left', 'right']
  const centerX = target.x + target.width / 2
  const centerY = target.y + target.height / 2
  const clampX = (x: number): number =>
    Math.max(margin, Math.min(x, viewport.width - bubble.width - margin))
  const clampY = (y: number): number =>
    Math.max(margin, Math.min(y, viewport.height - bubble.height - margin))

  for (const side of new Set(order)) {
    const fits =
      side === 'top'
        ? target.y - gap - bubble.height >= margin
        : side === 'bottom'
          ? target.y + target.height + gap + bubble.height <= viewport.height - margin
          : side === 'left'
            ? target.x - gap - bubble.width >= margin
            : target.x + target.width + gap + bubble.width <= viewport.width - margin
    if (!fits) continue

    if (side === 'top' || side === 'bottom') {
      const x = clampX(centerX - bubble.width / 2)
      const y = side === 'top' ? target.y - gap - bubble.height : target.y + target.height + gap
      return { side, x, y, arrow: arrowOffset(centerX - x, bubble.width) }
    }
    const y = clampY(centerY - bubble.height / 2)
    const x = side === 'left' ? target.x - gap - bubble.width : target.x + target.width + gap
    return { side, x, y, arrow: arrowOffset(centerY - y, bubble.height) }
  }

  return {
    side: null,
    x: clampX((viewport.width - bubble.width) / 2),
    y: clampY(viewport.height - bubble.height - margin),
    arrow: 0
  }
}

function arrowOffset(offset: number, size: number): number {
  return Math.max(18, Math.min(offset, size - 18))
}

export interface TourStep {
  /** Returns the element to spotlight, or null to fall back to the next match. */
  target: () => Element | null
  side: Side
  title: string
  body: string
  /** Spotlight corner radius, matching the target's own shape. */
  radius: number
}

export interface Tour {
  start(): void
  stop(): void
  update(): void
  readonly active: boolean
}

export function createTour(
  root: HTMLElement,
  steps: readonly TourStep[],
  onStop: () => void
): Tour {
  const part = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector)
    if (element === null) throw new Error(`Missing tour element ${selector}`)
    return element
  }
  const spotlight = part('[data-tour-spotlight]')
  const bubble = part('[data-tour-bubble]')
  const counter = part('[data-tour-step]')
  const title = part('[data-tour-title]')
  const body = part('[data-tour-body]')
  const back = part<HTMLButtonElement>('[data-tour-back]')
  const next = part<HTMLButtonElement>('[data-tour-next]')
  let index = 0
  let active = false

  function show(stepIndex: number): void {
    index = stepIndex
    const step = steps[index]!
    counter.textContent = `${index + 1} of ${steps.length}`
    title.textContent = step.title
    body.textContent = step.body
    back.hidden = index === 0
    next.textContent = index === steps.length - 1 ? 'Done' : 'Next'
    update()
    next.focus({ preventScroll: true })
  }

  function update(): void {
    if (!active) return
    const step = steps[index]!
    const target = step.target()
    const box = target?.getBoundingClientRect()
    const viewport = { width: root.clientWidth, height: root.clientHeight }
    if (box === undefined || (box.width === 0 && box.height === 0)) {
      spotlight.hidden = true
      bubble.dataset.side = 'none'
      const placed = placeBubble(
        { x: viewport.width / 2, y: viewport.height, width: 0, height: 0 },
        { width: bubble.offsetWidth, height: bubble.offsetHeight },
        viewport,
        'top'
      )
      bubble.style.translate = `${placed.x}px ${placed.y}px`
      return
    }

    const pad = 6
    const rect = {
      x: box.x - pad,
      y: box.y - pad,
      width: box.width + pad * 2,
      height: box.height + pad * 2
    }
    spotlight.hidden = false
    spotlight.style.translate = `${rect.x}px ${rect.y}px`
    spotlight.style.width = `${rect.width}px`
    spotlight.style.height = `${rect.height}px`
    spotlight.style.borderRadius = `${step.radius + pad}px`

    const placed = placeBubble(
      rect,
      { width: bubble.offsetWidth, height: bubble.offsetHeight },
      viewport,
      step.side
    )
    bubble.dataset.side = placed.side ?? 'none'
    bubble.style.setProperty('--arrow', `${placed.arrow}px`)
    bubble.style.translate = `${Math.round(placed.x)}px ${Math.round(placed.y)}px`
  }

  function stop(): void {
    if (!active) return
    active = false
    root.hidden = true
    onStop()
  }

  back.addEventListener('click', () => show(Math.max(0, index - 1)))
  next.addEventListener('click', () => {
    if (index === steps.length - 1) stop()
    else show(index + 1)
  })
  for (const skip of root.querySelectorAll('[data-tour-skip]')) {
    skip.addEventListener('click', stop)
  }
  window.addEventListener('resize', update)

  return {
    start() {
      active = true
      // Place the first step without animating in from the corner.
      root.classList.remove('is-animated')
      root.hidden = false
      show(0)
      requestAnimationFrame(() => root.classList.add('is-animated'))
    },
    stop,
    update,
    get active() {
      return active
    }
  }
}
