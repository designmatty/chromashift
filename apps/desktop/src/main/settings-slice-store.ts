import { readFile } from 'node:fs/promises'
import type { z } from 'zod'
import { AppDataProfileConfigurationStorage } from './profile-configuration-storage.js'

/**
 * One persisted settings slice: a single JSON document with one owner concern.
 * All writes go through update(), which serializes read-modify-write cycles on
 * an internal queue, so concurrent writers within a slice cannot clobber each
 * other and no cross-slice coordination exists at all. A missing file yields
 * the defaults; an invalid file fails loudly rather than being replaced.
 */
export class SettingsSliceStore<T> {
  #value: T | null = null
  #loaded: Promise<void> | null = null
  #tail: Promise<unknown> = Promise.resolve()

  public constructor(
    private readonly filePath: string,
    private readonly schema: z.ZodType<T>,
    private readonly defaults: T
  ) {}

  /** The latest known value; the defaults until load() has completed. */
  public get current(): T {
    return structuredClone(this.#value ?? this.defaults)
  }

  public async load(): Promise<T> {
    await this.#ensureLoaded()
    return this.current
  }

  public async update(updater: (current: T) => T): Promise<T> {
    const write = this.#tail.then(async () => {
      await this.#ensureLoaded()
      const next = this.schema.parse(updater(this.current))
      await new AppDataProfileConfigurationStorage(this.filePath).write(
        `${JSON.stringify(next, null, 2)}\n`
      )
      this.#value = next
      return next
    })
    this.#tail = write.then(
      () => undefined,
      () => undefined
    )
    return structuredClone(await write)
  }

  async #ensureLoaded(): Promise<void> {
    this.#loaded ??= this.#read()
    await this.#loaded
  }

  async #read(): Promise<void> {
    try {
      const persisted: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      this.#value = this.schema.parse(persisted)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        this.#loaded = null
        throw error
      }
      this.#value = structuredClone(this.defaults)
    }
  }
}
