// Tooltips like the app's Chakra tooltips, for elements with `data-tooltip`.
// `data-tooltip-placement` is `top` (default), `top-start`, or `bottom`.
// The text is read when the tooltip opens, so callers can update it freely.

const openDelay = 400
const gutter = 8
const edge = 8

export function initTooltips(root: HTMLElement): void {
  const tip = document.createElement('div')
  tip.className = 'tooltip'
  tip.setAttribute('role', 'tooltip')
  tip.hidden = true
  root.append(tip)

  let target: HTMLElement | null = null
  let timer = 0

  function show(element: HTMLElement): void {
    const text = element.dataset.tooltip
    if (text === undefined || text === '' || element.closest('[hidden]') !== null) return
    tip.textContent = text
    tip.hidden = false
    const anchor = element.getBoundingClientRect()
    const box = tip.getBoundingClientRect()
    const placement = element.dataset.tooltipPlacement ?? 'top'
    let x = placement === 'top-start' ? anchor.left : anchor.left + (anchor.width - box.width) / 2
    let y = placement === 'bottom' ? anchor.bottom + gutter : anchor.top - box.height - gutter
    if (y < edge) y = anchor.bottom + gutter
    x = Math.min(Math.max(x, edge), window.innerWidth - box.width - edge)
    tip.style.translate = `${Math.round(x)}px ${Math.round(y)}px`
  }

  function open(element: HTMLElement, immediate: boolean): void {
    if (element === target) return
    close()
    target = element
    timer = window.setTimeout(() => show(element), immediate ? 0 : openDelay)
  }

  function close(): void {
    window.clearTimeout(timer)
    target = null
    tip.hidden = true
  }

  const owner = (event: Event): HTMLElement | null =>
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tooltip]') : null

  root.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return
    const element = owner(event)
    if (element === null) close()
    else open(element, false)
  })
  root.addEventListener('pointerout', (event) => {
    const next = event.relatedTarget instanceof Element ? event.relatedTarget : null
    if (target !== null && (next === null || !target.contains(next))) close()
  })
  root.addEventListener('focusin', (event) => {
    const element = owner(event)
    if (element !== null && element.matches(':focus-visible')) open(element, true)
  })
  root.addEventListener('focusout', close)
  // Pressing a control or Escape dismisses the tooltip, as in the app.
  root.addEventListener('pointerdown', close)
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
  })
}
