import { setTimeout } from 'node:timers'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// CDP bringToFront does not reliably raise the native HWND on Windows.
// Focus only this smoke's app panel, never the non-activating mini panel.
export async function focusNativeApp(processId, pin = false) {
  await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ChromaShiftReorderFocus {
  public delegate bool Callback(IntPtr window, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@
$reorderWindows = [System.Collections.Generic.List[object]]::new()
[ChromaShiftReorderFocus]::EnumWindows({
  param($window, $parameter)
  $ownerId = [uint32]0
  [void][ChromaShiftReorderFocus]::GetWindowThreadProcessId($window, [ref]$ownerId)
  if ($ownerId -eq ${processId}) {
    $title = [System.Text.StringBuilder]::new(256)
    [void][ChromaShiftReorderFocus]::GetWindowText($window, $title, $title.Capacity)
    $rect = [ChromaShiftReorderFocus+Rect]::new()
    if ($title.ToString() -eq 'ChromaShift' -and [ChromaShiftReorderFocus]::GetWindowRect($window, [ref]$rect) -and
      ($rect.Right - $rect.Left) -gt 500 -and ($rect.Bottom - $rect.Top) -gt 400) {
      $reorderWindows.Add([pscustomobject]@{ Handle = $window; Area = ($rect.Right - $rect.Left) * ($rect.Bottom - $rect.Top) })
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
$reorderWindow = ($reorderWindows | Sort-Object Area -Descending | Select-Object -First 1).Handle
if ($null -eq $reorderWindow) { throw 'The reorder smoke has no native app window.' }
$foregroundOwner = [uint32]0
$foregroundThread = [ChromaShiftReorderFocus]::GetWindowThreadProcessId([ChromaShiftReorderFocus]::GetForegroundWindow(), [ref]$foregroundOwner)
$focusThread = [ChromaShiftReorderFocus]::GetCurrentThreadId()
$attached = [ChromaShiftReorderFocus]::AttachThreadInput($focusThread, $foregroundThread, $true)
try {
  [void][ChromaShiftReorderFocus]::ShowWindow($reorderWindow, 9)
  [void][ChromaShiftReorderFocus]::SetWindowPos($reorderWindow, [IntPtr]${pin ? '-1' : '-2'}, 0, 0, 0, 0, 0x43)
  [void][ChromaShiftReorderFocus]::SetForegroundWindow($reorderWindow)
} finally {
  if ($attached) { [void][ChromaShiftReorderFocus]::AttachThreadInput($focusThread, $foregroundThread, $false) }
}
`
    ],
    { windowsHide: true }
  )
}
// Runs in the real Electron renderer, inside the desktop smoke's isolated data
// directory and restoration guard. Input goes through Chromium's trusted input.
export async function verifyProfileReorder({
  debuggerClient,
  waitForExpression,
  captureNativeWindow,
  processId,
  screenshotPath
}) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function evaluate(expression) {
    const result = await debuggerClient.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const rowSelector = (id) => `[data-part="profile-rows"] [data-reorder-id="${id}"]`
  const handleSelector = (id) => `${rowSelector(id)} [data-part="profile-reorder-handle"]`
  async function center(selector) {
    return evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!element) throw new Error('Missing reorder element')
      const rect = element.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })()`)
  }
  async function mouse(type, point) {
    await debuggerClient.send('Input.dispatchMouseEvent', {
      type,
      ...point,
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : 1
    })
  }
  async function key(key, code = key, modifiers = 0) {
    const windowsVirtualKeyCode = {
      ' ': 32,
      Enter: 13,
      Escape: 27,
      ArrowUp: 38,
      ArrowDown: 40,
      Home: 36,
      End: 35,
      Tab: 9
    }[key]
    await debuggerClient.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode,
      modifiers
    })
    await debuggerClient.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode,
      modifiers
    })
  }
  async function focus(selector) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
  }
  async function removeFixture(id) {
    const result = await evaluate(`window.chromaShift.deleteProfile(${JSON.stringify(id)})`)
    if (!result.ok) throw new Error('Could not remove reorder fixture.')
  }
  async function expectOrder(ids) {
    try {
      await waitForExpression(
        debuggerClient,
        `(async () => {
      const result = await window.chromaShift.getState()
      return result.ok &&
        JSON.stringify(result.value.configuration.profiles.map(p => p.id)) === ${JSON.stringify(JSON.stringify(ids))} &&
        JSON.stringify([...document.querySelectorAll('[data-part="profile-rows"] [data-reorder-id]')].map(p => p.dataset.reorderId)) === ${JSON.stringify(JSON.stringify(ids))} &&
        document.querySelector('[data-dragging]') === null &&
        document.querySelector('[data-part="profile-reorder-handle"]:disabled') === null &&
        document.querySelector('[aria-label="Profile selection"]:disabled') === null
    })()`,
        'The dropped profile order was not rendered and persisted.'
      )
    } catch (error) {
      const state = await evaluate(`(async () => {
        const state = await window.chromaShift.getState()
        return {
          expected: ${JSON.stringify(ids)},
          saved: state.value?.configuration.profiles.map(p => ({id: p.id, name: p.name})),
          rendered: [...document.querySelectorAll('[data-part="profile-rows"] [data-reorder-id]')].map(row => ({id: row.dataset.reorderId, dragging: row.hasAttribute('data-dragging')})),
          focused: document.activeElement?.outerHTML.slice(0, 400),
          announcements: [...document.querySelectorAll('[aria-live]')].map(el => el.textContent)
        }
      })()`)
      throw new Error(error.message + ' ' + JSON.stringify(state))
    }
  }
  async function startDrag(id, destination, selector = handleSelector(id)) {
    const start = await center(selector)
    await mouse('mouseMoved', start)
    await mouse('mousePressed', start)
    for (let step = 1; step <= 6; step++) {
      await mouse('mouseMoved', {
        x: start.x + ((destination.x - start.x) * step) / 6,
        y: start.y + ((destination.y - start.y) * step) / 6
      })
      await pause(20)
    }
    await waitForExpression(
      debuggerClient,
      `document.querySelector('${rowSelector(id)}[data-dragging]') !== null`,
      'Pointer movement did not pick up the profile.'
    )
  }

  const original = await evaluate(`(async () => {
    const state = await window.chromaShift.getState()
    if (!state.ok) throw new Error('Missing product state')
    return {
      ids: state.value.configuration.profiles.map(p => p.id),
      selected: document.querySelector('[data-part="profile-select"][aria-current="page"]')?.closest('[data-reorder-id]')?.dataset.reorderId,
      mode: state.value.activation.mode,
      preview: state.value.preview
    }
  })()`)
  const created = []
  try {
    for (const name of ['Reorder Alpha', 'Reorder Beta', 'Reorder Gamma']) {
      const result = await evaluate(`window.chromaShift.createProfile(${JSON.stringify(name)})`)
      if (!result.ok) throw new Error('Could not create reorder fixture.')
      created.push(result.value.id)
    }
    const [alpha, beta, gamma] = created
    const initial = [...original.ids, ...created]
    await expectOrder(initial)
    await debuggerClient.send('Page.bringToFront')
    // Keep this animation test unoccluded while CDP drives it. Chromium pauses
    // animation frames behind the automation host. Restore normal z-order below.
    await focusNativeApp(processId, true)
    await waitForExpression(
      debuggerClient,
      `document.visibilityState === 'visible'`,
      'The native app panel was not visible for profile reorder interaction.'
    )

    // A click-sized movement must still select normally and leave order intact.
    const click = await center(handleSelector(alpha))
    await mouse('mousePressed', click)
    await mouse('mouseMoved', { x: click.x, y: click.y + 2 })
    await mouse('mouseReleased', { x: click.x, y: click.y + 2 })
    await expectOrder(initial)
    if (await evaluate(`document.querySelector('[data-dragging]') !== null`)) {
      throw new Error('A tiny movement incorrectly started a drag.')
    }

    // Drop after the final row, with live displacement and no selection change.
    const end = await center(handleSelector(gamma))
    const betaBefore = await center(handleSelector(beta))
    await startDrag(alpha, end)
    const heldDrag = await evaluate(`(async () => {
      const samples = []
      const started = performance.now()
      let sampling = true
      const sample = () => {
        const rows = [...document.querySelectorAll('[data-part="profile-rows"] [data-reorder-id]')]
        const lifted = document.querySelector('[data-dnd-overlay][data-dnd-dragging]')
        samples.push({
          time: Math.round(performance.now() - started),
          order: [...new Set(rows.map(row => row.dataset.reorderId))],
          top: lifted?.getBoundingClientRect().top
        })
        if (sampling) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      const state = await window.chromaShift.getState()
      const profile = state.value.configuration.profiles.find(p => p.id === ${JSON.stringify(beta)})
      for (let index = 0; index < 8; index++) {
        await new Promise(resolve => setTimeout(resolve, 50))
        const result = await window.chromaShift.saveProfile(profile)
        if (!result.ok) throw new Error('Could not broadcast state during a held drag')
      }
      await new Promise(resolve => setTimeout(resolve, 100))
      sampling = false
      const final = await window.chromaShift.getState()
      return { samples, preview: final.value.preview,
        selected: document.querySelector('[data-part="profile-select"][aria-current="page"]')?.closest('[data-reorder-id]')?.dataset.reorderId }
    })()`)
    const expectedHeldOrder = [...original.ids, beta, gamma, alpha]
    const unstable = heldDrag.samples.filter(
      (sample) => JSON.stringify(sample.order) !== JSON.stringify(expectedHeldOrder)
    )
    const tops = heldDrag.samples.map((sample) => sample.top).filter(Number.isFinite)
    if (!tops.length || unstable.length || Math.max(...tops) - Math.min(...tops) > 2)
      throw new Error(
        'A stationary held profile jittered during product-state updates: ' +
          JSON.stringify(heldDrag)
      )
    if (
      heldDrag.selected !== original.selected ||
      JSON.stringify(heldDrag.preview) !== JSON.stringify(original.preview)
    )
      throw new Error(
        'Dragging unexpectedly selected or previewed a profile: ' + JSON.stringify(heldDrag)
      )
    try {
      await waitForExpression(
        debuggerClient,
        `document.querySelector('${rowSelector(beta)}').getBoundingClientRect().top < ${betaBefore.y - 25}`,
        'Rows did not move aside during a downward drag.'
      )
    } catch (error) {
      const state = await evaluate(`({
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        status: document.querySelector('[role="status"]')?.textContent,
        rows: [...document.querySelectorAll('[data-reorder-id]')].map(row => ({
          id: row.dataset.reorderId, dragging: row.hasAttribute('data-dragging'),
          style: row.getAttribute('style'), top: row.getBoundingClientRect().top
        }))
      })`)
      throw new Error(error.message + ' ' + JSON.stringify(state))
    }
    await captureNativeWindow(processId, screenshotPath, true)
    await evaluate(`(() => {
      window.__reorderDropFrames = []
      const started = performance.now()
      const sample = () => {
        const rows = [...document.querySelectorAll('[data-part="profile-rows"] [data-reorder-id]')]
        const row = rows.find(row => row.dataset.reorderId === ${JSON.stringify(alpha)} && !row.hasAttribute('inert'))
        window.__reorderDropFrames.push({ time: Math.round(performance.now() - started),
          top: row?.getBoundingClientRect().top,
          order: [...new Set(rows.map(row => row.dataset.reorderId))] })
        if (performance.now() - started < 600) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })()`)
    await mouse('mouseReleased', end)
    const down = [...original.ids, beta, gamma, alpha]
    await expectOrder(down)
    await pause(650)
    const dropFrames = await evaluate('window.__reorderDropFrames')
    await evaluate('delete window.__reorderDropFrames')
    const orderChanges = dropFrames.filter(
      (frame, index) =>
        index === 0 || JSON.stringify(frame.order) !== JSON.stringify(dropFrames[index - 1].order)
    )
    if (orderChanges.some((frame) => JSON.stringify(frame.order) !== JSON.stringify(down)))
      throw new Error(
        'Dropping a profile briefly restored its previous order: ' + JSON.stringify(orderChanges)
      )

    // Move up to the first movable slot. Default must stay pinned.
    const first = await center(handleSelector(beta))
    await startDrag(alpha, first)
    await mouse('mouseReleased', first)
    await expectOrder(initial)

    // Escape and a drop outside the sidebar both cancel the speculative order.
    await startDrag(alpha, await center(handleSelector(gamma)))
    await key('Escape')
    await mouse('mouseReleased', await center(handleSelector(gamma)))
    await expectOrder(initial)
    await startDrag(alpha, await center(handleSelector(gamma)))
    await mouse('mouseReleased', { x: 550, y: end.y })
    await expectOrder(initial)

    // Keyboard pickup, End, cancel, then Home/End and commit.
    await focus(handleSelector(alpha))
    await key(' ', 'Space')
    await key('End')
    await waitForExpression(
      debuggerClient,
      `JSON.stringify([...new Set([...document.querySelectorAll('[data-part="profile-rows"] [data-reorder-id]')].map(row => row.dataset.reorderId))]) === ${JSON.stringify(JSON.stringify(down))}`,
      'End did not move the picked-up profile to the last slot.'
    )
    await key('Escape')
    await expectOrder(initial)
    await waitForExpression(
      debuggerClient,
      `document.activeElement === document.querySelector('${handleSelector(alpha)}')`,
      'Cancelling a keyboard reorder did not restore focus to its handle.'
    )
    await key(' ', 'Space')
    await key('End')
    await key('Enter')
    await expectOrder(down)
    await focus(handleSelector(alpha))
    await key(' ', 'Space')
    await key('Home')
    await key('Enter')
    await expectOrder(initial)

    // A disabled profile is still reorderable.
    await evaluate(`(async () => {
      const state = await window.chromaShift.getState()
      const profile = state.value.configuration.profiles.find(p => p.id === ${JSON.stringify(beta)})
      const result = await window.chromaShift.saveProfile({ ...profile, enabled: false })
      if (!result.ok) throw new Error('Could not disable reorder fixture')
    })()`)
    await focus(handleSelector(beta))
    await key('ArrowDown', 'ArrowDown', 1)
    await expectOrder([...original.ids, alpha, gamma, beta])

    // Collapsed rows retain pointer dragging and the Alt+arrow alternative.
    await evaluate(`document.querySelector('[aria-label="Collapse sidebar"]').click()`)
    await waitForExpression(
      debuggerClient,
      `document.querySelector('[aria-label="Expand sidebar"]') !== null`,
      'The profile sidebar did not collapse.'
    )
    await focus(`${rowSelector(beta)} [data-part="profile-select"]`)
    await key('ArrowUp', 'ArrowUp', 1)
    await expectOrder(initial)
    const collapsedEnd = await center(`${rowSelector(gamma)} [data-part="profile-select"]`)
    await startDrag(alpha, collapsedEnd, `${rowSelector(alpha)} [data-part="profile-select"]`)
    await mouse('mouseReleased', collapsedEnd)
    await expectOrder(down)
    await evaluate(`document.querySelector('[aria-label="Expand sidebar"]').click()`)

    // A long list must scroll while the pointer stays at the viewport edge.
    for (let index = 0; index < 15; index++) {
      const result = await evaluate(
        `window.chromaShift.createProfile('Scroll fixture ${index + 1}')`
      )
      if (!result.ok) throw new Error('Could not create scrolling fixture.')
      created.push(result.value.id)
    }
    await expectOrder([...down, ...created.slice(3)])
    const viewport = await evaluate(`(() => {
      const viewport = document.querySelector('[data-part="profile-nav"] [data-scope="scroll-area"][data-part="viewport"]')
      viewport.scrollTop = 0
      const rect = viewport.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.bottom - 5 }
    })()`)
    await startDrag(beta, viewport)
    await waitForExpression(
      debuggerClient,
      `document.querySelector('[data-part="profile-nav"] [data-scope="scroll-area"][data-part="viewport"]').scrollTop > 80`,
      'Holding a drag at the bottom edge did not scroll the profile list.'
    )
    await key('Escape')
    await mouse('mouseReleased', viewport)
    await expectOrder([...down, ...created.slice(3)])
    await evaluate(
      `document.querySelector('[data-part="profile-nav"] [data-scope="scroll-area"][data-part="viewport"]').scrollTop = 0`
    )

    const unchanged = await evaluate(`(async () => {
      const state = await window.chromaShift.getState()
      return state.ok &&
        document.querySelector('[data-part="profile-select"][aria-current="page"]')?.closest('[data-reorder-id]')?.dataset.reorderId === ${JSON.stringify(original.selected)} &&
        JSON.stringify(state.value.activation.mode) === ${JSON.stringify(JSON.stringify(original.mode))} &&
        JSON.stringify(state.value.preview) === ${JSON.stringify(JSON.stringify(original.preview))} &&
        document.querySelector('[data-dragging]') === null && document.body.style.cursor !== 'grabbing' &&
        document.querySelector('[data-reorder-id="default"] [data-part="profile-reorder-handle"]') === null
    })()`)
    if (!unchanged)
      throw new Error(
        'Reordering changed selection, activation, preview, or left drag state behind.'
      )
  } finally {
    await key('Escape')
    for (const id of created) {
      await removeFixture(id)
    }
    await expectOrder(original.ids)
    await evaluate(
      `document.querySelector('[data-part="profile-nav"] [data-scope="scroll-area"][data-part="viewport"]').scrollTop = 0`
    )
    await debuggerClient.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 500, y: 10 })
    await focusNativeApp(processId, false)
  }
  globalThis.console.log(
    'Profile reorder: pointer, keyboard, cancellation, collapsed sidebar, persistence, and edge scrolling passed.'
  )
}
