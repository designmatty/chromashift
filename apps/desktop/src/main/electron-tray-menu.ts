import {
  Menu,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage,
  type Rectangle
} from 'electron'
import type { TrayCommands, TrayMenuPort, TrayReadModel } from '@main/tray-controller.js'

/** Longest profile-name length, in user-visible characters, shown in the native tray menu. */
export const TRAY_MENU_NAME_MAX_LENGTH = 30

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Formats user text for a native Windows menu label. Native menus cannot
 * ellipsize, so long names are shortened here without splitting a character.
 * A single & would become a mnemonic underline, so it is escaped as &&.
 */
export function trayMenuLabel(text: string, maxLength = TRAY_MENU_NAME_MAX_LENGTH): string {
  const characters = Array.from(graphemes.segment(text), (part) => part.segment)
  const shortened =
    characters.length <= maxLength
      ? text
      : `${characters.slice(0, maxLength - 1).join('').trimEnd()}…`
  return shortened.replaceAll('&', '&&')
}

export function createAutomaticMenuItem(
  model: TrayReadModel,
  commands: TrayCommands
): MenuItemConstructorOptions {
  return {
    label: 'Automatic',
    // Automatic has no adjacent radio peer because profile choices live in a
    // submenu. Electron forces a standalone radio item checked, so use the
    // native checkable item that can accurately represent both states.
    type: 'checkbox',
    enabled: model.automaticEnabled,
    checked: model.automaticChecked,
    click: commands.enableAutomatic
  }
}

export class ElectronTrayMenu implements TrayMenuPort {
  readonly #tray: Tray

  public constructor(icon: NativeImage, reopenLastPanel: (bounds: Rectangle) => void) {
    if (icon.isEmpty()) throw new Error('Tray icon could not be loaded.')
    this.#tray = new Tray(icon.resize({ width: 16, height: 16 }))
    this.#tray.setToolTip('ChromaShift')
    this.#tray.on('click', (_event, bounds) => reopenLastPanel(bounds))
  }

  public update(model: TrayReadModel, commands: TrayCommands): void {
    this.#tray.setToolTip(`ChromaShift: ${model.chromaShiftStatusLabel}`)
    const profileItems: MenuItemConstructorOptions[] =
      model.profiles.length === 0
        ? [{ label: 'No profiles configured', enabled: false }]
        : model.profiles.map((profile) => ({
            label: trayMenuLabel(profile.name),
            type: 'radio',
            enabled: profile.enabled,
            checked: profile.checked,
            click: () => commands.selectProfile(profile.id)
          }))

    this.#tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `ChromaShift: ${model.chromaShiftStatusLabel}`, enabled: false },
        { label: `Current: ${trayMenuLabel(model.currentProfileLabel)}`, enabled: false },
        createAutomaticMenuItem(model, commands),
        { label: 'Profiles', submenu: profileItems },
        { type: 'separator' },
        {
          label: 'Restore original settings',
          enabled: model.restoreEnabled,
          click: commands.resetBaseline
        },
        {
          label:
            model.controlAction === 'retry'
              ? 'Retry safety check'
              : model.controlAction === 'resume'
                ? 'Resume ChromaShift'
                : 'Pause ChromaShift',
          enabled: model.controlsEnabled,
          click: commands.controlChromaShift
        },
        { type: 'separator' },
        { label: 'Open app panel', click: commands.openAppPanel },
        { label: 'Open mini panel', click: commands.openMiniPanel },
        { type: 'separator' },
        { label: 'Exit', click: commands.exit }
      ])
    )
  }

  public showError(title: string, message: string): void {
    this.#tray.displayBalloon({ title, content: message, iconType: 'error' })
  }

  public destroy(): void {
    this.#tray.destroy()
  }
}
