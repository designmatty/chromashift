import type { ForegroundApplication } from '@chromashift/native-client'
import { describe, expect, it } from 'vitest'
import { isShellSurface } from '@main/shell-surface.js'

const systemRoot = 'D:\\Windows'
const hosts = [
  'SystemApps\\ShellExperienceHost_cw5n1h2txyewy\\ShellExperienceHost.exe',
  'SystemApps\\Microsoft.Windows.StartMenuExperienceHost_cw5n1h2txyewy\\StartMenuExperienceHost.exe',
  'SystemApps\\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\\SearchHost.exe',
  'System32\\ShellHost.exe'
]
const classes = [
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland'
]
function application(path: string | null, windowClass?: string | null): ForegroundApplication {
  return {
    pid: 42,
    path,
    executable: path?.split('\\').at(-1) ?? null,
    title: '',
    monitorDeviceName: null,
    windowClass
  }
}

describe('isShellSurface', () => {
  it.each(hosts)('ignores the Windows host %s without relying on title or class', (host) => {
    expect(isShellSurface(application(`${systemRoot}\\${host}`), systemRoot)).toBe(true)
    expect(
      isShellSurface(
        application(`${systemRoot}\\${host}`.toUpperCase().replaceAll('\\', '/')),
        systemRoot
      )
    ).toBe(true)
  })
  it.each(classes)('ignores Windows Explorer shell class %s', (windowClass) => {
    expect(
      isShellSurface(application(`${systemRoot}\\explorer.exe`, windowClass), systemRoot)
    ).toBe(true)
  })
  it.each(['CabinetWClass', 'Progman', 'WorkerW', 'Unknown', '', null, undefined])(
    'keeps Explorer matchable with class %s',
    (windowClass) => {
      expect(
        isShellSurface(application(`${systemRoot}\\explorer.exe`, windowClass), systemRoot)
      ).toBe(false)
    }
  )
  it.each([...hosts, 'explorer.exe'])(
    'does not ignore a same-named program outside Windows: %s',
    (host) => {
      for (const path of [
        `E:\\Apps\\${host.split('\\').at(-1)}`,
        `D:\\Windows-copy\\${host}`,
        `C:\\Windows\\${host}`
      ])
        expect(isShellSurface(application(path, 'Shell_TrayWnd'), systemRoot)).toBe(false)
    }
  )
  it('requires a full known system path and a resolved SystemRoot', () => {
    expect(isShellSurface(application(null, 'Shell_TrayWnd'), systemRoot)).toBe(false)
    expect(isShellSurface(application('explorer.exe', 'Shell_TrayWnd'), systemRoot)).toBe(false)
    expect(
      isShellSurface(application(`${systemRoot}\\explorer.exe`, 'Shell_TrayWnd'), undefined)
    ).toBe(false)
    expect(isShellSurface(application(`${systemRoot}\\explorer.exe`, 'Shell_TrayWnd'), '')).toBe(
      false
    )
  })
})
