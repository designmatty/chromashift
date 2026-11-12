import type { NotificationConstructorOptions } from 'electron'
import type { ProductNotification } from '@main/profile-notification-controller.js'
import {
  notificationActivationArguments,
  type NotificationTarget
} from '@main/notification-activation.js'

export function buildNotificationOptions(
  message: Omit<ProductNotification, 'onClick'>,
  platform: NodeJS.Platform,
  target: NotificationTarget
): NotificationConstructorOptions {
  const options: NotificationConstructorOptions = {
    title: message.title,
    body: message.body,
    urgency: message.urgency
  }
  if (platform === 'win32') {
    options.id = target.id
    options.toastXml = `<toast launch="${escapeXml(notificationActivationArguments(target, 'body'))}">
  <visual>
    <binding template="ToastGeneric">
      <text>${escapeXml(message.title)}</text>
      <text>${escapeXml(message.body)}</text>
    </binding>
  </visual>
  <actions>
    <action content="Close" activationType="foreground" arguments="${escapeXml(notificationActivationArguments(target, 'close'))}" />
  </actions>
  <audio silent="true" />
</toast>`
  }
  return options
}

// Characters XML 1.0 does not allow (C0 controls other than tab, newline and carriage
// return; U+FFFE and U+FFFF; lone surrogates) make Windows reject the toast, so the
// notification would never show. Replace them before escaping.
const invalidXmlCharacters = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu

function escapeXml(value: string): string {
  return value
    .replace(invalidXmlCharacters, '\uFFFD')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
