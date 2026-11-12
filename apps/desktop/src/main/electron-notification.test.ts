import {
  Notification,
  type ActivationArguments,
  type NotificationConstructorOptions
} from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElectronNotificationPort } from '@main/electron-notification.js'
import {
  handleSecondInstanceLaunch,
  isWindowsNotificationLaunch
} from '@main/notification-activation.js'
import type { ProductNotification } from '@main/profile-notification-controller.js'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Notification: Object.assign(
      vi.fn(function () {
        return Object.assign(new EventEmitter(), { show: vi.fn(), close: vi.fn() })
      }),
      {
        isSupported: vi.fn(() => true),
        handleActivation: vi.fn()
      }
    )
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function setup(platform: NodeJS.Platform = 'win32', ready = true) {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  const openProfile = vi.fn()
  const onClick = vi.fn()
  const write = vi.fn()
  const port = new ElectronNotificationPort({ write }, openProfile)
  port.initialize()
  if (ready) port.ready()
  const message: ProductNotification = {
    title: 'Gaming activated',
    body: 'Activated automatically.',
    severity: 'information',
    urgency: 'normal',
    profileId: 'gaming',
    onClick
  }
  port.show(message)
  const notification = vi.mocked(Notification).mock.results.at(-1)!.value as Notification
  const options = vi.mocked(Notification).mock.calls.at(-1)![0]!
  const activate = (details: ActivationArguments): void => {
    vi.mocked(Notification.handleActivation).mock.calls.at(-1)![0](details)
  }
  expect(notification.show).toHaveBeenCalledOnce()
  return { port, notification, options, activate, openProfile, onClick, write }
}

// Replay the arguments shipped in the XML, following Electron's WinRT/COM
// parser, rather than assuming Close emits a `close` event.
function activation(
  options: NotificationConstructorOptions,
  action: 'close' | 'body'
): ActivationArguments {
  const pattern =
    action === 'body' ? /<toast launch="([^"]+)"/u : /<action [^>]*arguments="([^"]+)"/u
  const args = pattern.exec(options.toastXml!)![1]!.replaceAll('&amp;', '&')
  return {
    type: 'action',
    actionIndex: Number(new URLSearchParams(args).get('action')),
    arguments: args
  }
}

describe('ElectronNotificationPort', () => {
  it('handles the Windows Close instance action without opening a window or profile, even with a stray click', () => {
    const { notification, openProfile, onClick } = setup()
    notification.emit('action', { actionIndex: 0 }, 0)
    notification.emit('click')
    expect(notification.close).toHaveBeenCalledOnce()
    expect(openProfile).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it.each(['global-first', 'instance-first'] as const)(
    'dismisses Close once through both event paths, %s',
    (order) => {
      const { notification, options, activate, openProfile, onClick } = setup()
      const global = (): void => activate(activation(options, 'close'))
      const instance = (): void => {
        notification.emit('action', { actionIndex: 0 }, 0)
      }
      if (order === 'global-first') {
        global()
        instance()
      } else {
        instance()
        global()
      }
      expect(notification.close).toHaveBeenCalledOnce()
      expect(openProfile).not.toHaveBeenCalled()
      expect(onClick).not.toHaveBeenCalled()
    }
  )

  it.each(['global-first', 'instance-first'] as const)(
    'opens the body profile exactly once through both event paths, %s',
    (order) => {
      const { notification, options, activate, openProfile, onClick } = setup()
      const global = (): void => activate(activation(options, 'body'))
      const instance = (): void => {
        notification.emit('action', { actionIndex: 1 }, 1)
      }
      if (order === 'global-first') {
        global()
        instance()
      } else {
        instance()
        global()
      }
      expect(openProfile).toHaveBeenCalledExactlyOnceWith('gaming')
      expect(onClick).not.toHaveBeenCalled()
    }
  )

  it.each(['close', 'body'] as const)(
    'routes a Notification Center %s after timeout without an instance reference',
    (action) => {
      const { notification, options, activate, openProfile } = setup()
      notification.emit('close', { reason: 'timeout' })
      activate(activation(options, action))
      expect(notification.close).not.toHaveBeenCalled()
      if (action === 'body') expect(openProfile).toHaveBeenCalledExactlyOnceWith('gaming')
      else expect(openProfile).not.toHaveBeenCalled()
    }
  )

  it.each(['close', 'body'] as const)(
    'routes a cold COM %s without the original port or renderer',
    (action) => {
      const previous = setup()
      const details = activation(previous.options, action)
      const openProfile = vi.fn()
      const openWindow = vi.fn()
      // Electron can replay stored details synchronously during registration.
      vi.mocked(Notification.handleActivation).mockImplementationOnce((callback) =>
        callback(details)
      )
      const cold = new ElectronNotificationPort({ write: vi.fn() }, openProfile)
      expect(isWindowsNotificationLaunch('win32', ['ChromaShift.exe', '-Embedding'])).toBe(true)
      cold.initialize()
      handleSecondInstanceLaunch('win32', ['ChromaShift.exe', '-Embedding'], openWindow)
      expect(openWindow).not.toHaveBeenCalled()
      expect(openProfile).not.toHaveBeenCalled()
      cold.ready()
      expect(previous.notification.close).not.toHaveBeenCalled()
      if (action === 'body') expect(openProfile).toHaveBeenCalledExactlyOnceWith('gaming')
      else expect(openProfile).not.toHaveBeenCalled()
    }
  )

  it.each(['close', 'body'] as const)(
    'waits for COM %s details after second-instance without opening the generic app',
    (action) => {
      const { options, activate, openProfile } = setup()
      const openWindow = vi.fn()
      handleSecondInstanceLaunch('win32', ['ChromaShift.exe', '-Embedding'], openWindow)
      activate(activation(options, action))
      expect(openWindow).not.toHaveBeenCalled()
      if (action === 'body') expect(openProfile).toHaveBeenCalledExactlyOnceWith('gaming')
      else expect(openProfile).not.toHaveBeenCalled()
    }
  )

  it('ignores unknown Windows action indices and unstructured click events', () => {
    const { notification, activate, openProfile, onClick } = setup()
    notification.emit('action', { actionIndex: 9 }, 9)
    notification.emit('click')
    activate({ type: 'click', arguments: 'unknown' })
    expect(notification.close).not.toHaveBeenCalled()
    expect(openProfile).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('logs Windows toast rejection without opening a profile', () => {
    const { notification, openProfile, write } = setup()
    notification.emit('failed', {}, 'Invalid XML')
    expect(write).toHaveBeenCalledWith({
      level: 'error',
      eventName: 'ProfileNotificationFailed',
      title: 'Gaming activated',
      message: 'Invalid XML'
    })
    expect(openProfile).not.toHaveBeenCalled()
  })

  it.each(['linux', 'darwin'] as const)(
    'keeps the %s instance click callback and options',
    (platform) => {
      const { notification, options, openProfile, onClick } = setup(platform)
      expect(options).toEqual({
        title: 'Gaming activated',
        body: 'Activated automatically.',
        urgency: 'normal'
      })
      notification.emit('click')
      expect(onClick).toHaveBeenCalledOnce()
      expect(openProfile).not.toHaveBeenCalled()
      expect(Notification.handleActivation).not.toHaveBeenCalled()
    }
  )
})
