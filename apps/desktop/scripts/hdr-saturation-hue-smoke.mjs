import { NativeClient, NativeServiceError } from '@chromashift/native-client'

/**
 * #89: NVIDIA saturation and hue on a display that already reports HDR.
 *
 * Runs only when an NVIDIA display reports HDR with saturation or hue support,
 * and skips otherwise. It never toggles HDR and never writes brightness,
 * contrast or gamma. Its own DisplayService is the restoration guard: it
 * captures before writing, restores and reads back, and stop() restores every
 * remaining baseline; the helper watchdog restores if this process dies.
 */
export async function verifyHdrSaturationHue({ displayServicePath }) {
  const native = new NativeClient({ executablePath: displayServicePath })
  await native.start()
  try {
    const candidates = []
    for (const display of await native.getDisplays()) {
      if (!display.hdr || display.adapter.vendor !== 'nvidia') continue
      const report = await native.getDisplayCapabilityReport(display.id)
      if (report.capabilities.saturation.supported || report.capabilities.hue.supported)
        candidates.push({ display, report })
    }
    if (candidates.length === 0) {
      globalThis.console.log(
        'HDR saturation/hue smoke skipped: no NVIDIA display reports HDR with saturation or hue support.'
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
  if (capabilities.brightness.supported || capabilities.contrast.supported || capabilities.gamma.supported)
    throw new Error(`${display.name}: the Windows ramp controls must stay SDR-only under HDR.`)
  const original = nvidiaValues(report)
  const capture = await native.captureBaseline(display.id)
  if (capture.colorMode !== 'hdr')
    throw new Error(`${display.name}: the baseline did not record HDR (colorMode ${capture.colorMode}).`)

  // The helper refuses an SDR-only field under HDR before any write.
  try {
    await native.applyDisplaySettings(display.id, { brightness: 50, saturation: 50 })
    throw new Error(`${display.name}: an HDR brightness request was accepted.`)
  } catch (error) {
    if (!(error instanceof NativeServiceError) || error.code !== 'HDR_UNSAFE') throw error
  }
  const unchanged = nvidiaValues(await native.getDisplayCapabilityReport(display.id))
  if (JSON.stringify(unchanged) !== JSON.stringify(original))
    throw new Error(`${display.name}: a refused HDR request changed NVIDIA values.`)

  // Mild changes from the current native values: +/-5 saturation, +/-4 hue degrees.
  const settings = {}
  const expected = {}
  const saturation = report.nativeState.nvidia.saturation
  if (capabilities.saturation.supported && Number.isInteger(saturation.current)) {
    const min = saturation.min ?? 0
    const max = saturation.max ?? 100
    expected.saturation = saturation.current + (saturation.current + 5 <= max ? 5 : -5)
    settings.saturation = ((expected.saturation - min) / (max - min)) * 100
  }
  const hue = report.nativeState.nvidia.hue
  if (capabilities.hue.supported && Number.isInteger(hue.current)) {
    expected.hue = hue.current + (hue.current + 4 <= 359 ? 4 : -4)
    settings.hue = (expected.hue / 359) * 100
  }
  if (Object.keys(settings).length === 0) {
    globalThis.console.log(`HDR saturation/hue smoke skipped ${display.name}: no readable NVIDIA values.`)
    return
  }

  const result = await native.applyDisplaySettings(display.id, settings)
  const applied = nvidiaValues(await native.getDisplayCapabilityReport(display.id))
  for (const [name, value] of Object.entries(expected)) {
    if (result.applied[name] !== value || applied[name] !== value)
      throw new Error(
        `${display.name}: HDR ${name} read back ${applied[name]} (apply reported ${result.applied[name]}); expected ${value}.`
      )
  }

  const restored = await native.restoreDisplay(display.id)
  if (!restored.restored)
    throw new Error(`${display.name}: HDR restore was not confirmed: ${JSON.stringify(restored)}`)
  const after = nvidiaValues(await native.getDisplayCapabilityReport(display.id))
  if (JSON.stringify(after) !== JSON.stringify(original))
    throw new Error(
      `${display.name}: restore left NVIDIA values ${JSON.stringify(after)}; expected ${JSON.stringify(original)}.`
    )
  globalThis.console.log(
    `HDR saturation/hue smoke passed on ${display.name}: ${JSON.stringify({ original, applied, restored: after, baselineRampHash: capture.gammaRampHash })}`
  )
}

function nvidiaValues(report) {
  return {
    saturation: report.nativeState.nvidia.saturation.current ?? null,
    hue: report.nativeState.nvidia.hue.current ?? null
  }
}
