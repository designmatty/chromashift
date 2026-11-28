type Triple = [number, number, number]

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const radians = (degrees: number) => (degrees * Math.PI) / 180

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function hexToSrgb(hex: number): Triple {
  return [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}

// Björn Ottosson's OKLab transform for linear sRGB.
function srgbToLab([red, green, blue]: Triple): Triple {
  const r = toLinear(red)
  const g = toLinear(green)
  const b = toLinear(blue)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

function chromaAndHue([, a, b]: Triple) {
  return { chroma: Math.hypot(a, b), hue: (Math.atan2(b, a) * 180) / Math.PI }
}

function inSrgb([lightness, a, b]: Triple): boolean {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return Math.min(r, g, blue) >= -0.00001 && Math.max(r, g, blue) <= 1.00001
}

function fitLab(lightness: number, chroma: number, hue: number): Triple {
  const x = Math.cos(radians(hue))
  const y = Math.sin(radians(hue))
  const lab = (colorfulness: number): Triple => [lightness, x * colorfulness, y * colorfulness]
  if (inSrgb(lab(chroma))) return lab(chroma)

  // Find the highest chroma that fits without changing perceived hue or lightness.
  let low = 0
  let high = chroma
  for (let step = 0; step < 18; step++) {
    const middle = (low + high) / 2
    if (inSrgb(lab(middle))) low = middle
    else high = middle
  }
  return lab(low)
}

export function closingGradientPalette(
  colors: readonly [number, number],
  background: number,
  drift: number
) {
  const pink = srgbToLab(hexToSrgb(colors[0]))
  const warm = srgbToLab(hexToSrgb(colors[1]))
  const backgroundSrgb = hexToSrgb(background)
  const ground = srgbToLab(backgroundSrgb)
  const first = chromaAndHue(pink)
  const second = chromaAndHue(warm)
  const hueArc = ((first.hue - second.hue + 540) % 360) - 180
  const direction = Math.sign(hueArc)
  const hueShift = direction * Math.min(drift, Math.abs(hueArc) * 0.45)
  const highlightShift = direction * Math.min(52, Math.max(0, (Math.abs(hueArc) - 15) * 0.69))

  const corners = (pink: Triple, warm: Triple) => {
    const accent = chromaAndHue(pink)
    const warmHue = chromaAndHue(warm).hue
    const tintAngle = radians(warmHue + hueArc / 3)
    const dark = chromaAndHue([
      ground[0],
      ground[1] + 0.036 * Math.cos(tintAngle),
      ground[2] + 0.036 * Math.sin(tintAngle)
    ])
    const shadow = fitLab(ground[0], dark.chroma, dark.hue)
    const highlight = fitLab(
      clamp(pink[0] + 0.15, 0.25, 0.9),
      accent.chroma * 0.8,
      accent.hue + highlightShift
    )
    return [shadow, warm, pink, highlight].flat()
  }

  return {
    backgroundSrgb,
    dawn: corners(pink, warm),
    dusk: corners(
      fitLab(pink[0] - 0.03, first.chroma * 1.08, first.hue - hueShift),
      fitLab(warm[0] - 0.06, second.chroma * 1.15, second.hue + hueShift)
    )
  }
}

export function closingGradientStippleTable(levels: number, samples: number): Float32Array {
  const table = new Float32Array(samples * 4)
  const unit = 1 / (levels - 1)
  const levelsInLight = Array.from({ length: levels }, (_, level) => toLinear(level * unit))

  for (let sample = 0; sample < samples; sample++) {
    const display = sample / (samples - 1)
    const light = toLinear(display)
    // Choose a one-step window around the target. Maximizing the product of
    // distances to its endpoints yields a continuous variance through level boundaries.
    const varianceAt = (lower: number) =>
      (light - toLinear(lower)) * (toLinear(lower + unit) - light)
    let left = Math.max(0, display - unit)
    let right = Math.min(display, 1 - unit)
    for (let iteration = 0; iteration < 22; iteration++) {
      const a = left + (right - left) / 3
      const b = right - (right - left) / 3
      if (varianceAt(a) < varianceAt(b)) left = a
      else right = b
    }
    const window = (left + right) / 2
    const base = clamp(Math.floor(window / unit), 0, levels - 3)
    const low = levelsInLight[base]! - light
    const middle = levelsInLight[base + 1]! - light
    const high = levelsInLight[base + 2]! - light
    const variance = varianceAt(window)
    // Match the target mean and variance using three discrete output levels.
    const probabilityLow = clamp((variance + middle * high) / ((low - middle) * (low - high)), 0, 1)
    const probabilityHigh = clamp(
      (variance + low * middle) / ((high - low) * (high - middle)),
      0,
      1 - probabilityLow
    )
    const offset = sample * 4
    table[offset] = base
    table[offset + 1] = probabilityLow
    table[offset + 2] = 1 - probabilityHigh
  }
  return table
}
