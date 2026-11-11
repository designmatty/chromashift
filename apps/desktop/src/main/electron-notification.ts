import { Notification } from 'electron'
import { buildNotificationOptions } from '@main/electron-notification-options.js'
import type {
  ProductNotification,
  ProductNotificationPort
} from '@main/profile-notification-controller.js'
import type { StructuredLogger } from '@main/structured-logger.js'

export class ElectronNotificationPort implements ProductNotificationPort {
  readonly #active = new Set<Notification>()

  public constructor(private readonly logger: StructuredLogger) {}

  public isSupported(): boolean {
    return Notification.isSupported()
  }

  public show(message: ProductNotification): void {
    const notification = new Notification(buildNotificationOptions(message, process.platform))
    const release = (): void => {
      this.#active.delete(notification)
    }

    notification.on('click', () => {
      release()
      message.onClick()
    })
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
