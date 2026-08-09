import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeClient, NativeServiceError } from './client.js'

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
    expect(capabilityReport.capabilities.gamma.max).toBe(2.8)
    expect(capabilityReport.capabilities.saturation.provider).toBe('nvidia')
    expect(capabilityReport.nativeState.nvidia.saturation.current).toBeTypeOf('number')
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
})
