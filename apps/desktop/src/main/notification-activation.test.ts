import { describe, expect, it, vi } from 'vitest'
import type { ActivationArguments } from 'electron'
import {
  handleSecondInstanceLaunch,
  isWindowsNotificationLaunch,
  notificationActivationArguments,
  NotificationActivationController
} from '@main/notification-activation.js'

const target = { id: '4c692b42-0cc0-49b9-8f37-c59e7056ac4c', profileId: 'gaming' }
const close: ActivationArguments = {
  type: 'action',
  actionIndex: 0,
  arguments: notificationActivationArguments(target, 'close')
}

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
