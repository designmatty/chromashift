import { Notification } from 'electron'
import { randomUUID } from 'node:crypto'
import { buildNotificationOptions } from '@main/electron-notification-options.js'
import {
  NotificationActivationController,
  notificationActivationArguments
} from '@main/notification-activation.js'
import type {
  ProductNotification,
  ProductNotificationPort
} from '@main/profile-notification-controller.js'
import type { StructuredLogger } from '@main/structured-logger.js'

export class ElectronNotificationPort implements ProductNotificationPort {
  readonly #active = new Set<Notification>()
  readonly #windows = new Map<string, Notification>()
  readonly #activation: NotificationActivationController

  public constructor(
    private readonly logger: StructuredLogger,
    openProfile: (profileId: string | null) => void,
    notificationLaunch = false
  ) {
    this.#activation = new NotificationActivationController(
      openProfile,
      (id) => {
        const notification = this.#windows.get(id)
        if (notification !== undefined) notification.close()
        // Windows dismisses foreground action toasts itself. After a cold start
        // or timeout there may be no live object to close. Notification.remove()
        // is a no-op on Windows in Electron 43, so do not use it as a fallback.
        this.#windows.delete(id)
        if (notification !== undefined) this.#active.delete(notification)
      },
      notificationLaunch
    )
  }

  public initialize(): void {
    if (process.platform !== 'win32') return
    // Initialize the presenter/COM activator even on a cold notification launch.
    Notification.isSupported()
    Notification.handleActivation((details) => this.#activation.handle(details))
  }

  public ready(): void {
    this.#activation.ready()
  }

  public waitForStartup(): Promise<boolean> {
    return this.#activation.waitForStartup()
  }

  public isSupported(): boolean {
    return Notification.isSupported()
  }

  public show(message: ProductNotification): void {
    const target = { id: randomUUID(), profileId: message.profileId }
    const windows = process.platform === 'win32'
    const notification = new Notification(
      buildNotificationOptions(message, process.platform, target)
    )
    const release = (): void => {
      this.#active.delete(notification)
      this.#windows.delete(target.id)
    }

    if (windows) {
      this.#windows.set(target.id, notification)
      notification.on('action', (event) => {
        if (event.actionIndex !== 0 && event.actionIndex !== 1) return
        this.#activation.handle({
          type: 'action',
          actionIndex: event.actionIndex,
          arguments: notificationActivationArguments(
            target,
            event.actionIndex === 0 ? 'close' : 'body'
          )
        })
      })
      // Do not interpret argument-less Windows click events. Only the structured
      // body activation above can open a profile; Close can never fall through.
    } else {
      notification.on('click', () => {
        release()
        message.onClick()
      })
    }
    notification.on('show', () => {
      this.logger.write({
        level: 'information',
        eventName: 'ProfileNotificationShown',
        title: message.title
      })
    })
    notification.on('close', release)
    notification.on('failed', (_event, error) => {
      release()
      this.logger.write({
        level: 'error',
        eventName: 'ProfileNotificationFailed',
        title: message.title,
        message: error
      })
    })

    this.#active.add(notification)
    notification.show()
    this.logger.write({
      level: 'information',
      eventName: 'ProfileNotificationRequested',
      title: message.title
    })
  }
}
