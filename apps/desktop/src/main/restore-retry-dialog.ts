import type { BrowserWindow, Dialog, MessageBoxOptions } from 'electron'

/** The close path is window-modal; shutdown keeps its existing running-app wording. */
export async function confirmRestoreRetry(
  dialog: Pick<Dialog, 'showMessageBox'>,
  title: string,
  message: string,
  window?: BrowserWindow
): Promise<'retry' | 'cancel'> {
  const options: MessageBoxOptions = {
    type: 'warning',
    title,
    message,
    buttons: [
      'Try again',
      window === undefined ? 'Keep ChromaShift running' : 'Keep the window open'
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  }
  const result =
    window === undefined
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options)
  return result.response === 0 ? 'retry' : 'cancel'
}
