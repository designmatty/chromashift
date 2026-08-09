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
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event })
    if (event.level === 'error' || event.level === 'critical') console.error(line)
    else if (event.level === 'warning') console.warn(line)
    else console.log(line)
  }
}

export function describeError(error: unknown): {
  message: string
  code?: string
} {
  if (typeof error === 'object' && error !== null) {
    const message = 'message' in error && typeof error.message === 'string'
      ? error.message
      : String(error)
    const code = 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
    return code === undefined ? { message } : { message, code }
  }
  return { message: String(error) }
}
