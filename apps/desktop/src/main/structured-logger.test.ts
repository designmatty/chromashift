import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersistentJsonLogger } from './structured-logger.js'

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
})
