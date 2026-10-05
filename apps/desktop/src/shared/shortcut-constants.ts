export const EMERGENCY_RESTORE_ACCELERATOR = 'CommandOrControl+Alt+Super+R'

/** Windows labels for Electron's accelerator aliases, including persisted bindings. */
export function formatShortcutAccelerator(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl|CmdOrCtrl|Control/gi, 'Ctrl')
    .replace(/Super|Meta/gi, 'Win')
}
