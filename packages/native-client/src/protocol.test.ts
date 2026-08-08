import { describe, expect, it } from 'vitest'
import {
  foregroundCurrentResultSchema,
  nativeMessageSchema,
  nativeRequestSchema
} from './protocol.js'

describe('native protocol', () => {
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
    expect(
      nativeMessageSchema.safeParse({ id: '42', ok: false, error: null }).success
    ).toBe(false)
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
})
