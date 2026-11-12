import { describe, expect, it } from 'vitest'
import { buildNotificationOptions } from '@main/electron-notification-options.js'
import { notificationActivationArguments } from '@main/notification-activation.js'
import type { ProductNotification } from '@main/profile-notification-controller.js'

const message: Omit<ProductNotification, 'onClick'> = {
  title: 'Gaming activated',
  body: 'Activated automatically.',
  severity: 'information',
  urgency: 'normal',
  profileId: 'gaming'
}

const target = { id: '4c692b42-0cc0-49b9-8f37-c59e7056ac4c', profileId: 'gaming' }
function buildOptions(message: Omit<ProductNotification, 'onClick'>, platform: NodeJS.Platform) {
  return buildNotificationOptions(message, platform, target)
}

describe('buildNotificationOptions', () => {
  it('carries the title and body in the Windows toast', () => {
    const { toastXml } = buildOptions(message, 'win32')
    expect(toastXml).toContain(
      `<toast launch="${notificationActivationArguments(target, 'body').replaceAll('&', '&amp;')}">`
    )
    expect(toastXml).toContain('<binding template="ToastGeneric">')
    expect(toastXml).toContain('<text>Gaming activated</text>')
    expect(toastXml).toContain('<text>Activated automatically.</text>')
  })

  it('escapes profile names and error text without allowing XML injection', () => {
    const { toastXml } = buildOptions(
      {
        ...message,
        title: `Tom & Jerry's <"Gaming"> was not fully applied`,
        body: `Write failed: <error reason="A&B's"> &lt; </text><actions />`
      },
      'win32'
    )
    expect(toastXml).toContain(
      '<text>Tom &amp; Jerry&apos;s &lt;&quot;Gaming&quot;&gt; was not fully applied</text>'
    )
    expect(toastXml).toContain(
      '<text>Write failed: &lt;error reason=&quot;A&amp;B&apos;s&quot;&gt; &amp;lt; &lt;/text&gt;&lt;actions /&gt;</text>'
    )
  })

  it('replaces characters XML does not allow so Windows still shows the toast', () => {
    const invalid = [
      '\uDC00',
      '\u0000',
      '\u0008',
      '\u000B',
      '\u000C',
      '\u001F',
      '\uFFFE',
      '\uFFFF',
      '\uD800'
    ]
    const { toastXml } = buildOptions(
      { ...message, title: `A${invalid.join('')}B`, body: 'Tab\tand\nnewline\rstay' },
      'win32'
    )
    expect(toastXml).toContain(`<text>A${'\uFFFD'.repeat(invalid.length)}B</text>`)
    expect(toastXml).toContain('<text>Tab\tand\nnewline\rstay</text>')
  })

  it('keeps astral characters such as emoji', () => {
    const { toastXml } = buildOptions({ ...message, title: 'Game \u{1F3AE}' }, 'win32')
    expect(toastXml).toContain('<text>Game \u{1F3AE}</text>')
  })

  it('includes exactly one structured Close action and silent audio', () => {
    const { toastXml, id } = buildOptions(message, 'win32')
    expect(id).toBe(target.id)
    expect(toastXml).toContain(
      `<action content="Close" activationType="foreground" arguments="${notificationActivationArguments(target, 'close').replaceAll('&', '&amp;')}" />`
    )
    expect(toastXml?.match(/<action\s/gu)).toHaveLength(1)
    expect(toastXml).toContain('<audio silent="true" />')
  })

  it.each([
    { severity: 'information', urgency: 'normal' },
    { severity: 'information', urgency: 'low' },
    { severity: 'warning', urgency: 'critical' },
    { severity: 'error', urgency: 'critical' }
  ] as const)('preserves $severity urgency $urgency', ({ severity, urgency }) => {
    const options = buildOptions({ ...message, severity, urgency }, 'win32')
    expect(options.urgency).toBe(urgency)
    expect(options.toastXml).toContain('<audio silent="true" />')
    expect(options.toastXml).not.toContain('scenario=')
  })

  it.each(['linux', 'darwin'] as const)('keeps the existing %s options', (platform) => {
    expect(buildOptions(message, platform)).toEqual({
      title: message.title,
      body: message.body,
      urgency: message.urgency
    })
  })
})
