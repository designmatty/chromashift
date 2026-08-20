export type LogLevel = 'information' | 'warning' | 'error' | 'critical'

export interface StructuredLogEvent {
  level: LogLevel
  eventName: string
  [key: string]: unknown
}

export interface StructuredLogger {
  write(event: StructuredLogEvent): void
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
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
