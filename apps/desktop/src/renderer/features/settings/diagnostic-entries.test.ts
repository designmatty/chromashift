import { expect, it } from 'vitest'
import type { DiagnosticLogEntry } from '@shared/product-api'
import {
  filterDiagnosticEntries,
  prettyDiagnosticDetails
} from '@/features/settings/diagnostic-entries'

const entries: DiagnosticLogEntry[] = [
  {
    timestamp: '2026-11-10T10:00:00Z',
    level: 'information',
    eventName: 'ProfileApplied',
    details: '{"profile":"Night"}'
  },
  {
    timestamp: '2026-11-10T11:00:00Z',
    level: 'warning',
    eventName: 'ProfileDeferred',
    details: '{"display":"Night display"}'
  },
  {
    timestamp: '2026-11-10T12:00:00Z',
    level: 'error',
    eventName: 'ApplyFailed',
    details: 'Windows error'
  }
]

it('combines exact level selection with case-insensitive search across the bounded tail', () => {
  expect(filterDiagnosticEntries(entries, 'all', '  NIGHT  ')).toEqual(entries.slice(0, 2))
  expect(filterDiagnosticEntries(entries, 'warning', 'night')).toEqual([entries[1]])
  expect(filterDiagnosticEntries(entries, 'information', 'info')).toEqual([entries[0]])
  expect(filterDiagnosticEntries(entries, 'all', '12:00')).toEqual([entries[2]])
  expect(filterDiagnosticEntries(entries, 'error', 'ProfileApplied')).toEqual([])
  expect(filterDiagnosticEntries(entries, 'all', '')).toEqual(entries)
  expect(entries).toHaveLength(3)
})

it('pretty prints structured details and preserves non-JSON diagnostics', () => {
  expect(prettyDiagnosticDetails('{"nested":{"value":1}}')).toBe(
    '{\n  "nested": {\n    "value": 1\n  }\n}'
  )
  expect(prettyDiagnosticDetails('truncated {')).toBe('truncated {')
})
