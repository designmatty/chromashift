import { describe, expect, it, vi } from 'vitest'
import { HoldToCompare, listenForCompareRelease } from '@/features/profiles/hold-to-compare.js'

function fixture() {
  const changed = vi.fn()
  const restore = vi.fn<() => Promise<void>>(async () => undefined)
  const start = vi.fn(() => restore)
  const compare = new HoldToCompare(changed)
  const window = new EventTarget()
  const unmount = listenForCompareRelease(window, (input) => compare.release(input))
  return { compare, changed, restore, start, window, unmount }
}

describe('hold to compare', () => {
  it.each(['pointerup', 'pointercancel', 'blur'])('releases on %s anywhere', async (event) => {
    const f = fixture()
    f.compare.press('pointer', f.start)
    f.window.dispatchEvent(new Event(event))
    await f.compare.release()
    expect(f.restore).toHaveBeenCalledOnce()
    expect(f.changed.mock.calls).toEqual([[true], [false]])
    f.unmount()
  })

  it('restores on unmount and removes its listeners', async () => {
    const f = fixture()
    f.compare.press('pointer', f.start)
    f.unmount()
    await f.compare.release()
    expect(f.restore).toHaveBeenCalledOnce()
    f.compare.press('pointer', f.start)
    f.window.dispatchEvent(new Event('blur'))
    expect(f.restore).toHaveBeenCalledOnce()
    await f.compare.release()
  })

  it('ignores double presses, repeats and a new press while restoration is in flight', async () => {
    const f = fixture()
    let finish!: () => void
    f.restore.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    f.compare.press(' ', f.start)
    f.compare.press(' ', f.start)
    f.compare.press('pointer', f.start)
    const release = f.compare.release(' ')
    f.compare.press('Enter', f.start)
    expect(f.compare.showingSaved).toBe(true)
    expect(f.start).toHaveBeenCalledOnce()
    expect(f.changed.mock.calls).toEqual([[true]])
    finish()
    await release
    expect(f.compare.showingSaved).toBe(false)
    expect(f.changed.mock.calls).toEqual([[true], [false]])
    f.unmount()
  })

  it.each([' ', 'Enter'] as const)('releases the matching %s key only', async (key) => {
    const f = fixture()
    const keyup = (value: string) => Object.assign(new Event('keyup'), { key: value })
    f.window.dispatchEvent(keyup(key))
    expect(f.restore).not.toHaveBeenCalled()
    f.compare.press(key, f.start)
    f.window.dispatchEvent(new Event('pointerup'))
    f.window.dispatchEvent(keyup('Escape'))
    expect(f.restore).not.toHaveBeenCalled()
    f.window.dispatchEvent(keyup(key))
    await f.compare.release()
    expect(f.restore).toHaveBeenCalledOnce()
    f.unmount()
  })
})
