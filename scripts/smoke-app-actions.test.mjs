import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { URL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { clickAppButton } from '../apps/desktop/scripts/smoke-app-actions.mjs'

test('Use waits for renderer admission after Preview becomes active and clicks exactly once', async () => {
  let clicks = 0
  let attempts = 0
  const button = {
    textContent: 'Use this profile',
    disabled: true,
    matches: () => button.disabled,
    click() {
      if (!this.disabled) clicks++
    }
  }
  const document = { querySelectorAll: () => [button] }
  const debuggerClient = {
    async send(_method, { expression }) {
      return { result: { value: runInNewContext(expression, { document }) } }
    }
  }
  const wait = async (client, expression) => {
    for (let turn = 0; turn < 3; turn++) {
      attempts++
      if ((await client.send('Runtime.evaluate', { expression })).result.value) return
      // The delayed startPreview response now lets MainApp clear busy.
      button.disabled = false
    }
    throw new Error('Button never became ready')
  }
  await clickAppButton(debuggerClient, 'Use this profile', '[data-part="preview-banner"]', wait)
  assert.equal(attempts, 2)
  assert.equal(clicks, 1)
})

test('the desktop smoke uses the tested ready-click helper', () => {
  const source = readFileSync(new URL('../apps/desktop/scripts/smoke.mjs', import.meta.url), 'utf8')
  assert.match(source, /from '\.\/smoke-app-actions\.mjs'/)
  assert.match(source, /clickReadyAppButton\(debuggerClient, label, scope, waitForExpression\)/)
})
