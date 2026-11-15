export type CompareInput = 'pointer' | ' ' | 'Enter'

/** A release is idempotent and keeps saved values visible until draft writes drain. */
export class HoldToCompare {
  #input: CompareInput | null = null
  #restore: (() => Promise<void>) | null = null
  #releasing: Promise<void> | null = null

  public constructor(private readonly onShowingSaved: (showing: boolean) => void) {}

  public get showingSaved(): boolean {
    return this.#restore !== null || this.#releasing !== null
  }

  /** `start` returns null when nothing will be written; the press then shows nothing. */
  public press(input: CompareInput, start: () => (() => Promise<void>) | null): void {
    if (this.#restore !== null || this.#releasing !== null) return
    const restore = start()
    if (restore === null) return
    this.#input = input
    this.#restore = restore
    this.onShowingSaved(true)
  }

  public release(input?: CompareInput): Promise<void> {
    if (input !== undefined && input !== this.#input) return Promise.resolve()
    if (this.#releasing !== null) return this.#releasing
    const restore = this.#restore
    if (restore === null) return Promise.resolve()
    this.#input = null
    this.#restore = null
    this.#releasing = restore().finally(() => {
      this.#releasing = null
      this.onShowingSaved(false)
    })
    return this.#releasing
  }
}

/** Window capture covers releases outside the button, including lost focus. */
export function listenForCompareRelease(
  target: EventTarget,
  release: (input?: CompareInput) => Promise<void>
): () => void {
  const pointer = (): void => {
    void release('pointer')
  }
  const key = (event: Event): void => {
    const { key } = event as KeyboardEvent
    if (key === ' ' || key === 'Enter') void release(key)
  }
  const blur = (): void => {
    void release()
  }
  target.addEventListener('pointerup', pointer, true)
  target.addEventListener('pointercancel', pointer, true)
  target.addEventListener('keyup', key, true)
  target.addEventListener('blur', blur)
  return () => {
    target.removeEventListener('pointerup', pointer, true)
    target.removeEventListener('pointercancel', pointer, true)
    target.removeEventListener('keyup', key, true)
    target.removeEventListener('blur', blur)
    void release()
  }
}
