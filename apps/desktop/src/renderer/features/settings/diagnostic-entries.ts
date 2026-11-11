import type { DiagnosticLogEntry } from '@shared/product-api.js'

export type DiagnosticLevelFilter = DiagnosticLogEntry['level'] | 'all'

/** Filters only the validated, bounded tail already supplied by main. */
export function filterDiagnosticEntries(
  entries: readonly DiagnosticLogEntry[],
  level: DiagnosticLevelFilter,
  search: string
): DiagnosticLogEntry[] {
  const query = search.trim().toLowerCase()
  return entries.filter(
    (entry) =>
      (level === 'all' || entry.level === level) &&
      `${entry.timestamp} ${entry.level === 'information' ? 'info' : entry.level} ${entry.eventName} ${entry.details}`
        .toLowerCase()
        .includes(query)
  )
}

export function prettyDiagnosticDetails(details: string): string {
  try {
    return JSON.stringify(JSON.parse(details), null, 2)
  } catch {
    return details
  }
}
