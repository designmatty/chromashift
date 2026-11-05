/** Find the first free numbered suggestion without imposing name uniqueness. */
export function nextProfileName(base: string, names: readonly string[]): string {
  const used = new Set(names.map((name) => name.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  const stem = base.replace(/ \d+$/, '')
  for (let number = 2; ; number += 1) {
    const candidate = `${stem.slice(0, 100 - String(number).length - 1)} ${number}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}
