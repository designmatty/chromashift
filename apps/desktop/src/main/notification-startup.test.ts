import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivationArguments } from 'electron'
import {
  handleSecondInstanceLaunch,
  notificationActivationArguments,
  NotificationActivationController,
  startAfterNotificationActivation
} from '@main/notification-activation.js'

// Regression from rereview-95-2-proof.test.ts, inverted to the required behavior.
// Exercise the same startup sequence used by index.ts instead of modeling it.
const target = { id: '4c692b42-0cc0-49b9-8f37-c59e7056ac4c', profileId: 'gaming' }
const close: ActivationArguments = {
  type: 'action',
  actionIndex: 0,
  arguments: notificationActivationArguments(target, 'close')
}
const body: ActivationArguments = {
  type: 'action',
  actionIndex: 1,
  arguments: notificationActivationArguments(target, 'body')
}

function shell(notificationLaunch = true) {
  const events: string[] = []
  const write = vi.fn()
  let finishStart!: () => void
  const runtimeStarted = new Promise<void>((resolve) => {
    finishStart = resolve
  })
  const controller = new NotificationActivationController(
    (profileId) => events.push(profileId === null ? 'openWindow' : `openProfile:${profileId}`),
    () => events.push('dismiss'),
    notificationLaunch
  )
  const whenReady = (): Promise<void> =>
    startAfterNotificationActivation({
      initialize: () => {
        events.push('initialize')
      },
      wait: () => controller.waitForStartup(),
      quit: () => {
        events.push('quit')
      },
      loadAndStart: async () => {
        events.push('cleanupDevelopmentShortcut', 'settings.load', 'runtime.start')
        await runtimeStarted
      },
      ready: () => {
        events.push('ready')
        controller.ready()
      },
      shouldOpenWindow: () => !notificationLaunch,
      openWindow: () => {
        events.push('openWindow')
      },
      logger: { write }
    })
  const secondInstance = (argv: string[] = ['ChromaShift.exe']): void =>
    handleSecondInstanceLaunch('win32', argv, () =>
      controller.requestLaunch(() => {
        events.push('relaunch')
      })
    )
  return { controller, whenReady, secondInstance, events, finishStart, write }
}

describe('normal launches during cold notification startup', () => {
  afterEach(() => vi.useRealTimers())

  it('starts the runtime before opening, and a pending Close only dismisses its toast', async () => {
    const { controller, whenReady, secondInstance, events, finishStart, write } = shell()
    const startup = whenReady()
    expect(events).toEqual(['initialize'])
    secondInstance()
    controller.handle(close)
    expect(events).toEqual(['initialize', 'dismiss'])
    await Promise.resolve()
    expect(events).toEqual([
      'initialize',
      'dismiss',
      'cleanupDevelopmentShortcut',
      'settings.load',
      'runtime.start'
    ])
    finishStart()
    await startup
    expect(events).toEqual([
      'initialize',
      'dismiss',
      'cleanupDevelopmentShortcut',
      'settings.load',
      'runtime.start',
      'ready',
      'openWindow'
    ])
    expect(write).not.toHaveBeenCalled()
  })

  it('starts before opening and clears the timeout when a normal launch wins', async () => {
    vi.useFakeTimers()
    const { whenReady, secondInstance, events, finishStart } = shell()
    const startup = whenReady()
    secondInstance()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(events).toEqual([
      'initialize',
      'cleanupDevelopmentShortcut',
      'settings.load',
      'runtime.start'
    ])
    finishStart()
    await startup
    expect(events).toEqual([
      'initialize',
      'cleanupDevelopmentShortcut',
      'settings.load',
      'runtime.start',
      'ready',
      'openWindow'
    ])
  })

  it('queues an explicit launch received before whenReady', async () => {
    const { whenReady, secondInstance, events, finishStart } = shell()
    secondInstance()
    expect(events).toEqual([])
    const startup = whenReady()
    finishStart()
    await startup
    expect(events).toEqual([
      'initialize',
      'cleanupDevelopmentShortcut',
      'settings.load',
      'runtime.start',
      'ready',
      'openWindow'
    ])
  })

  it.each(['close', 'timeout'] as const)(
    'relaunches once before quitting if an explicit launch arrives after %s settles',
    async (reason) => {
      vi.useFakeTimers()
      const { controller, whenReady, secondInstance, events, write } = shell()
      const startup = whenReady()
      if (reason === 'close') controller.handle(close)
      // Synchronous timer advancement holds the startup promise continuation,
      // reproducing the gap between a quit decision and the shell's quit call.
      else vi.advanceTimersByTime(3_000)
      secondInstance()
      secondInstance()
      await startup
      expect(events).toEqual(
        reason === 'close'
          ? ['initialize', 'dismiss', 'relaunch', 'quit']
          : ['initialize', 'relaunch', 'quit']
      )
      expect(write).toHaveBeenCalledExactlyOnceWith({
        level: 'information',
        eventName: 'NotificationLaunchQuit',
        reason
      })
      controller.ready()
      expect(events.at(-1)).toBe('quit')
    }
  )

  it('keeps COM second instances waiting without settings, runtime, or cleanup', async () => {
    vi.useFakeTimers()
    const { whenReady, secondInstance, events, write } = shell()
    const startup = whenReady()
    secondInstance(['ChromaShift.exe', '-Embedding'])
    await vi.advanceTimersByTimeAsync(2_999)
    expect(events).toEqual(['initialize'])
    await vi.advanceTimersByTimeAsync(1)
    await startup
    expect(events).toEqual(['initialize', 'quit'])
    expect(write).toHaveBeenCalledExactlyOnceWith({
      level: 'information',
      eventName: 'NotificationLaunchQuit',
      reason: 'timeout'
    })
  })

  it('opens a body profile only after loadAndStart resolves and ready runs', async () => {
    const { controller, whenReady, events, finishStart } = shell()
    const startup = whenReady()
    expect(events).toEqual(['initialize'])
    controller.handle(body)
    await Promise.resolve()
    expect(events).toEqual([
      'initialize',
      'dismiss',
      'cleanupDevelopmentShortcut',
      'settings.load',
      'runtime.start'
    ])
    finishStart()
    await startup
    expect(events).toEqual([
      'initialize',
      'dismiss',
      'cleanupDevelopmentShortcut',
      'settings.load',
      'runtime.start',
      'ready',
      'openProfile:gaming'
    ])
  })

  it('opens the ordinary startup window after readiness and handles warm explicit launches', async () => {
    const { whenReady, secondInstance, events, finishStart } = shell(false)
    const startup = whenReady()
    expect(events).toEqual(['initialize'])
    finishStart()
    await startup
    expect(events).toEqual([
      'initialize',
      'cleanupDevelopmentShortcut',
      'settings.load',
      'runtime.start',
      'ready',
      'openWindow'
    ])
    secondInstance()
    expect(events.at(-1)).toBe('openWindow')
    expect(events.filter((event) => event === 'openWindow')).toHaveLength(2)
  })
})
