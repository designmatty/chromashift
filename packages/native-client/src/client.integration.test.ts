import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeClient } from './client.js'

const executablePath = fileURLToPath(
  new URL('../../../native/DisplayService/bin/Debug/net10.0-windows/DisplayService.exe', import.meta.url)
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
    const foreground = await client.getForegroundApplication()
    if (foreground !== null) {
      expect(foreground.pid).toBeGreaterThan(0)
      expect(foreground.monitorDeviceName).toMatch(/^\\\\\.\\DISPLAY\d+$/)
    }
    const displays = await client.getDisplays()
    expect(displays.length).toBeGreaterThan(0)
    expect(new Set(displays.map((display) => display.id)).size).toBe(displays.length)
    expect(displays.some((display) => display.primary)).toBe(true)
    expect(info.providers.amd.libraryAvailable).toBe(true)
    const capabilityReport = await client.getDisplayCapabilityReport(displays[0]!.id)
    expect(capabilityReport.capabilities.gamma.provider).toBe('windows')
    expect(capabilityReport.capabilities.saturation.provider).toBe('nvidia')
    expect(capabilityReport.nativeState.nvidia.saturation.current).toBeTypeOf('number')
    await expect(client.request('unknown.command')).rejects.toThrow('COMMAND_UNKNOWN')

    await client.stop()
    expect(client.running).toBe(false)
  })
})
