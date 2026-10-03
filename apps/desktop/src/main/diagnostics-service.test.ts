import { describe, expect, it, vi } from 'vitest'
import { DiagnosticsService, formatDiagnosticLog } from '@main/diagnostics-service.js'
import type { DiagnosticLogEntry, ProfileReorderDiagnostic } from '@shared/product-api.js'
import type { StructuredLogEvent } from '@main/structured-logger.js'

const interactionId = 'aef45b59-728e-4ce8-b411-68d08f32305d'
const event: ProfileReorderDiagnostic = {
  phase: 'started',
  interactionId,
  clientTimestamp: '2026-10-02T01:08:01.560Z',
  profileId: 'gaming',
  input: 'pointer',
  fromIndex: 1,
  toIndex: 1,
  selectedProfileId: 'default',
  previewingProfileId: null
}
const entry: DiagnosticLogEntry = {
  timestamp: event.clientTimestamp,
  level: 'information',
  eventName: 'ProfileReorderStarted',
  details: JSON.stringify({
    interactionId,
    profileId: 'gaming',
    title: '游戏',
    path: 'C:\\Games\\game.exe'
  })
}

function harness() {
  const events: StructuredLogEvent[] = []
  const read = vi.fn(() => [entry])
  const copy = vi.fn()
  const download = vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true)
  let context = { activeProfileId: 'default', previewingProfileId: null as string | null }
  const service = new DiagnosticsService({
    read,
    copy,
    download,
    clear: vi.fn(),
    context: () => ({ ...context }),
    logger: { write: (value) => events.push(value) }
  })
  return {
    service,
    events,
    read,
    copy,
    download,
    setContext: (value: typeof context) => {
      context = value
    }
  }
}

describe('diagnostic sharing', () => {
  it('exports chronological JSON Lines with original structured details and without mutating the tail', () => {
    const newest = {
      ...entry,
      timestamp: '2026-10-02T01:08:02.000Z',
      eventName: 'ProfileReorderSaved'
    }
    const tail = [newest, entry]
    const lines = formatDiagnosticLog(tail)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(lines.map((line) => line.eventName)).toEqual([
      'ProfileReorderStarted',
      'ProfileReorderSaved'
    ])
    expect(lines[0]).toEqual({
      timestamp: entry.timestamp,
      level: entry.level,
      eventName: entry.eventName,
      interactionId,
      profileId: 'gaming',
      title: '游戏',
      path: 'C:\\Games\\game.exe'
    })
    expect(tail).toEqual([newest, entry])
  })

  it('preserves truncated detail text as a field while keeping every line valid JSON', () => {
    const details = '{"truncated":'
    expect(JSON.parse(formatDiagnosticLog([{ ...entry, details }]))).toMatchObject({ details })
    expect(formatDiagnosticLog([])).toBe('')
  })

  it('reads a fresh snapshot for each sharing action and preserves save cancellation', async () => {
    const h = harness()
    h.service.copy()
    expect(h.copy).toHaveBeenCalledWith(formatDiagnosticLog([entry]))
    const saved = { ...entry, eventName: 'ProfileReorderSaved' }
    h.read.mockReturnValue([saved, entry])
    h.download.mockResolvedValue(false)
    await expect(h.service.download()).resolves.toBe(false)
    expect(h.download).toHaveBeenCalledWith(formatDiagnosticLog([saved, entry]))
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('propagates sharing failures for the normal product error surface', async () => {
    const h = harness()
    h.copy.mockImplementation(() => {
      throw new Error('Clipboard unavailable')
    })
    expect(() => h.service.copy()).toThrow('Clipboard unavailable')
    h.download.mockRejectedValue(new Error('Could not save the logs.'))
    await expect(h.service.download()).rejects.toThrow('Could not save the logs.')
  })
})

describe('profile interaction diagnostics', () => {
  it('correlates drag, preview requests and persistence with context at each transition', async () => {
    const h = harness()
    h.service.recordReorder(event)
    await h.service.persistReorder(['default', 'work', 'gaming'], interactionId, async () => {
      await h.service.profileAction(
        'ProfilePreview',
        { profileId: 'gaming', kind: 'preview' },
        async () => {
          h.setContext({ activeProfileId: 'default', previewingProfileId: 'gaming' })
        }
      )
    })
    expect(h.events.map((value) => value.eventName)).toEqual([
      'ProfileReorderStarted',
      'ProfileReorderRequested',
      'ProfilePreviewRequested',
      'ProfilePreviewCompleted',
      'ProfileReorderSaved'
    ])
    expect(h.events[0]).toMatchObject({
      interactionId,
      productContext: { previewingProfileId: null }
    })
    expect(h.events.at(-1)).toMatchObject({
      interactionId,
      productContext: { previewingProfileId: 'gaming' }
    })
  })

  it('records a failed persistence attempt without reporting success or swallowing the failure', async () => {
    const h = harness()
    const error = new Error('Disk full')
    await expect(
      h.service.persistReorder(['default', 'gaming'], interactionId, async () => {
        throw error
      })
    ).rejects.toBe(error)
    expect(h.events.map((value) => value.eventName)).toEqual([
      'ProfileReorderRequested',
      'ProfileReorderFailed'
    ])
    expect(h.events[1]).toMatchObject({ level: 'warning', interactionId })
  })
})
