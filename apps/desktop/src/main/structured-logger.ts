export type LogLevel = 'information' | 'warning' | 'error' | 'critical'

export interface StructuredLogEvent {
  level: LogLevel
  eventName: string
  [key: string]: unknown
}

export interface StructuredLogger {
  write(event: StructuredLogEvent): void
}

export interface DiagnosticLogEntry {
  timestamp: string
  level: LogLevel
  eventName: string
  details: string
}

export class JsonConsoleLogger implements StructuredLogger {
  public write(event: StructuredLogEvent): void {
    const line = serializeEvent(event)
    if (event.level === 'error' || event.level === 'critical') console.error(line)
    else if (event.level === 'warning') console.warn(line)
    else console.log(line)
  }
}

export class PersistentJsonLogger implements StructuredLogger {
  #fileEnabled = true

  public constructor(
    private readonly filePath: string,
    private readonly maxBytes = 5 * 1024 * 1024,
    private readonly retainedFiles = 3
  ) {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      this.#rotateIfNeeded()
    } catch (error) {
      this.#fileEnabled = false
      console.error(`ChromaShift could not initialize its diagnostic log: ${String(error)}`)
    }
  }

  public write(event: StructuredLogEvent): void {
    const line = serializeEvent(event)
    if (event.level === 'error' || event.level === 'critical') console.error(line)
    else if (event.level === 'warning') console.warn(line)
    else console.log(line)

    if (!this.#fileEnabled) return
    try {
      appendFileSync(this.filePath, `${line}\n`, 'utf8')
    } catch (error) {
      this.#fileEnabled = false
      console.error(`ChromaShift could not write its diagnostic log: ${String(error)}`)
    }
  }

  #rotateIfNeeded(): void {
    if (!existsSync(this.filePath) || statSync(this.filePath).size < this.maxBytes) return
    const oldest = `${this.filePath}.${this.retainedFiles}`
    if (existsSync(oldest)) rmSync(oldest)
    for (let index = this.retainedFiles - 1; index >= 1; index -= 1) {
      const source = `${this.filePath}.${index}`
      if (existsSync(source)) renameSync(source, `${this.filePath}.${index + 1}`)
    }
    renameSync(this.filePath, `${this.filePath}.1`)
  }
}

export function readDiagnosticLog(
  filePath: string,
  limit = 250,
  maxReadBytes = 512 * 1024
): DiagnosticLogEntry[] {
  if (!existsSync(filePath)) return []

  let descriptor: number | undefined
  try {
    const fileSize = statSync(filePath).size
    const length = Math.min(fileSize, maxReadBytes)
    const start = fileSize - length
    const buffer = Buffer.alloc(length)
    descriptor = openSync(filePath, 'r')
    const bytesRead = readSync(descriptor, buffer, 0, length, start)
    let text = buffer.subarray(0, bytesRead).toString('utf8')
    if (start > 0) {
      const firstCompleteLine = text.indexOf('\n')
      text = firstCompleteLine < 0 ? '' : text.slice(firstCompleteLine + 1)
    }

    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 250)
    return text
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .slice(-safeLimit)
      .reverse()
      .flatMap(parseDiagnosticLine)
  } catch {
    return []
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function parseDiagnosticLine(line: string): DiagnosticLogEntry[] {
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null) return []
    const event = value as Record<string, unknown>
    if (
      typeof event['timestamp'] !== 'string' ||
      typeof event['eventName'] !== 'string' ||
      !isLogLevel(event['level'])
    ) {
      return []
    }
    const details = { ...event }
    delete details['timestamp']
    delete details['level']
    delete details['eventName']
    const serializedDetails = Object.keys(details).length === 0 ? '' : JSON.stringify(details)
    return [
      {
        timestamp: event['timestamp'],
        level: event['level'],
        eventName: event['eventName'].slice(0, 200),
        details:
          serializedDetails.length <= 20_000
            ? serializedDetails
            : `${serializedDetails.slice(0, 19_999)}…`
      }
    ]
  } catch {
    return []
  }
}

function isLogLevel(value: unknown): value is LogLevel {
  return ['information', 'warning', 'error', 'critical'].includes(String(value))
}

function serializeEvent(event: StructuredLogEvent): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), ...event })
}

export function describeError(error: unknown): {
  message: string
  code?: string
} {
  if (typeof error === 'object' && error !== null) {
    const message =
      'message' in error && typeof error.message === 'string' ? error.message : String(error)
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return code === undefined ? { message } : { message, code }
  }
  return { message: String(error) }
}
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { dirname } from 'node:path'
