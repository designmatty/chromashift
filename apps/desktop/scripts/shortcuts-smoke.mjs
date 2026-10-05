import { join } from 'node:path'
import { focusNativeApp } from './profile-reorder-smoke.mjs'

// Runs inside the desktop smoke's isolated data directory and restoration guard.
export async function verifyShortcuts({
  debuggerClient,
  waitForExpression: waitFor,
  captureNativeWindow,
  processId,
  screenshotDirectory
}) {
  async function waitForExpression(client, expression, message) {
    try {
      await waitFor(client, `(async () => (${expression}))()`, message)
    } catch (error) {
      globalThis.console.error(
        'Shortcut failure state:',
        await evaluate(
          `(async () => ({ body: document.body.innerText, inputs: [...document.querySelectorAll('input')].map(e => ({ label: e.ariaLabel, value: e.value })), state: await window.chromaShift.getState() }))()`
        )
      )
      await capture('failure')
      throw error
    }
  }
  async function evaluate(expression) {
    const result = await debuggerClient.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  async function click(selector) {
    if (
      !(await evaluate(
        `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true })()`
      ))
    ) {
      throw new Error(`Shortcut control was unavailable: ${selector}`)
    }
  }
  async function key(key, code = key, modifiers = 0) {
    await debuggerClient.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers })
    await debuggerClient.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers })
  }
  async function capture(name) {
    await captureNativeWindow(
      processId,
      join(screenshotDirectory, `shortcuts-${name}-native.png`),
      true
    )
  }
  const toggle = 'button[aria-label="Toggle ChromaShift shortcut"]'
  const input = 'input[aria-label="Toggle ChromaShift shortcut"]'
  const save = 'button[aria-label="Save Toggle ChromaShift shortcut"]'
  const options = 'button[aria-label="Toggle ChromaShift shortcut options"]'
  const binding = 'Control+Alt+Shift+F9'
  const savedBinding = 'CommandOrControl+Alt+Shift+F9'
  const hasBinding = `(async () => { const state = await window.chromaShift.getState(); return state.ok && state.value.settings.shortcutBindings.some(b => b.action.kind === 'toggleChromaShift' && b.accelerator === '${savedBinding}') })()`
  await focusNativeApp(processId)
  await evaluate(`window.chromaShift.openAppPanel('shortcuts')`)
  await waitForExpression(
    debuggerClient,
    `document.querySelector(${JSON.stringify(toggle)}) !== null`,
    'Shortcut settings did not open.'
  )
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[data-part="shortcut-display"][data-accelerator="CommandOrControl+Alt+Super+R"]')?.getAttribute('aria-label') === 'Restore original display settings shortcut: Ctrl+Alt+Win+R' && !document.querySelector('button[aria-label="Restore original display settings shortcut"]')`,
    'Safety shortcut must remain read-only.'
  )
  await capture('empty')
  await click(toggle)
  await waitForExpression(
    debuggerClient,
    `document.activeElement === document.querySelector(${JSON.stringify(input)}) && document.activeElement.placeholder === 'Press shortcut' && !document.querySelector(${JSON.stringify(save)})`,
    'Clicking Add shortcut did not focus the empty recorder.'
  )
  await capture('recording')
  await key('F9', 'F9', 11)
  await waitForExpression(
    debuggerClient,
    `document.querySelector(${JSON.stringify(input)})?.value === 'Ctrl + Alt + Shift + F9' && document.querySelector(${JSON.stringify(save)}) !== null`,
    'Captured shortcut did not expose Save.'
  )
  await waitForExpression(
    debuggerClient,
    `!(await ${hasBinding})`,
    'Capturing a shortcut persisted it before Save.'
  )
  await capture('draft')
  await key('Tab')
  await waitForExpression(
    debuggerClient,
    `document.activeElement === document.querySelector(${JSON.stringify(save)})`,
    'Tab did not reach Save.'
  )
  await key('Enter')
  await waitForExpression(
    debuggerClient,
    `${hasBinding}`,
    'Save did not register and persist the captured shortcut.'
  )
  await waitForExpression(
    debuggerClient,
    `document.querySelector(${JSON.stringify(toggle)})?.querySelectorAll('[data-part="shortcut-key"]').length === 4 && !document.querySelector(${JSON.stringify(input)})`,
    'Saved shortcut did not return to compact keycaps.'
  )
  await evaluate(`document.querySelector(${JSON.stringify(toggle)}).blur()`)
  await debuggerClient.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
  await capture('defined')
  const rect = await evaluate(
    `(() => { const r = document.querySelector(${JSON.stringify(toggle)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`
  )
  await debuggerClient.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rect })
  await waitForExpression(
    debuggerClient,
    `getComputedStyle(document.querySelector(${JSON.stringify(toggle)})).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(document.querySelector(${JSON.stringify(options)})).opacity === '1'`,
    'Hover did not highlight the shortcut and reveal its menu.'
  )
  await capture('hover')
  await click(options)
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="menuitem"][data-value="remove"]') !== null`,
    'Shortcut overflow menu did not open.'
  )
  await capture('menu')
  await key('Escape')

  // Failed registration must leave the previous binding intact and the draft retryable.
  await click(toggle)
  await key('r', 'KeyR', 7)
  await click(save)
  await waitForExpression(
    debuggerClient,
    `document.querySelector(${JSON.stringify(input)})?.value === 'Ctrl + Alt + Win + R' && !document.querySelector(${JSON.stringify(save)})?.disabled && (await ${hasBinding}) && document.body.innerText.includes('reserved for emergency restore')`,
    'Reserved-key rejection lost the draft or changed the saved binding.'
  )
  await capture('rejected')
  await key('Escape')
  await waitForExpression(
    debuggerClient,
    `document.querySelector(${JSON.stringify(toggle)}) !== null && (await ${hasBinding})`,
    'Escape failed to discard a rejected draft.'
  )

  await click(toggle)
  await key('Tab', 'Tab', 8)
  await waitForExpression(
    debuggerClient,
    `document.querySelector(${JSON.stringify(input)})?.value === 'Shift + Tab'`,
    'Modified Tab could no longer be recorded as a shortcut.'
  )
  await key('Escape')

  await click(toggle)
  await key('F10', 'F10', 11)
  await key('Escape')
  await waitForExpression(
    debuggerClient,
    `(await ${hasBinding}) && !document.querySelector(${JSON.stringify(input)})`,
    'Escape changed a saved shortcut.'
  )

  await click(toggle)
  await key('F10', 'F10', 11)
  const outside = await evaluate(
    `(() => { const r = document.querySelector('h1').getBoundingClientRect(); return { x: r.x + 3, y: r.y + 3 } })()`
  )
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...outside
  })
  await debuggerClient.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...outside
  })
  await waitForExpression(
    debuggerClient,
    `(await ${hasBinding}) && !document.querySelector(${JSON.stringify(input)})`,
    'Clicking outside failed to discard the draft.'
  )

  await click(toggle)
  await key('Delete')
  await waitForExpression(
    debuggerClient,
    `!(await ${hasBinding}) && document.querySelector(${JSON.stringify(toggle)})?.textContent.trim() === 'Add shortcut'`,
    'Delete did not preserve the recorder removal behavior.'
  )
  await click(toggle)
  await key('F9', 'F9', 11)
  await click(save)
  await waitForExpression(
    debuggerClient,
    `${hasBinding}`,
    'The shortcut did not save again after removal.'
  )
  await click(options)
  await waitForExpression(
    debuggerClient,
    `document.querySelector('[role="menuitem"][data-value="remove"]') !== null`,
    'Removal menu did not reopen.'
  )
  await click('[role="menuitem"][data-value="remove"]')
  await waitForExpression(
    debuggerClient,
    `!(await ${hasBinding}) && !document.querySelector(${JSON.stringify(options)}) && document.querySelector(${JSON.stringify(toggle)})?.textContent.trim() === 'Add shortcut'`,
    'Overflow removal did not clear the binding.'
  )

  // Leave the binding available for the full smoke's renderer-free global-shortcut gate.
  await click(toggle)
  await key('F9', 'F9', 11)
  await click(save)
  await waitForExpression(
    debuggerClient,
    `${hasBinding}`,
    `Could not restore ${binding} for the renderer-free shortcut gate.`
  )
  await evaluate(
    `(async () => { const state = await window.chromaShift.getState(); if (!state.ok) throw new Error('No settings'); return window.chromaShift.updateSettings({ ...state.value.settings, theme: 'light' }) })()`
  )
  await waitForExpression(
    debuggerClient,
    `document.documentElement.classList.contains('light')`,
    'Light shortcut theme did not apply.'
  )
  await capture('light')
  await click(toggle)
  await key('F10', 'F10', 11)
  await capture('light-draft')
  await key('Escape')
  await evaluate(
    `(async () => { const state = await window.chromaShift.getState(); return window.chromaShift.updateSettings({ ...state.value.settings, theme: 'dark' }) })()`
  )
  await waitForExpression(
    debuggerClient,
    `document.documentElement.classList.contains('dark')`,
    'Dark shortcut theme did not apply.'
  )
  globalThis.console.log(
    'Shortcut smoke passed: draft, Save, cancellation, reserved binding, removal, keyboard focus, hover, menu, and native light/dark captures.'
  )
}
