import {
  JsonProfileRepository,
  automaticActivationMode,
  manualActivationMode,
  type ActivationTarget,
  type ColorProfile,
  type ProfileConfigurationStorage
} from '@chromashift/core'
import { describe, expect, it, vi } from 'vitest'
import type { ActivationOutcome } from './activation-coordinator.js'
import type { ActivationControllerState } from './automatic-activation-controller.js'
import type { StructuredLogger } from './structured-logger.js'
import {
  TrayController,
  createTrayReadModel,
  type TrayActivationPort,
  type TrayCommands,
  type TrayMenuPort,
  type TrayReadModel
} from './tray-controller.js'

const profiles: ColorProfile[] = [
  {
    id: 'gaming',
    name: 'Gaming',
    enabled: true,
    applications: [],
    displays: [{ displayId: 'display:one', color: { saturation: 75 } }]
  },
  {
    id: 'disabled',
    name: 'Disabled profile',
    enabled: false,
    applications: [],
    displays: []
  }
]

class MemoryStorage implements ProfileConfigurationStorage {
  public read(): Promise<string> {
    return Promise.resolve(JSON.stringify({
      schemaVersion: 2,
      profiles,
      settings: { defaultProfileId: null }
    }))
  }

  public write(): Promise<void> {
    return Promise.resolve()
  }
}

function outcome(target: ActivationTarget): ActivationOutcome {
  return {
    status: 'activated',
    resolution: {
      target,
      reason: target.kind === 'baseline' ? 'baseline' : 'manualOverride',
      changed: true,
      previousTarget: null
    },
    failures: [],
    deferredDisplayIds: []
  }
}

class FakeActivation implements TrayActivationPort {
  public state: ActivationControllerState = {
    enabled: true,
    mode: automaticActivationMode,
    currentTarget: { kind: 'profile', profileId: 'gaming' }
  }
  public readonly calls: string[] = []
  readonly #listeners = new Set<(state: ActivationControllerState) => void>()

  public subscribe(listener: (state: ActivationControllerState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  public enableAutomatic(): Promise<ActivationOutcome> {
    this.calls.push('automatic')
    this.state = { ...this.state, mode: automaticActivationMode }
    this.#emit()
    return Promise.resolve(outcome(this.state.currentTarget ?? { kind: 'baseline' }))
  }

  public selectManualProfile(profileId: string): Promise<ActivationOutcome> {
    this.calls.push(`profile:${profileId}`)
    const target = { kind: 'profile' as const, profileId }
    this.state = { ...this.state, mode: manualActivationMode(profileId), currentTarget: target }
    this.#emit()
    return Promise.resolve(outcome(target))
  }

  public restoreBaseline(): Promise<ActivationOutcome> {
    this.calls.push('baseline')
    const target = { kind: 'baseline' as const }
    this.state = { ...this.state, currentTarget: target }
    this.#emit()
    return Promise.resolve(outcome(target))
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.state)
  }
}

class FakeMenu implements TrayMenuPort {
  public model: TrayReadModel | undefined
  public commands: TrayCommands | undefined
  public readonly errors: Array<{ title: string; message: string }> = []
  public destroyed = false

  public update(model: TrayReadModel, commands: TrayCommands): void {
    this.model = model
    this.commands = commands
  }

  public showError(title: string, message: string): void {
    this.errors.push({ title, message })
  }

  public destroy(): void {
    this.destroyed = true
  }
}

const logger: StructuredLogger = { write: () => undefined }

describe('tray read model', () => {
  it('shows the current target, automatic mode, and enabled profile choices', () => {
    const model = createTrayReadModel(profiles, {
      enabled: true,
      mode: automaticActivationMode,
      currentTarget: { kind: 'profile', profileId: 'gaming' }
    })

    expect(model).toMatchObject({
      currentProfileLabel: 'Gaming',
      automaticChecked: true,
      controlsEnabled: true,
      profiles: [
        { id: 'gaming', enabled: true, checked: false },
        { id: 'disabled', enabled: false, checked: false }
      ]
    })
  })
})

describe('TrayController', () => {
  it('opens, exits, switches modes, resets, and refreshes after activation changes', async () => {
    const activation = new FakeActivation()
    const menu = new FakeMenu()
    const open = vi.fn()
    const requestExit = vi.fn(() => Promise.resolve(true))
    const controller = new TrayController(
      new JsonProfileRepository(new MemoryStorage()),
      activation,
      { open },
      { request: requestExit },
      menu,
      logger
    )
    await controller.start()

    menu.commands!.open()
    menu.commands!.selectProfile('gaming')
    await vi.waitFor(() => expect(activation.calls).toContain('profile:gaming'))
    await vi.waitFor(() => expect(menu.model?.profiles[0]?.checked).toBe(true))
    menu.commands!.enableAutomatic()
    await vi.waitFor(() => expect(menu.model?.automaticChecked).toBe(true))
    menu.commands!.resetBaseline()
    await vi.waitFor(() => expect(menu.model?.currentProfileLabel).toBe('Baseline'))
    menu.commands!.exit()

    expect(open).toHaveBeenCalledOnce()
    expect(requestExit).toHaveBeenCalledWith('tray')
    expect(activation.calls).toEqual(['profile:gaming', 'automatic', 'baseline'])
    controller.dispose()
    expect(menu.destroyed).toBe(true)
  })
})
