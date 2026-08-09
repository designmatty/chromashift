/* global process, setImmediate */

import { createInterface } from 'node:readline'

const displayId = 'display:test'
const channel = Array.from({ length: 256 }, (_, index) => index * 257)

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function succeed(id, result) {
  write({ id, ok: true, result })
}

function fail(id, code, message) {
  write({ id, ok: false, error: { code, message } })
}

if (!process.argv.includes('--no-ready')) {
  write({ event: 'service.ready', data: { protocolVersion: 1 } })
}

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const request = JSON.parse(line)

  switch (request.command) {
    case 'system.info':
      succeed(request.id, {
        protocolVersion: 1,
        serviceVersion: 'test',
        operatingSystem: 'test',
        processId: process.pid,
        providers: {
          amd: {
            libraryAvailable: false,
            initialized: false,
            version: null,
            fullVersion: null,
            displayCount: 0,
            runtimeValidation: 'test'
          }
        }
      })
      break
    case 'display.state':
      if (request.params?.displayId === 'display:malformed') {
        succeed(request.id, { displayId: 'display:malformed' })
      } else if (request.params?.displayId === displayId) {
        succeed(request.id, {
          displayId,
          provider: 'windows',
          gammaRamp: { red: channel, green: channel, blue: channel },
          gammaRampHash: 'test-hash'
        })
      } else {
        fail(request.id, 'BAD_TEST_REQUEST', 'display.state params were incorrect')
      }
      break
    case 'baseline.capture':
      if (request.params?.displayId !== displayId) {
        fail(request.id, 'BAD_TEST_REQUEST', 'baseline.capture params were incorrect')
        break
      }
      succeed(request.id, { displayId, state: 'captured', gammaRampHash: 'test-hash' })
      break
    case 'display.apply':
      if (
        request.params?.displayId !== displayId ||
        request.params?.settings?.gamma !== 1.1 ||
        request.params?.settings?.saturation !== 75
      ) {
        fail(request.id, 'BAD_TEST_REQUEST', 'display.apply params were incorrect')
        break
      }
      succeed(request.id, {
        displayId,
        settings: request.params.settings,
        applied: { gammaRampHash: 'applied-hash', saturation: 47 }
      })
      break
    case 'display.restore':
      if (request.params?.displayId !== displayId) {
        fail(request.id, 'BAD_TEST_REQUEST', 'display.restore params were incorrect')
        break
      }
      succeed(request.id, { displayId, restored: true, gammaRampHash: 'test-hash' })
      break
    case 'baseline.restoreAll':
      if (request.params !== undefined) {
        fail(request.id, 'BAD_TEST_REQUEST', 'baseline.restoreAll must omit params')
        break
      }
      succeed(request.id, {
        displays: [
          { displayId, restored: true, gammaRampHash: 'test-hash' },
          { displayId: 'display:missing', restored: false, reason: 'baselineNotCaptured' }
        ]
      })
      break
    case 'test.event':
      write({
        event: 'foregroundApplicationChanged',
        data: {
          application: {
            pid: 42,
            executable: 'game.exe',
            path: 'C:\\Games\\game.exe',
            title: 'Game',
            monitorDeviceName: '\\\\.\\DISPLAY1'
          }
        }
      })
      succeed(request.id, {})
      break
    case 'test.timeout':
      break
    case 'test.exit':
      process.exit(23)
      break
    case 'test.error':
      fail(request.id, 'TEST_NATIVE_ERROR', 'Native test failure')
      break
    case 'service.shutdown':
      succeed(request.id, { displays: [] })
      setImmediate(() => process.exit(0))
      break
    default:
      fail(request.id, 'COMMAND_UNKNOWN', `Unknown command: ${request.command}`)
  }
})
