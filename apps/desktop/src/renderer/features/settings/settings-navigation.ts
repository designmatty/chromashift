export const escapeOwnerSelector =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="menu"], [role="dialog"], [role="alertdialog"]'

export function settingsEscapeGoesBack(
  event: Pick<
    KeyboardEvent,
    'key' | 'defaultPrevented' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'
  >,
  focusHandlesEscape: boolean,
  overlayOpen: boolean
): boolean {
  return (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !focusHandlesEscape &&
    !overlayOpen
  )
}
