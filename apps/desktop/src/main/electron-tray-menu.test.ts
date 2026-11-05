import { describe, expect, it, vi } from 'vitest'
import {
  createAutomaticMenuItem,
  TRAY_MENU_NAME_MAX_LENGTH,
  trayMenuLabel
} from '@main/electron-tray-menu.js'
import type { TrayCommands, TrayReadModel } from '@main/tray-controller.js'

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

describe('tray menu labels', () => {
  it('keeps names up to the limit unchanged', () => {
    const name = 'a'.repeat(TRAY_MENU_NAME_MAX_LENGTH)
    expect(trayMenuLabel(name)).toBe(name)
    expect(trayMenuLabel('Gaming')).toBe('Gaming')
  })

  it('shortens long names to the limit with an ellipsis', () => {
    const label = trayMenuLabel('a'.repeat(TRAY_MENU_NAME_MAX_LENGTH + 10))
    expect(label).toBe(`${'a'.repeat(TRAY_MENU_NAME_MAX_LENGTH - 1)}…`)
    expect(Array.from(label)).toHaveLength(TRAY_MENU_NAME_MAX_LENGTH)
  })

  it('does not leave a space before the ellipsis', () => {
    expect(trayMenuLabel('abcd efgh', 6)).toBe('abcd…')
  })

  it('never splits an emoji or combined character', () => {
    expect(trayMenuLabel('👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦', 2)).toBe('👨‍👩‍👧‍👦…')
    expect(trayMenuLabel('éééé', 3)).toBe('éé…')
  })

  it('escapes ampersands so Windows shows them instead of a mnemonic', () => {
    expect(trayMenuLabel('Tom & Jerry')).toBe('Tom && Jerry')
  })
})

describe('Electron tray menu', () => {
  it('uses a native item type that can display Automatic as unchecked', () => {
    expect(createAutomaticMenuItem(manualModel, commands)).toMatchObject({
      label: 'Automatic',
      type: 'checkbox',
      checked: false
    })
  })
})
