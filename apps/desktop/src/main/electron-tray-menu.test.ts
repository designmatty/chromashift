import { describe, expect, it, vi } from 'vitest'
import { createAutomaticMenuItem } from './electron-tray-menu.js'
import type { TrayCommands, TrayReadModel } from './tray-controller.js'

const commands = {
  openAppPanel: vi.fn(),
  openMiniPanel: vi.fn(),
  exit: vi.fn(),
  enableAutomatic: vi.fn(),
  selectProfile: vi.fn(),
  resetBaseline: vi.fn(),
  controlChromaShift: vi.fn()
} satisfies TrayCommands

const manualModel = {
  chromaShiftStatusLabel: 'Active',
  currentProfileLabel: 'Gaming',
  automaticEnabled: true,
  automaticChecked: false,
  controlsEnabled: true,
  restoreEnabled: true,
  controlAction: 'pause',
  profiles: []
} satisfies TrayReadModel

describe('Electron tray menu', () => {
  it('uses a native item type that can display Automatic as unchecked', () => {
    expect(createAutomaticMenuItem(manualModel, commands)).toMatchObject({
      label: 'Automatic',
      type: 'checkbox',
      checked: false
    })
  })
})
