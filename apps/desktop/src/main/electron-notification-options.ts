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

// Characters XML 1.0 does not allow (C0 controls other than tab, newline and carriage
// return; U+FFFE and U+FFFF; lone surrogates) make Windows reject the toast, so the
// notification would never show. Replace them before escaping.
const invalidXmlCharacters = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu

function escapeXml(value: string): string {
  return value
    .replace(invalidXmlCharacters, '�')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
