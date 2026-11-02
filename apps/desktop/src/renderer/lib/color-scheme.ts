export type ResolvedColorScheme = 'dark' | 'light'

/**
 * Reads the color scheme Electron main resolved from the theme preference and
 * passed in the window URL, so loading screens match before product state loads.
 */
export function initialColorScheme(search: string): ResolvedColorScheme | null {
  const theme = new URLSearchParams(search).get('theme')
  return theme === 'dark' || theme === 'light' ? theme : null
}

export function applyColorScheme(root: HTMLElement, scheme: ResolvedColorScheme): void {
  root.classList.toggle('dark', scheme === 'dark')
  root.classList.toggle('light', scheme === 'light')
  root.style.colorScheme = scheme
}
