import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeClient, NativeServiceError } from './client.js'

const fakeServicePath = fileURLToPath(
  new URL('./test-fixtures/fake-display-service.mjs', import.meta.url)
)

let client: NativeClient | undefined

function createClient(requestTimeoutMs = 500): NativeClient {
  client = new NativeClient({
    executablePath: process.execPath,
    executableArguments: [fakeServicePath],
    requestTimeoutMs,
    startupTimeoutMs: 1_000
  })
  return client
}

afterEach(async () => {
  await client?.stop()
  client = undefined
})

describe('NativeClient activation command surface', () => {
  it('sends validated state, capture, apply, and restore requests', async () => {
    const native = createClient()
    await native.start()

    const state = await native.getDisplayState('display:test')
    expect(state.provider).toBe('windows')
    if (state.provider === 'windows') {
      expect(state.gammaRamp.red).toHaveLength(256)
    }

    await expect(native.captureBaseline('display:test')).resolves.toMatchObject({
      displayId: 'display:test',
      state: 'captured'
    })
    await expect(
      native.applyDisplaySettings('display:test', { gamma: 1.1, saturation: 75 })
    ).resolves.toMatchObject({
      displayId: 'display:test',
      applied: { gammaRampHash: 'applied-hash', saturation: 47 }
    })
    await expect(native.restoreDisplay('display:test')).resolves.toMatchObject({
      displayId: 'display:test',
      restored: true
    })
    await expect(native.restoreAllBaselines()).resolves.toMatchObject({
      displays: [
        { displayId: 'display:test', restored: true },
        { displayId: 'display:missing', restored: false, reason: 'baselineNotCaptured' }
      ]
    })
  })

  it('rejects invalid arguments and malformed success results', async () => {
    const native = createClient()
    await native.start()

    await expect(
      native.applyDisplaySettings('display:test', { saturation: 101 })
    ).rejects.toThrow()
    await expect(native.getDisplayState('display:malformed')).rejects.toThrow()
  })

  it('preserves native error metadata in a structured error', async () => {
    const native = createClient()
    await native.start()

    const request = native.request('test.error')
    await expect(request).rejects.toBeInstanceOf(NativeServiceError)
    await expect(request).rejects.toMatchObject({
      code: 'TEST_NATIVE_ERROR',
      command: 'test.error',
      nativeMessage: 'Native test failure'
    })
  })

  it('forwards unsolicited native events', async () => {
    const native = createClient()
    await native.start()
    const eventReceived = once(native, 'event')

    await native.request('test.event')

    await expect(eventReceived).resolves.toMatchObject([
      {
        event: 'foregroundApplicationChanged',
        data: { application: { executable: 'game.exe' } }
      }
    ])
  })

  it('times out unanswered requests and remains usable', async () => {
    const native = createClient(50)
    await native.start()

    await expect(native.request('test.timeout')).rejects.toThrow(
      'DisplayService request timed out: test.timeout'
    )
    await expect(native.getSystemInfo()).resolves.toMatchObject({ protocolVersion: 1 })
  })

  it('cleans up the child process after a startup timeout', async () => {
    client = new NativeClient({
      executablePath: process.execPath,
      executableArguments: [fakeServicePath, '--no-ready'],
      requestTimeoutMs: 50,
      startupTimeoutMs: 50
    })

    await expect(client.start()).rejects.toThrow('DisplayService did not announce readiness')
    expect(client.running).toBe(false)
  })

  it('rejects pending requests when the native process exits', async () => {
    const native = createClient()
    await native.start()
    const exited = once(native, 'exit')

    await expect(native.request('test.exit')).rejects.toThrow('DisplayService exited')
    await expect(exited).resolves.toEqual([23, null])
    expect(native.running).toBe(false)
  })
})
