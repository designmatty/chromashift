import { NativeClient } from '@chromashift/native-client'

const adlxControls = ['brightness', 'contrast', 'saturation', 'hue', 'colorTemperature']

/**
 * Mild product values near neutral. On the reference RDNA 2 ranges they move
 * brightness, contrast and saturation +10, hue +1 and color temperature
 * +400 K (6850 K snapped to the 100 K step).
 */
const mildSettings = { brightness: 55, contrast: 55, saturation: 55, hue: 2, colorTemperature: 55 }

/**
 * #122: AMD ADLX controls on a display that already reports HDR.
 *
 * Runs only when an AMD display reports HDR with an ADLX control, and skips
 * otherwise. It never toggles HDR and never writes a transformed gamma ramp.
 * Its own DisplayService is the restoration guard: it captures before writing,
 * restores and reads back, and stop() restores every remaining baseline; the
 * helper watchdog restores if this process dies.
 */
export async function verifyHdrAmdColor({ displayServicePath }) {
  const native = new NativeClient({ executablePath: displayServicePath })
  await native.start()
  try {
    const candidates = []
    for (const display of await native.getDisplays()) {
      if (!display.hdr || display.adapter.vendor !== 'amd') continue
      const report = await native.getDisplayCapabilityReport(display.id)
      if (adlxControls.some((name) => report.capabilities[name].supported))
        candidates.push({ display, report })
    }
    if (candidates.length === 0) {
      globalThis.console.log(
        'HDR AMD color smoke skipped: no AMD display reports HDR with an ADLX control.'
      )
      return { skipped: true, displayIds: [] }
    }
    for (const { display, report } of candidates) await verifyDisplay(native, display, report)
    return { skipped: false, displayIds: candidates.map(({ display }) => display.id) }
  } finally {
    // service.shutdown restores and reads back every captured baseline, or throws.
    await native.stop()
  }
}

async function verifyDisplay(native, display, report) {
  const capabilities = report.capabilities
  if (capabilities.gamma.supported)
    throw new Error(
      `${display.name}: gamma uses the Windows ramp and must stay SDR-only under HDR.`
    )
  for (const name of adlxControls) {
    if (capabilities[name].supported && capabilities[name].provider !== 'amd')
      throw new Error(
        `${display.name}: HDR ${name} must use the AMD provider, not ${capabilities[name].provider}.`
      )
  }
  const original = amdValues(report)
  const capture = await native.captureBaseline(display.id)
  if (capture.colorMode !== 'hdr')
    throw new Error(
      `${display.name}: the baseline did not record HDR (colorMode ${capture.colorMode}).`
    )

  // Send only ADLX values. A gamma probe here could reach the SDR path, and
  // write a transformed ramp, if HDR turned off after capture; the native
  // allowlist tests cover the gamma refusal instead.
  const settings = Object.fromEntries(
    adlxControls
      .filter((name) => capabilities[name].supported)
      .map((name) => [name, mildSettings[name]])
  )
  const result = await native.applyDisplaySettings(display.id, settings)
  const applied = amdValues(await native.getDisplayCapabilityReport(display.id))
  for (const name of Object.keys(settings)) {
    if (!Number.isInteger(result.applied[name]) || applied[name] !== result.applied[name])
      throw new Error(
        `${display.name}: HDR ${name} read back ${applied[name]}; apply reported ${result.applied[name]}.`
      )
  }
  if (result.applied.gammaRampHash !== undefined && result.applied.gammaRampHash !== null)
    throw new Error(`${display.name}: an HDR AMD apply wrote a transformed gamma ramp.`)

  const restored = await native.restoreDisplay(display.id)
  if (!restored.restored)
    throw new Error(`${display.name}: HDR restore was not confirmed: ${JSON.stringify(restored)}`)
  const after = amdValues(await native.getDisplayCapabilityReport(display.id))
  if (JSON.stringify(after) !== JSON.stringify(original))
    throw new Error(
      `${display.name}: restore left AMD values ${JSON.stringify(after)}; expected ${JSON.stringify(original)}.`
    )
  globalThis.console.log(
    `HDR AMD color smoke passed on ${display.name}: ${JSON.stringify({ original, applied, restored: after, baselineRampHash: capture.gammaRampHash })}`
  )
}

function amdValues(report) {
  return Object.fromEntries(
    adlxControls.map((name) => [name, report.nativeState.amd[name].current ?? null])
  )
}
