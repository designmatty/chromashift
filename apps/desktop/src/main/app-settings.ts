import { readFile } from 'node:fs/promises'
import {
  appSettingsSchema,
  legacyAppSettingsSchema,
  type AppSettings
} from '../shared/product-api.js'
import { AppDataProfileConfigurationStorage } from './profile-configuration-storage.js'

export const defaultAppSettings: AppSettings = {
  schemaVersion: 1,
  launchAtStartup: false,
  launchBehavior: 'tray',
  closeBehavior: 'tray',
  theme: 'system',
  profileChangeNotifications: false,
  shortcutBindings: [],
  chromaShiftStatus: 'active',
  pendingControlOperation: null,
  intendedActivationMode: { kind: 'automatic' },
  intendedTarget: null
}

export class AppSettingsRepository {
  #settings: AppSettings | null = null
  #writeTail: Promise<void> = Promise.resolve()
  #saveRevision = 0

  public constructor(private readonly filePath: string) {}

  public async get(): Promise<AppSettings> {
    if (this.#settings !== null) return { ...this.#settings }
    try {
      const persisted: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      const current = appSettingsSchema.safeParse(persisted)
      if (current.success) {
        this.#settings = current.data
      } else {
        if (typeof persisted === 'object' && persisted !== null && 'schemaVersion' in persisted) {
          throw current.error
        }
        const legacy = legacyAppSettingsSchema.parse(persisted)
        this.#settings = appSettingsSchema.parse({
          schemaVersion: 1,
          ...legacy,
          profileChangeNotifications: false,
          shortcutBindings: [],
          chromaShiftStatus: 'active',
          pendingControlOperation: null,
          intendedActivationMode: { kind: 'automatic' },
          intendedTarget: null
        })
        await new AppDataProfileConfigurationStorage(this.filePath).write(
          `${JSON.stringify(this.#settings, null, 2)}\n`
        )
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      this.#settings = { ...defaultAppSettings }
    }
    return { ...this.#settings }
  }

  public async save(settings: AppSettings): Promise<AppSettings> {
    const validated = appSettingsSchema.parse(settings)
    const previous = this.#settings
    const revision = ++this.#saveRevision
    // Readers must observe the newest full snapshot while its serialized atomic
    // write is pending, otherwise a concurrent UI settings change can erase
    // freshly captured window geometry.
    this.#settings = validated
    const write = this.#writeTail.then(() =>
      new AppDataProfileConfigurationStorage(this.filePath).write(
        `${JSON.stringify(validated, null, 2)}\n`
      )
    )
    this.#writeTail = write.then(
      () => undefined,
      () => undefined
    )
    try {
      await write
    } catch (error) {
      if (revision === this.#saveRevision) this.#settings = previous
      throw error
    }
    return { ...validated }
  }
}
