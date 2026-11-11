import { Notification } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElectronNotificationPort } from '@main/electron-notification.js'
import type { ProductNotification } from '@main/profile-notification-controller.js'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Notification: vi.fn(function () {
      return Object.assign(new EventEmitter(), { show: vi.fn() })
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function showProfileNotification(): {
  notification: Notification
  openProfile: ReturnType<typeof vi.fn>
} {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const openProfile = vi.fn()
  const message: ProductNotification = {
    title: 'Gaming activated',
    body: 'Activated automatically.',
    severity: 'information',
    urgency: 'normal',
    onClick: () => openProfile('gaming')
  }
  const port = new ElectronNotificationPort({ write: vi.fn() })
  port.show(message)
  const notification = vi.mocked(Notification).mock.results[0]!.value as Notification
  expect(notification.show).toHaveBeenCalledOnce()
  return { notification, openProfile }
}

describe('ElectronNotificationPort', () => {
  it('routes a Windows toast body click to its related profile through the main-owned callback', () => {
    const { notification, openProfile } = showProfileNotification()
    expect(Notification).toHaveBeenCalledWith(
      expect.objectContaining({
        toastXml: expect.stringContaining('<text>Gaming activated</text>')
      })
    )

    notification.emit('click')

    expect(openProfile).toHaveBeenCalledExactlyOnceWith('gaming')
  })

  it('does not open or focus the app when Windows dismisses the toast with Close', () => {
    const { notification, openProfile } = showProfileNotification()
    expect(Notification).toHaveBeenCalledWith(
      expect.objectContaining({
        toastXml: expect.stringContaining('activationType="system" arguments="dismiss"')
      })
    )

    notification.emit('close')

    expect(openProfile).not.toHaveBeenCalled()
  })
})
