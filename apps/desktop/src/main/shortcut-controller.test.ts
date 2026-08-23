import { JsonProfileRepository, type ActivationTarget } from '@chromashift/core'
import { describe, expect, it, vi } from 'vitest'
import type { ShortcutAction, ShortcutBinding } from '../shared/product-api.js'
import type { CompletedActivationOutcome } from './automatic-activation-controller.js'
import {
  ShortcutController,
  ShortcutRegistrationError,
  type ShortcutActivationPort,
  type ShortcutRegistrationPort
} from './shortcut-controller.js'

class MemoryStorage {
  public contents: string | null = null
  public read(): Promise<string | null> {
    return Promise.resolve(this.contents)
  }
  public write(contents: string): Promise<void> {
    this.contents = contents
    return Promise.resolve()
  }
}

class RecordingRegistrations implements ShortcutRegistrationPort {
  public readonly registered = new Map<string, () => void>()
  public rejected = new Set<string>()

  public register(accelerator: string, callback: () => void): boolean {
    if (this.rejected.has(accelerator)) return false
    this.registered.set(accelerator, callback)
    return true
  }

  public unregister(accelerator: string): void {
    this.registered.delete(accelerator)
  }
}

const outcome: CompletedActivationOutcome = {
  status: 'activated',
  resolution: null,
  failures: [],
  deferredDisplayIds: [],
  source: 'shortcut',
  origin: 'shortcut'
}

function binding(action: ShortcutAction, accelerator: string): ShortcutBinding {
  return { action, accelerator }
}

function createActivation(): ShortcutActivationPort & {
  selected: string[]
  automaticSelections: number
  toggleSelections: number
  currentTarget: ActivationTarget | null
} {
  return {
    selected: [],
    automaticSelections: 0,
    toggleSelections: 0,
    currentTarget: null,
    selectManualProfile(profileId) {
      this.selected.push(profileId)
      this.currentTarget = { kind: 'profile', profileId }
      return Promise.resolve(outcome)
    },
    enableAutomatic() {
      this.automaticSelections += 1
      return Promise.resolve(outcome)
    },
    toggleChromaShift() {
      this.toggleSelections += 1
      return Promise.resolve(outcome)
    }
  }
}

describe('ShortcutController registration', () => {
  it('normalizes bindings and restores the complete previous set when a candidate fails', () => {
    const registrations = new RecordingRegistrations()
    const controller = new ShortcutController(
      registrations,
      new JsonProfileRepository(new MemoryStorage()),
      createActivation(),
      () => undefined,
      { write: () => undefined }
    )
    controller.replace([
      binding({ kind: 'defaultProfile' }, 'ctrl+shift+d'),
      binding({ kind: 'automatic' }, 'Alt+Control+A')
    ])
    registrations.rejected.add('CommandOrControl+Shift+N')

    expect(() =>
      controller.replace([
        binding({ kind: 'nextProfile' }, 'control+shift+n'),
        binding({ kind: 'previousProfile' }, 'control+shift+p')
      ])
    ).toThrow(ShortcutRegistrationError)
    expect([...registrations.registered.keys()]).toEqual([
      'CommandOrControl+Shift+D',
      'CommandOrControl+Alt+A'
    ])
    expect(controller.bindings).toEqual([
      binding({ kind: 'defaultProfile' }, 'CommandOrControl+Shift+D'),
      binding({ kind: 'automatic' }, 'CommandOrControl+Alt+A')
    ])
  })

  it('registers Windows and Shift modifiers', () => {
    const registrations = new RecordingRegistrations()
    const controller = new ShortcutController(
      registrations,
      new JsonProfileRepository(new MemoryStorage()),
      createActivation(),
      () => undefined,
      { write: () => undefined }
    )

    controller.replace([
      binding({ kind: 'defaultProfile' }, 'Windows+D'),
      binding({ kind: 'automatic' }, 'Shift+F9')
    ])

    expect([...registrations.registered.keys()]).toEqual(['Super+D', 'Shift+F9'])
  })

  it('rejects duplicates, modifier-only bindings, and the fixed emergency shortcut', () => {
    const controller = new ShortcutController(
      new RecordingRegistrations(),
      new JsonProfileRepository(new MemoryStorage()),
      createActivation(),
      () => undefined,
      { write: () => undefined }
    )

    expect(() =>
      controller.replace([
        binding({ kind: 'defaultProfile' }, 'Ctrl+Shift+D'),
        binding({ kind: 'automatic' }, 'Control+Shift+D')
      ])
    ).toThrow('Return to Automatic (CommandOrControl+Shift+D) conflicts with Default')
    expect(() => controller.replace([binding({ kind: 'automatic' }, 'Control+Shift')])).toThrow(
      'non-modifier'
    )
    expect(() =>
      controller.replace([binding({ kind: 'defaultProfile' }, 'CommandOrControl+Alt+Shift+R')])
    ).toThrow('reserved for emergency restore')

    expect(() =>
      controller.replace([binding({ kind: 'toggleChromaShift' }, 'Control+Shift')])
    ).toThrow('Toggle ChromaShift (Control+Shift)')
  })
})

describe('ShortcutController dispatch', () => {
  it('cycles Default then enabled profiles in persisted order and wraps', async () => {
    const repository = new JsonProfileRepository(new MemoryStorage())
    await repository.save({
      id: 'gaming',
      name: 'Gaming',
      enabled: true,
      applications: [],
      displays: []
    })
    await repository.save({
      id: 'disabled',
      name: 'Disabled',
      enabled: false,
      applications: [],
      displays: []
    })
    await repository.save({
      id: 'accurate',
      name: 'Accurate',
      enabled: true,
      applications: [],
      displays: []
    })
    const activation = createActivation()
    const changed = vi.fn()
    const controller = new ShortcutController(
      new RecordingRegistrations(),
      repository,
      activation,
      changed,
      { write: () => undefined }
    )

    await controller.execute({ kind: 'nextProfile' })
    await controller.execute({ kind: 'nextProfile' })
    await controller.execute({ kind: 'nextProfile' })
    await controller.execute({ kind: 'nextProfile' })
    await controller.execute({ kind: 'previousProfile' })

    expect(activation.selected).toEqual(['default', 'gaming', 'accurate', 'default', 'accurate'])
    expect(changed).toHaveBeenCalledTimes(5)
  })

  it('dispatches direct, Default, and Automatic actions through the product activation seam', async () => {
    const activation = createActivation()
    const controller = new ShortcutController(
      new RecordingRegistrations(),
      new JsonProfileRepository(new MemoryStorage()),
      activation,
      () => undefined,
      { write: () => undefined }
    )

    await controller.execute({ kind: 'profile', profileId: 'gaming' })
    await controller.execute({ kind: 'defaultProfile' })
    await controller.execute({ kind: 'automatic' })
    await controller.execute({ kind: 'toggleChromaShift' })

    expect(activation.selected).toEqual(['gaming', 'default'])
    expect(activation.automaticSelections).toBe(1)
    expect(activation.toggleSelections).toBe(1)
  })
})
