import { readFile } from 'node:fs/promises'
import { appSettingsSchema, type AppSettings } from '../shared/product-api.js'
import { AppDataProfileConfigurationStorage } from './profile-configuration-storage.js'

export const defaultAppSettings: AppSettings = {
  launchAtStartup: false,
  launchBehavior: 'tray',
  closeBehavior: 'tray',
  theme: 'system'
}

export class AppSettingsRepository {
  #settings: AppSettings | null = null

  public constructor(private readonly filePath: string) {}

  public async get(): Promise<AppSettings> {
    if (this.#settings !== null) return { ...this.#settings }
    try {
      this.#settings = appSettingsSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      this.#settings = { ...defaultAppSettings }
    }
    return { ...this.#settings }
  }

  public async save(settings: AppSettings): Promise<AppSettings> {
    const validated = appSettingsSchema.parse(settings)
    await new AppDataProfileConfigurationStorage(this.filePath)
      .write(`${JSON.stringify(validated, null, 2)}\n`)
    this.#settings = validated
    return { ...validated }
  }
}
