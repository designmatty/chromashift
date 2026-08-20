import { describe, expect, it } from 'vitest'
import {
  displayApplyRequestSchema,
  displaySchema,
  displayRestoreResultSchema,
  displayStateSchema,
  foregroundCurrentResultSchema,
  foregroundApplicationsResultSchema,
  nativeMessageSchema,
  nativeRequestSchema,
  restoreAllResultSchema,
  systemInfoSchema
} from './protocol.js'

describe('native protocol', () => {
  it('keeps endpoint and physical display identities distinct', () => {
    expect(
      displaySchema.parse({
        id: 'display:endpoint',
        physicalId: 'display:physical',
        name: 'Panel',
        windowsDisplayName: '\\\\.\\DISPLAY1',
        monitorDevicePath: 'monitor-path',
        manufacturer: 'SAM',
        productCode: '75CB',
        serialNumber: 'HNAY301023',
        adapter: { id: 'adapter', name: 'GPU', vendor: 'nvidia', deviceId: 'device' },
        connection: 'DisplayPort',
        primary: true,
        hdr: false,
        advancedColorSupported: true,
        bitsPerColorChannel: 10,
        refreshRate: 360
      })
    ).toMatchObject({ id: 'display:endpoint', physicalId: 'display:physical' })
  })

  it('accepts a request with structured parameters', () => {
    expect(
      nativeRequestSchema.parse({
        id: '42',
        command: 'display.apply',
        params: { displayId: 'abc', settings: { gamma: 1.15 } }
      })
    ).toMatchObject({ id: '42', command: 'display.apply' })
  })

  it('rejects malformed response envelopes', () => {
    expect(nativeMessageSchema.safeParse({ id: '42', ok: false, error: null }).success).toBe(false)
  })

  it('accepts unavailable AMD diagnostics with omitted version fields', () => {
    const info = systemInfoSchema.parse({
      protocolVersion: 1,
      serviceVersion: '1.0.0',
      operatingSystem: 'Windows',
      processId: 42,
      providers: {
        amd: {
          libraryAvailable: false,
          initialized: false,
          displayCount: 0,
          runtimeValidation: 'ADLX is unavailable.',
          error: 'Unable to load amdadlx64.dll'
        }
      }
    })

    expect(info.providers.amd.version).toBeUndefined()
    expect(info.providers.amd.fullVersion).toBeUndefined()
  })

  it('validates resolved foreground application details', () => {
    expect(
      foregroundCurrentResultSchema.parse({
        application: {
          pid: 42,
          executable: 'example.exe',
          path: 'C:\\Example\\example.exe',
          title: 'Example',
          monitorDeviceName: '\\\\.\\DISPLAY1'
        }
      }).application?.executable
    ).toBe('example.exe')
  })

  it('validates visible top-level application results', () => {
    expect(
      foregroundApplicationsResultSchema.parse({
        applications: [
          {
            pid: 42,
            executable: 'example.exe',
            path: 'C:\\Example\\example.exe',
            title: 'Example',
            monitorDeviceName: '\\\\.\\DISPLAY1'
          }
        ]
      }).applications
    ).toHaveLength(1)
  })

  it('validates product-level display settings before they cross the native boundary', () => {
    expect(
      displayApplyRequestSchema.parse({
        displayId: 'display:abc',
        settings: { brightness: 50, gamma: 1.15, saturation: 75 }
      })
    ).toEqual({
      displayId: 'display:abc',
      settings: { brightness: 50, gamma: 1.15, saturation: 75 }
    })

    expect(
      displayApplyRequestSchema.safeParse({
        displayId: 'display:abc',
        settings: { saturation: 101 }
      }).success
    ).toBe(false)
    expect(
      displayApplyRequestSchema.parse({
        displayId: 'display:abc',
        settings: { gamma: 2.8 }
      }).settings.gamma
    ).toBe(2.8)
    expect(
      displayApplyRequestSchema.safeParse({
        displayId: 'display:abc',
        settings: { gamma: 2.81 }
      }).success
    ).toBe(false)
  })

  it('validates Windows and AMD display state results', () => {
    const channel = Array.from({ length: 256 }, (_, index) => index * 257)
    expect(
      displayStateSchema.parse({
        displayId: 'display:windows',
        provider: 'windows',
        gammaRamp: { red: channel, green: channel, blue: channel },
        gammaRampHash: 'hash'
      }).provider
    ).toBe('windows')

    expect(
      displayStateSchema.parse({
        displayId: 'display:amd',
        provider: 'amd',
        brightness: 10,
        saturation: 20
      }).provider
    ).toBe('amd')
  })

  it('requires explicit outcomes for per-display and restore-all results', () => {
    expect(
      displayRestoreResultSchema.safeParse({
        displayId: 'display:abc',
        restored: false
      }).success
    ).toBe(false)

    expect(
      restoreAllResultSchema.parse({
        displays: [
          { displayId: 'display:abc', restored: true, gammaRampHash: 'hash' },
          { displayId: 'display:def', restored: false, error: 'restore failed' },
          { displayId: 'display:hdr', restored: false, reason: 'hdrActive' },
          {
            displayId: 'display:gone',
            restored: false,
            reason: 'displayDisconnected',
            discarded: true
          },
          {
            displayId: 'display:unsafe',
            restored: false,
            code: 'HDR_UNSAFE',
            error: 'restore deferred'
          }
        ]
      }).displays
    ).toHaveLength(5)
  })
})
