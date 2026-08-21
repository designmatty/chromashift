import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeClient, NativeServiceError } from './client.js'

const executablePath =
  process.env['CHROMASHIFT_DISPLAY_SERVICE_PATH'] ??
  fileURLToPath(
    new URL(
      '../../../native/DisplayService/bin/Debug/net10.0-windows/DisplayService.exe',
      import.meta.url
    )
  )

let client: NativeClient | undefined

afterEach(async () => {
  await client?.stop()
  client = undefined
})

describe('DisplayService lifecycle', () => {
  it('starts, answers requests, reports errors, and stops', async () => {
    client = new NativeClient({ executablePath })

    const info = await client.start()

    expect(info.protocolVersion).toBe(1)
    expect(info.processId).toBeGreaterThan(0)
    expect(info.operatingSystem).toContain('Windows')
    const health = await client.getServiceHealth()
    expect(health).toMatchObject({
      status: 'healthy',
      protocolVersion: 1,
      baselineCount: 0,
      watchdogArmed: true
    })
    const foreground = await client.getForegroundApplication()
    if (foreground !== null) {
      expect(foreground.pid).toBeGreaterThan(0)
      expect(foreground.monitorDeviceName).toMatch(/^\\\\\.\\DISPLAY\d+$/)
    }
    const visibleApplications = await client.getVisibleApplications()
    expect(visibleApplications.every((application) => application.pid > 0)).toBe(true)
    const displays = await client.getDisplays()
    expect(displays.length).toBeGreaterThan(0)
    expect(new Set(displays.map((display) => display.id)).size).toBe(displays.length)
    expect(displays.some((display) => display.primary)).toBe(true)
    expect(info.providers.amd.libraryAvailable).toBe(true)
    const capabilityReport = await client.getDisplayCapabilityReport(displays[0]!.id)
    expect(capabilityReport.capabilities.gamma.provider).toBe('windows')
    expect(capabilityReport.capabilities.gamma.max).toBe(2.8)
    expect(capabilityReport.capabilities.saturation.provider).toBe('nvidia')
    expect(capabilityReport.nativeState.nvidia.saturation.current).toBeTypeOf('number')
    const topology = await client.refreshDisplayTopology()
    expect(topology.generation).toBe(1)
    expect(topology.displays.map((display) => display.id)).toEqual(
      displays.map((display) => display.id)
    )
    expect(topology.capabilityReports).toHaveLength(displays.length)
    expect(topology.baselines).toEqual([])
    const displayState = await client.getDisplayState(displays[0]!.id)
    expect(displayState.displayId).toBe(displays[0]!.id)
    const unknownCommand = client.request('unknown.command')
    await expect(unknownCommand).rejects.toBeInstanceOf(NativeServiceError)
    await expect(unknownCommand).rejects.toMatchObject({
      code: 'COMMAND_UNKNOWN',
      command: 'unknown.command'
    })

    await client.stop()
    expect(client.running).toBe(false)
  })

  it('restores a captured baseline and exits when Electron heartbeats stop', async () => {
    client = new NativeClient({ executablePath, heartbeatIntervalMs: 0 })
    await client.start()
    const displays = await client.getDisplays()
    const candidateReports = await Promise.all(
      displays.map(async (display) => ({
        display,
        report: await client!.getDisplayCapabilityReport(display.id)
      }))
    )
    const candidate = candidateReports.find(
      ({ display, report }) => !display.hdr && report.capabilities.gamma.supported
    )
    if (candidate === undefined) return

    const baseline = await client.getDisplayState(candidate.display.id)
    await client.captureBaseline(candidate.display.id)
    const changed = await client.applyDisplaySettings(candidate.display.id, { gamma: 1.02 })
    expect(changed.applied.gammaRampHash).toBeDefined()
    const exited = once(client, 'exit')

    await expect(exited).resolves.toEqual([0, null])
    expect(client.potentialBaselineDisplayIds).toEqual([])

    client = new NativeClient({ executablePath })
    await client.start()
    const restored = await client.getDisplayState(candidate.display.id)
    expect(restored.provider).toBe(baseline.provider)
    expect(restored.gammaRampHash).toBe(baseline.gammaRampHash)
  }, 20_000)
})
