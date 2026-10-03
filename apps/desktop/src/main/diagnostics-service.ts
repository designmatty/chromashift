import type { DiagnosticLogEntry, ProfileReorderDiagnostic } from '@shared/product-api.js'
import { describeError, type StructuredLogger } from '@main/structured-logger.js'

interface DiagnosticsPorts {
  read(): DiagnosticLogEntry[]
  copy(text: string): void
  download(text: string): Promise<boolean>
  clear(): void
  context(): Record<string, unknown>
  logger: StructuredLogger
}

const reorderEvents = {
  started: 'ProfileReorderStarted',
  positionChanged: 'ProfileReorderPositionChanged',
  dropped: 'ProfileReorderDropped',
  cancelled: 'ProfileReorderCancelled',
  clickSuppressed: 'ProfileReorderClickSuppressed'
} as const

export class DiagnosticsService {
  public constructor(private readonly ports: DiagnosticsPorts) {}

  public copy(): void {
    this.ports.copy(formatDiagnosticLog(this.ports.read()))
  }

  public download(): Promise<boolean> {
    return this.ports.download(formatDiagnosticLog(this.ports.read()))
  }

  public clear(): void {
    this.ports.clear()
  }

  public recordReorder(event: ProfileReorderDiagnostic): void {
    this.ports.logger.write({
      ...event,
      level: 'information',
      eventName: reorderEvents[event.phase],
      productContext: this.ports.context()
    })
  }

  public async persistReorder(
    profileIds: string[],
    interactionId: string | undefined,
    persist: () => Promise<void>
  ): Promise<void> {
    const details = { profileIds, interactionId }
    this.log('ProfileReorderRequested', details)
    try {
      await persist()
      this.log('ProfileReorderSaved', details)
    } catch (error) {
      this.log('ProfileReorderFailed', { ...details, ...describeError(error) }, 'warning')
      throw error
    }
  }

  public async profileAction<T>(
    name: 'ProfilePreview' | 'ProfilePreviewCancel' | 'ProfileActivation',
    details: Record<string, unknown>,
    action: () => Promise<T>
  ): Promise<T> {
    this.log(`${name}Requested`, details)
    try {
      const result = await action()
      this.log(`${name}Completed`, details)
      return result
    } catch (error) {
      this.log(`${name}Failed`, { ...details, ...describeError(error) }, 'warning')
      throw error
    }
  }

  private log(
    eventName: string,
    details: Record<string, unknown>,
    level: 'information' | 'warning' = 'information'
  ): void {
    this.ports.logger.write({ level, eventName, ...details, productContext: this.ports.context() })
  }
}

// The validated tail is newest first in the UI; shared logs are chronological
// JSON Lines with the original fields, so they can be pasted into a bug report.
export function formatDiagnosticLog(entries: readonly DiagnosticLogEntry[]): string {
  return entries
    .slice()
    .reverse()
    .map(({ timestamp, level, eventName, details }) => {
      let fields: Record<string, unknown> = {}
      if (details) {
        try {
          const value: unknown = JSON.parse(details)
          fields =
            typeof value === 'object' && value !== null && !Array.isArray(value)
              ? (value as Record<string, unknown>)
              : { details }
        } catch {
          fields = { details }
        }
      }
      return JSON.stringify({ ...fields, timestamp, level, eventName }) + '\n'
    })
    .join('')
}
