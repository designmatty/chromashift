import noiseUrl from '@/assets/closing-gradient-noise.png'
import { createClosingGradientRenderer, gradientSettings } from '@/closing-gradient-renderer'
import { maxTides } from '@/closing-gradient-shaders'

const introDuration = 2.8
const flowRate = 0.15 * gradientSettings.speed
const tideStrength = (Math.PI / 2) * gradientSettings.tide
const tideSpeed = 0.6
const tideFeather = 0.21

type Tide = { x: number; y: number; start: number }

export function initClosingGradient(): void {
  const section = document.querySelector<HTMLElement>('.closing')
  const canvas = section?.querySelector<HTMLCanvasElement>('.closing__gradient')
  const art = section?.querySelector<HTMLElement>('.closing__art')
  const toggle = section?.querySelector<HTMLButtonElement>('.closing__motion')
  if (!section || !canvas || !art || !toggle) return

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  if (!reducedMotion.matches) art.setAttribute('data-awaiting', '')
  let renderer: ReturnType<typeof createClosingGradientRenderer> | undefined
  let noise: HTMLImageElement | undefined
  let loadingNoise = false
  let visible = false
  let paused = false
  let needsResize = true
  let frame: number | undefined
  let lastFrame: number | undefined
  let elapsed = 0
  let flow = 0
  let revealTime = 0
  let tidePhase = 0
  let stirEnergy = 0
  let stir = 0
  let pointer: { x: number; y: number } | undefined
  let viewHeight = 1
  let aspect = 1
  const tides: Tide[] = []
  const waveUniforms = new Float32Array(maxTides * 4)

  const canRender = () => visible && !document.hidden && renderer !== null
  const canAnimate = () => canRender() && !paused && !reducedMotion.matches

  const requestFrame = () => {
    if (frame === undefined && canRender()) frame = requestAnimationFrame(draw)
  }

  const stopFrames = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    lastFrame = undefined
    pointer = undefined
  }

  const showFallback = () => {
    stopFrames()
    renderer = null
    art.removeAttribute('data-awaiting')
    art.removeAttribute('data-rendering')
    toggle.hidden = true
  }

  const loadNoise = () => {
    if (loadingNoise) return
    loadingNoise = true
    const image = new Image()
    image.src = noiseUrl
    void image.decode().then(() => {
      noise = image
      requestFrame()
    }, showFallback)
  }

  const updateTides = (settle: boolean) => {
    waveUniforms.fill(0)
    for (let index = tides.length - 1; index >= 0; index--) {
      const wave = tides[index]!
      const x = (wave.x - 0.5) * aspect
      const y = 0.5 - wave.y
      const radius = (elapsed - wave.start) * tideSpeed - tideFeather
      const reach = Math.hypot(aspect / 2 + Math.abs(x), 0.5 + Math.abs(y))

      if (settle || radius - tideFeather >= reach) {
        tidePhase = (tidePhase + tideStrength) % (2 * Math.PI)
        tides.splice(index, 1)
      } else {
        // Slots remain distinct during this iteration even when a tide is removed.
        waveUniforms.set([x, y, radius, tideStrength], index * 4)
      }
    }
  }

  const draw = (now: number) => {
    frame = undefined
    if (!canRender()) return
    if (renderer === undefined) {
      if (noise === undefined) {
        loadNoise()
        return
      }
      renderer = createClosingGradientRenderer(canvas, noise)
      if (renderer === null) {
        showFallback()
        return
      }
      art.removeAttribute('data-awaiting')
    }
    if (renderer === null) return

    const reduce = reducedMotion.matches
    const animate = !paused && !reduce
    const delta = lastFrame === undefined ? 0 : now - lastFrame
    if (animate && lastFrame !== undefined && delta < 31 && !needsResize) {
      requestFrame()
      return
    }

    if (needsResize) {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (!width || !height) return
      if (!renderer.resize(width, height)) {
        renderer.dispose()
        showFallback()
        return
      }
      viewHeight = height
      aspect = canvas.width / canvas.height
      needsResize = false
    }

    if (animate) {
      const seconds = Math.min(delta, 100) / 1000
      elapsed += seconds
      stirEnergy *= Math.exp(-seconds / 0.7)
      stir += (Math.min(stirEnergy, 1.2) - stir) * (1 - Math.exp(-seconds / 0.12))
      flow += seconds * flowRate * (1 + 2 * stir * gradientSettings.stir)
      revealTime = Math.min(introDuration, revealTime + seconds)
    } else if (reduce) {
      revealTime = introDuration
    }

    updateTides(reduce)
    const reveal = (1 - Math.cos((revealTime / introDuration) * Math.PI)) / 2
    renderer.draw(flow, elapsed * flowRate + tidePhase, reveal, waveUniforms)
    if (!art.hasAttribute('data-rendering')) art.setAttribute('data-rendering', '')
    if (toggle.hidden !== reduce) toggle.hidden = reduce
    lastFrame = animate ? now : undefined
    if (animate) requestFrame()
  }

  new IntersectionObserver(
    ([entry]) => {
      visible = (entry?.intersectionRatio ?? 0) >= 0.12
      if (visible) requestFrame()
      else stopFrames()
    },
    { threshold: 0.12 }
  ).observe(section)

  new ResizeObserver(() => {
    needsResize = true
    requestFrame()
  }).observe(canvas)

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopFrames()
    else requestFrame()
  })

  reducedMotion.addEventListener('change', () => {
    stopFrames()
    toggle.hidden = reducedMotion.matches || renderer == null
    requestFrame()
  })

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    showFallback()
  })

  canvas.addEventListener('webglcontextrestored', () => {
    renderer = undefined
    needsResize = true
    requestFrame()
  })

  toggle.addEventListener('click', () => {
    paused = !paused
    toggle.toggleAttribute('data-paused', paused)
    toggle.setAttribute('aria-label', `${paused ? 'Resume' : 'Pause'} background animation`)
    if (paused) stopFrames()
    else requestFrame()
  })

  section.addEventListener('pointermove', (event) => {
    if (!canAnimate()) return
    const { clientX: x, clientY: y } = event
    if (pointer !== undefined) {
      stirEnergy += (1.2 * Math.hypot(x - pointer.x, y - pointer.y)) / viewHeight
    }
    pointer = { x, y }
  })
  section.addEventListener('pointerleave', () => (pointer = undefined))

  section.addEventListener('click', (event) => {
    if (!canAnimate() || event.detail === 0 || (event.target as Element).closest('a, button'))
      return
    if (tides.length >= maxTides) return
    const bounds = canvas.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    tides.push({
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
      start: elapsed
    })
  })
}
