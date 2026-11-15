export function assertCloseAction(toastXml) {
  // Inspect the actual options passed to Electron, recorded with its show event.
  const actions = typeof toastXml === 'string' ? toastXml.match(/<action\s[^>]*\/>/gu) : null
  if (
    actions?.length !== 1 ||
    !actions[0].includes('content="Close"') ||
    !actions[0].includes('activationType="foreground"') ||
    !/arguments="type=action&amp;action=0&amp;tag=[^"<>]+&amp;chromashift=notification-v1&amp;profile=[^"<>]*"/u.test(
      actions[0]
    )
  ) {
    throw new Error('The shown notification did not include its dismiss-only Close action.')
  }
}

export async function verifyNotifications({
  client,
  settings,
  processId,
  minimize,
  getOutput,
  delay
}) {
  const evaluate = async (expression) => {
    const response = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (response.exceptionDetails)
      throw new Error(`Notification fixture failed: ${JSON.stringify(response.exceptionDetails)}`)
    return response.result.value
  }
  try {
    // No targets: activation restores Original settings through the real queue,
    // under the suite's existing native restoration guard.
    const profile = await evaluate(`(async () => {
      await window.chromaShift.openAppPanel('profiles')
      const cancelled = await window.chromaShift.cancelPreview()
      if (!cancelled.ok) throw new Error('Could not end the previous preview')
      const state = await window.chromaShift.getState()
      if (!state.ok || state.value.chromaShift.status !== 'active') throw new Error('Notification check requires Active display control')
      const preferences = await window.chromaShift.updateSettings({ ...state.value.settings, notificationsEnabled: true })
      if (!preferences.ok) throw new Error('Could not enable product notifications')
      const created = await window.chromaShift.createProfile('Toast smoke ' + Date.now())
      if (!created.ok) throw new Error('Could not create the notification profile')
      return created.value
    })()`)
    if (typeof profile?.id !== 'string' || typeof profile.name !== 'string')
      throw new Error('Notification fixture did not create a profile.')
    await minimize(processId, true)
    await settings.enable()
    const offset = getOutput().length
    const activated = await evaluate(
      `window.chromaShift.activateProfile(${JSON.stringify(profile.id)})`
    )
    if (!activated?.ok) throw new Error('Could not activate the notification profile.')
    const title = `${profile.name} activated`
    const deadline = Date.now() + 15_000
    for (;;) {
      const entries = getOutput()
        .slice(offset)
        .split('\n')
        .flatMap((line) => {
          try {
            return [JSON.parse(line)]
          } catch {
            return []
          }
        })
        .filter((entry) => entry.title === title)
      if (entries.some((entry) => entry.eventName === 'ProfileNotificationFailed'))
        throw new Error(`Windows rejected the notification: ${JSON.stringify(entries)}`)
      const shown = entries.find((entry) => entry.eventName === 'ProfileNotificationShown')
      if (shown) {
        assertCloseAction(shown.toastXml)
        break
      }
      if (Date.now() >= deadline)
        throw new Error(
          `No ProfileNotificationShown for ${title}. Check Windows notification policy and Do not disturb.`
        )
      await delay(100)
    }
    globalThis.console.log(
      'ProfileNotificationShown and the Close action passed; clicks require owner checks.'
    )
  } finally {
    // Suppress again for shutdown; the outer guard restores the owner's setting.
    await settings.suppress()
  }
}
