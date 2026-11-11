import type { NotificationConstructorOptions } from 'electron'
import type { ProductNotification } from '@main/profile-notification-controller.js'

export function buildNotificationOptions(
  message: Omit<ProductNotification, 'onClick'>,
  platform: NodeJS.Platform
): NotificationConstructorOptions {
  const options: NotificationConstructorOptions = {
    title: message.title,
    body: message.body,
    urgency: message.urgency
  }
  if (platform === 'win32') {
    options.toastXml = `<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>${escapeXml(message.title)}</text>
      <text>${escapeXml(message.body)}</text>
    </binding>
  </visual>
  <actions>
    <action content="Close" activationType="system" arguments="dismiss" />
  </actions>
  <audio silent="true" />
</toast>`
  }
  return options
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
