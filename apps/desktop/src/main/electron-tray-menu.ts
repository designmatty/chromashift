import {
  Menu,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage,
  type Rectangle
} from 'electron'
import type { TrayCommands, TrayMenuPort, TrayReadModel } from './tray-controller.js'

export class ElectronTrayMenu implements TrayMenuPort {
  readonly #tray: Tray

  public constructor(icon: NativeImage, reopenLastPanel: (bounds: Rectangle) => void) {
    if (icon.isEmpty()) throw new Error('Tray icon could not be loaded.')
    this.#tray = new Tray(icon.resize({ width: 16, height: 16 }))
    this.#tray.setToolTip('ChromaShift')
    this.#tray.on('click', (_event, bounds) => reopenLastPanel(bounds))
  }

  public update(model: TrayReadModel, commands: TrayCommands): void {
    const profileItems: MenuItemConstructorOptions[] =
      model.profiles.length === 0
        ? [{ label: 'No profiles configured', enabled: false }]
        : model.profiles.map((profile) => ({
            label: profile.name,
            type: 'radio',
            enabled: profile.enabled,
            checked: profile.checked,
            click: () => commands.selectProfile(profile.id)
          }))

    this.#tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Current: ${model.currentProfileLabel}`, enabled: false },
        { type: 'separator' },
        {
          label: 'Automatic',
          type: 'radio',
          enabled: model.automaticEnabled,
          checked: model.automaticChecked,
          click: commands.enableAutomatic
        },
        { label: 'Profiles', submenu: profileItems },
        { type: 'separator' },
        {
          label: 'Restore original display settings',
          enabled: model.controlsEnabled,
          click: commands.resetBaseline
        },
        { type: 'separator' },
        { label: 'Open ChromaShift', click: commands.open },
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
