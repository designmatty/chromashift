/**
 * Holds the latest main-process request until a renderer listener subscribes.
 *
 * Electron main sends app-panel navigation on `did-finish-load`, but a freshly
 * created app-panel renderer only subscribes after DisplayService connects and
 * the lazy app chunk mounts. The preload registers its IPC listener immediately
 * and relays through this buffer so that request is applied on mount instead of
 * being dropped in favor of the remembered view.
 */
export class LatestEventRelay<T> {
  #listener: ((value: T) => void) | undefined
  #pending: { value: T } | undefined

  public publish(value: T): void {
    if (this.#listener !== undefined) {
      this.#listener(value)
      return
    }
    this.#pending = { value }
  }

  public subscribe(listener: (value: T) => void): void {
    this.#listener = listener
    const pending = this.#pending
    if (pending === undefined) return
    this.#pending = undefined
    listener(pending.value)
  }
}
