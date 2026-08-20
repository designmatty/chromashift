import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersistentJsonLogger, readDiagnosticLog } from './structured-logger.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

describe('PersistentJsonLogger', () => {
  it('writes newline-delimited structured diagnostics to disk', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chromashift-log-'))
    directories.push(directory)
    const path = join(directory, 'logs', 'main.jsonl')
    const logger = new PersistentJsonLogger(path)

    logger.write({ level: 'information', eventName: 'ApplicationStarted', processId: 42 })

    const event = JSON.parse(readFileSync(path, 'utf8').trim()) as Record<string, unknown>
    expect(event).toMatchObject({
      level: 'information',
      eventName: 'ApplicationStarted',
      processId: 42
    })
    expect(event['timestamp']).toBeTypeOf('string')
  })

  it('reads a bounded newest-first diagnostic view and ignores malformed lines', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chromashift-log-'))
    directories.push(directory)
    const path = join(directory, 'main.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({
          timestamp: '2026-08-20T12:00:00.000Z',
          level: 'information',
          eventName: 'First',
          processId: 42
        }),
        'not-json',
        JSON.stringify({
          timestamp: '2026-08-20T12:01:00.000Z',
          level: 'warning',
          eventName: 'Second',
          reason: 'test'
        })
      ].join('\n'),
      'utf8'
    )

    expect(readDiagnosticLog(path, 3)).toEqual([
      {
        timestamp: '2026-08-20T12:01:00.000Z',
        level: 'warning',
        eventName: 'Second',
        details: '{"reason":"test"}'
      },
      {
        timestamp: '2026-08-20T12:00:00.000Z',
        level: 'information',
        eventName: 'First',
        details: '{"processId":42}'
      }
    ])
    expect(readDiagnosticLog(path, 2)).toHaveLength(1)
    expect(readDiagnosticLog(join(directory, 'missing.jsonl'))).toEqual([])
  })
})
