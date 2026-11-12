import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivationArguments } from 'electron'
import {
  handleSecondInstanceLaunch,
  isWindowsNotificationLaunch,
  notificationActivationArguments,
  NotificationActivationController,
  startAfterNotificationActivation
} from '@main/notification-activation.js'

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

describe('cold notification startup', () => {
  afterEach(() => vi.useRealTimers())

  function setup(notificationLaunch = true) {
    const openProfile = vi.fn()
    const dismiss = vi.fn()
    const start = vi.fn(async () => {})
    const quit = vi.fn()
    const initialize = vi.fn()
    const write = vi.fn()
    const openWindow = vi.fn()
    const controller = new NotificationActivationController(
      openProfile,
      dismiss,
      notificationLaunch
    )
    const whenReady = (): Promise<void> =>
      startAfterNotificationActivation({
        initialize,
        wait: () => controller.waitForStartup(),
        quit,
        loadAndStart: start,
        ready: () => controller.ready(),
        shouldOpenWindow: () => !notificationLaunch,
        openWindow,
        logger: { write }
      })
    return {
      controller,
      openProfile,
      dismiss,
      start,
      quit,
      whenReady,
      initialize,
      write,
      openWindow
    }
  }

  it.each(['before', 'after'] as const)(
    'quits without starting for Close arriving %s whenReady',
    async (arrival) => {
      const {
        controller,
        openProfile,
        dismiss,
        start,
        quit,
        whenReady,
        initialize,
        write,
        openWindow
      } = setup()
      if (arrival === 'before') controller.handle(close)
      const startup = whenReady()
      expect(start).not.toHaveBeenCalled()
      if (arrival === 'after') controller.handle(close)
      await startup
      expect(dismiss).toHaveBeenCalledExactlyOnceWith(target.id)
      expect(quit).toHaveBeenCalledOnce()
      expect(initialize).toHaveBeenCalledOnce()
      expect(write).toHaveBeenCalledExactlyOnceWith({
        level: 'information',
        eventName: 'NotificationLaunchQuit',
        reason: 'close'
      })
      expect(start).not.toHaveBeenCalled()
      expect(openWindow).not.toHaveBeenCalled()
      expect(openProfile).not.toHaveBeenCalled()
      // A later activation cannot restart a process already committed to quit.
      controller.handle({
        ...body,
        arguments: body.arguments.replace(target.id, '5c692b42-0cc0-49b9-8f37-c59e7056ac4c')
      })
      controller.ready()
      expect(await controller.waitForStartup()).toEqual({ action: 'quit', reason: 'close' })
      expect(openProfile).not.toHaveBeenCalled()
    }
  )

  it.each(['before', 'after'] as const)(
    'starts and opens the body profile arriving %s whenReady',
    async (arrival) => {
      const { controller, openProfile, dismiss, start, quit, whenReady } = setup()
      let finishStart!: () => void
      const runtimeReady = new Promise<void>((resolve) => {
        finishStart = resolve
      })
      start.mockImplementationOnce(() => runtimeReady)
      if (arrival === 'before') controller.handle(body)
      const startup = whenReady()
      expect(start).not.toHaveBeenCalled()
      if (arrival === 'after') controller.handle(body)
      await Promise.resolve()
      expect(start).toHaveBeenCalledOnce()
      expect(openProfile).not.toHaveBeenCalled()
      finishStart()
      await startup
      expect(dismiss).toHaveBeenCalledExactlyOnceWith(target.id)
      expect(openProfile).toHaveBeenCalledExactlyOnceWith('gaming')
      expect(quit).not.toHaveBeenCalled()
      controller.handle(body)
      controller.ready()
      expect(openProfile).toHaveBeenCalledOnce()
    }
  )

  it('quits after three seconds without recognizable activation and ignores a late body', async () => {
    vi.useFakeTimers()
    const { controller, openProfile, dismiss, start, quit, whenReady, write, openWindow } = setup()
    const startup = whenReady()
    controller.handle({ type: 'click', arguments: 'unknown' })
    await vi.advanceTimersByTimeAsync(2_999)
    expect(quit).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await startup
    expect(quit).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledExactlyOnceWith({
      level: 'information',
      eventName: 'NotificationLaunchQuit',
      reason: 'timeout'
    })
    expect(openWindow).not.toHaveBeenCalled()
    controller.handle(body)
    controller.ready()
    expect(start).not.toHaveBeenCalled()
    expect(openProfile).not.toHaveBeenCalled()
    expect(dismiss).not.toHaveBeenCalled()
  })

  it.each([close, body])(
    'clears the timeout after a recognized activation $actionIndex',
    async (details) => {
      vi.useFakeTimers()
      const { controller, start, quit, whenReady } = setup()
      const startup = whenReady()
      const decision = controller.waitForStartup()
      controller.handle(details)
      await startup
      expect(await decision).toEqual(
        details === body ? { action: 'start' } : { action: 'quit', reason: 'close' }
      )
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(3_000)
      expect(start).toHaveBeenCalledTimes(details === body ? 1 : 0)
      expect(quit).toHaveBeenCalledTimes(details === close ? 1 : 0)
    }
  )

  it.each([undefined, close, body])(
    'starts a normal launch immediately regardless of notification activation $actionIndex',
    async (details) => {
      vi.useFakeTimers()
      const { controller, openProfile, start, quit, whenReady, write, openWindow } = setup(false)
      if (details !== undefined) controller.handle(details)
      await whenReady()
      expect(start).toHaveBeenCalledOnce()
      expect(quit).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(openWindow).toHaveBeenCalledOnce()
      if (details === body) expect(openProfile).toHaveBeenCalledExactlyOnceWith('gaming')
      else expect(openProfile).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  )
})

describe('notification activation validation', () => {
  it.each([
    { ...close, arguments: '' },
    { ...close, arguments: 'dismiss' },
    { ...close, arguments: close.arguments.replace('notification-v1', 'unknown') },
    { ...close, arguments: close.arguments.replace('action=0', 'action=99') },
    { ...close, arguments: close.arguments.replace(target.id, '../untrusted') },
    { ...close, arguments: close.arguments + '&action=1' },
    { ...close, arguments: close.arguments + '&unknown=1' },
    { ...close, arguments: close.arguments.replace('&profile=gaming', '') },
    { ...close, type: 'click' },
    { ...close, actionIndex: 1 },
    { ...close, actionIndex: undefined }
  ])('ignores unknown or ambiguous arguments $arguments', (details) => {
    const openProfile = vi.fn()
    const dismiss = vi.fn()
    const controller = new NotificationActivationController(openProfile, dismiss)
    controller.ready()
    controller.handle(details)
    expect(openProfile).not.toHaveBeenCalled()
    expect(dismiss).not.toHaveBeenCalled()
  })

  it.each([null, 'default', 'gaming', `&<"'=? +🎮`])(
    'preserves the cold body target %s',
    (profileId) => {
      const openProfile = vi.fn()
      const dismiss = vi.fn()
      const controller = new NotificationActivationController(openProfile, dismiss)
      controller.handle({
        type: 'action',
        actionIndex: 1,
        arguments: notificationActivationArguments({ ...target, profileId }, 'body')
      })
      expect(openProfile).not.toHaveBeenCalled()
      controller.ready()
      controller.ready()
      expect(openProfile).toHaveBeenCalledExactlyOnceWith(profileId)
      expect(dismiss).toHaveBeenCalledExactlyOnceWith(target.id)
    }
  )

  it('dismisses before runtime readiness and never queues an open for Close', () => {
    const openProfile = vi.fn()
    const dismiss = vi.fn()
    const controller = new NotificationActivationController(openProfile, dismiss)
    controller.handle(close)
    controller.handle({
      type: 'action',
      actionIndex: 1,
      arguments: notificationActivationArguments(target, 'body')
    })
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(target.id)
    controller.ready()
    expect(openProfile).not.toHaveBeenCalled()
  })
})

describe('notification launch policy', () => {
  it.each(['-Embedding', '-embedding', '/Embedding'])(
    'suppresses generic startup and second-instance opens for Windows COM %s',
    (flag) => {
      const openWindow = vi.fn()
      const argv = ['ChromaShift.exe', flag]
      expect(isWindowsNotificationLaunch('win32', argv)).toBe(true)
      handleSecondInstanceLaunch('win32', argv, openWindow)
      expect(openWindow).not.toHaveBeenCalled()
    }
  )

  it.each(['win32', 'linux', 'darwin'] as const)('preserves ordinary %s launches', (platform) => {
    const openWindow = vi.fn()
    const argv = ['ChromaShift.exe']
    expect(isWindowsNotificationLaunch(platform, argv)).toBe(false)
    handleSecondInstanceLaunch(platform, argv, openWindow)
    expect(openWindow).toHaveBeenCalledOnce()
  })

  it.each(['linux', 'darwin'] as const)(
    'does not reinterpret %s command lines as Windows COM launches',
    (platform) => {
      expect(isWindowsNotificationLaunch(platform, ['ChromaShift', '-Embedding'])).toBe(false)
    }
  )
})
