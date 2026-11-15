// Shell-surface focus keeps the current profile across events and snapshots.
import {
  JsonProfileRepository,
  createNeutralColorSettings,
  type ColorProfile,
  type ProfileConfigurationStorage
} from '@chromashift/core'
import type { NativeEvent } from '@chromashift/native-client'
import { describe, expect, it } from 'vitest'
import { ActivationCoordinator } from '@main/activation-coordinator.js'
import { AutomaticActivationController } from '@main/automatic-activation-controller.js'
import { isShellSurface } from '@main/shell-surface.js'
import { FakeNativeDisplayPort } from '@main/testing/fake-native-display.js'
import type { StructuredLogEvent, StructuredLogger } from '@main/structured-logger.js'

class MemoryStorage implements ProfileConfigurationStorage {
  public constructor(private contents: string | null) {}
  public async read(): Promise<string | null> {
    return this.contents
  }
  public async write(contents: string): Promise<void> {
    this.contents = contents
  }
}
class RecordingLogger implements StructuredLogger {
  public readonly events: StructuredLogEvent[] = []
  public write(event: StructuredLogEvent): void {
    this.events.push(event)
  }
}
function profile(id: string, saturation: number, executableName?: string): ColorProfile {
  return {
    id,
    name: id,
    enabled: true,
    applications: executableName === undefined ? [] : [{ executableName }],
    displays: [
      { displayId: 'display:one', color: { ...createNeutralColorSettings(), saturation } }
    ]
  }
}
const repo = (): JsonProfileRepository =>
  new JsonProfileRepository(
    new MemoryStorage(
      JSON.stringify({
        schemaVersion: 2,
        profiles: [profile('default', 50), profile('game-a', 75, 'GameA.exe')],
        settings: { defaultProfileId: 'default' }
      })
    )
  )
const systemRoot = 'C:\\WINDOWS'
const shellApp = {
  pid: 7,
  executable: 'explorer.exe',
  // Casing as reported on the reviewer's 25H2 machine.
  path: 'C:\\WINDOWS\\Explorer.EXE',
  title: '',
  monitorDeviceName: null,
  windowClass: 'Shell_TrayWnd'
}
const game: NativeEvent = {
  event: 'foregroundApplicationChanged',
  data: {
    application: {
      pid: 42,
      executable: 'GameA.exe',
      path: null,
      title: 'GameA',
      monitorDeviceName: null
    }
  }
}
function controller(): { automatic: AutomaticActivationController; logger: RecordingLogger } {
  const repository = repo()
  const logger = new RecordingLogger()
  const automatic = new AutomaticActivationController(
    repository,
    new ActivationCoordinator(repository, new FakeNativeDisplayPort(), logger),
    logger,
    (application) => (isShellSurface(application, systemRoot) ? 'windowsShellSurface' : false)
  )
  return { automatic, logger }
}

// Regressions from re-review rereview-95-3: snapshot reads (resume, startup and
// native recovery) apply the same shell-surface policy as foreground events.
describe('shell-surface activation', () => {
  it('matches the Explorer path casing Windows reports', () => {
    expect(isShellSurface(shellApp, systemRoot)).toBe(true)
  })

  it('keeps the app profile when resuming with the taskbar in the foreground', async () => {
    const { automatic } = controller()
    await automatic.start(null)
    await automatic.handleNativeEvent(game)
    expect(automatic.state.currentTarget).toEqual({ kind: 'profile', profileId: 'game-a' })
    await automatic.handleNativeEvent({
      event: 'foregroundApplicationChanged',
      data: { application: shellApp }
    })
    expect(automatic.state.currentTarget).toEqual({ kind: 'profile', profileId: 'game-a' })
    await automatic.resumeCurrent(shellApp)
    expect(automatic.state.currentTarget).toEqual({ kind: 'profile', profileId: 'game-a' })
  })

  it('starts with no foreground app when the taskbar is in the foreground', async () => {
    const { automatic, logger } = controller()
    const outcome = await automatic.start(shellApp)
    expect(outcome?.resolution?.reason).toBe('defaultProfile')
    const matched = logger.events.filter((event) => event.eventName === 'ProfileMatched')
    expect(matched.length).toBeGreaterThan(0)
    expect(matched.every((event) => event.executable === undefined)).toBe(true)
  })
})
