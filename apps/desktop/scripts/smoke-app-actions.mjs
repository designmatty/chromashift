export async function clickAppButton(debuggerClient, label, scope, waitForExpression) {
  // Preview state can reach main's callers before the renderer finishes its
  // selection task. Check admission and click in the same evaluation.
  await waitForExpression(
    debuggerClient,
    `(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(`${scope} button`.trim())})]
        .find((item) => item.textContent?.trim() === ${JSON.stringify(label)})
      if (!button || button.matches(':disabled')) return false
      button.click()
      return true
    })()`,
    `The ${JSON.stringify(label)} button did not become enabled in ${scope || 'the app'}.`
  )
}
