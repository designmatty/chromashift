import {
  DEFAULT_PROFILE_ID,
  type ActivationTarget,
  type ProfileRepository
} from '@chromashift/core'
import {
  type ShortcutAction,
  type ShortcutBinding
} from '../shared/product-api.js'
import { EMERGENCY_RESTORE_ACCELERATOR } from '../shared/shortcut-constants.js'
import type { CompletedActivationOutcome } from './automatic-activation-controller.js'
import { describeError, type StructuredLogger } from './structured-logger.js'

export { EMERGENCY_RESTORE_ACCELERATOR }

export interface ShortcutRegistrationPort {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface ShortcutActivationPort {
  readonly currentTarget: ActivationTarget | null
  selectManualProfile(profileId: string): Promise<CompletedActivationOutcome>
  enableAutomatic(): Promise<CompletedActivationOutcome>
  toggleChromaShift(): Promise<CompletedActivationOutcome>
}

export class ShortcutValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ShortcutValidationError'
  }
}

export class ShortcutRegistrationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ShortcutRegistrationError'
  }
}

export class ShortcutController {
  #bindings: ShortcutBinding[] = []
  #dispatchQueue = Promise.resolve()

  public constructor(
    private readonly registrations: ShortcutRegistrationPort,
    private readonly repository: ProfileRepository,
    private readonly activation: ShortcutActivationPort,
    private readonly stateChanged: () => void | Promise<void>,
    private readonly logger: StructuredLogger
  ) {}

  public get bindings(): ShortcutBinding[] {
    return this.#bindings.map((binding) => ({
      action: { ...binding.action },
      accelerator: binding.accelerator
    }))
  }

  public replace(candidateBindings: readonly ShortcutBinding[]): () => void {
    const candidate = normalizeBindings(candidateBindings)
    const previous = this.bindings

    this.#unregister(previous)
    try {
      this.#register(candidate)
      this.#bindings = candidate
    } catch (error) {
      this.#unregister(candidate)
      this.#register(previous)
      this.#bindings = previous
      throw error
    }

    return () => {
      this.#unregister(this.#bindings)
      this.#register(previous)
      this.#bindings = previous
    }
  }

  public dispose(): void {
    this.#unregister(this.#bindings)
    this.#bindings = []
  }

  public async execute(action: ShortcutAction): Promise<CompletedActivationOutcome> {
    let outcome: CompletedActivationOutcome
    switch (action.kind) {
      case 'defaultProfile':
        outcome = await this.activation.selectManualProfile(DEFAULT_PROFILE_ID)
        break
      case 'profile':
        outcome = await this.activation.selectManualProfile(action.profileId)
        break
      case 'automatic':
        outcome = await this.activation.enableAutomatic()
        break
      case 'previousProfile':
        outcome = await this.activation.selectManualProfile(await this.#adjacentProfileId(-1))
        break
      case 'nextProfile':
        outcome = await this.activation.selectManualProfile(await this.#adjacentProfileId(1))
        break
      case 'toggleChromaShift':
        outcome = await this.activation.toggleChromaShift()
        break
    }
    await this.stateChanged()
    return outcome
  }

  #register(bindings: readonly ShortcutBinding[]): void {
    const registered: ShortcutBinding[] = []
    try {
      for (const binding of bindings) {
        const accepted = this.registrations.register(binding.accelerator, () => {
          this.#dispatchQueue = this.#dispatchQueue
            .then(() => this.execute(binding.action))
            .then(() => undefined)
            .catch((error: unknown) => {
              this.logger.write({
                level: 'error',
                eventName: 'ShortcutDispatchFailed',
                action: binding.action,
                accelerator: binding.accelerator,
                ...describeError(error)
              })
            })
        })
        if (!accepted) {
          throw new ShortcutRegistrationError(
            `${shortcutActionLabel(binding.action)} (${binding.accelerator}) could not be registered. It may be in use by Windows or another application.`
          )
        }
        registered.push(binding)
      }
    } catch (error) {
      this.#unregister(registered)
      if (error instanceof ShortcutRegistrationError) throw error
      throw new ShortcutRegistrationError(
        `The shortcut set could not be registered: ${describeError(error).message}`
      )
    }
  }

  #unregister(bindings: readonly ShortcutBinding[]): void {
    for (const binding of bindings) this.registrations.unregister(binding.accelerator)
  }

  async #adjacentProfileId(direction: -1 | 1): Promise<string> {
    const profileIds = (await this.repository.list())
      .filter((profile) => profile.enabled)
      .map((profile) => profile.id)
    const currentId =
      this.activation.currentTarget?.kind === 'profile'
        ? this.activation.currentTarget.profileId.toLowerCase()
        : null
    const currentIndex = profileIds.findIndex((profileId) => profileId.toLowerCase() === currentId)
    if (currentIndex < 0) return direction === 1 ? DEFAULT_PROFILE_ID : profileIds.at(-1)!
    return profileIds[(currentIndex + direction + profileIds.length) % profileIds.length]!
  }
}

export function normalizeAccelerator(accelerator: string): string {
  const tokens = accelerator
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  const modifiers = new Set<string>()
  const keys: string[] = []
  for (const token of tokens) {
    const modifier = normalizeModifier(token)
    if (modifier === null) keys.push(normalizeKey(token))
    else modifiers.add(modifier)
  }
  if (modifiers.size === 0) {
    throw new ShortcutValidationError('A shortcut must include at least one modifier key.')
  }
  if (keys.length !== 1) {
    throw new ShortcutValidationError('A shortcut must include exactly one non-modifier key.')
  }
  const ordered = ['CommandOrControl', 'Alt', 'Shift', 'Super'].filter((modifier) =>
    modifiers.has(modifier)
  )
  return [...ordered, keys[0]!].join('+')
}

function normalizeBindings(bindings: readonly ShortcutBinding[]): ShortcutBinding[] {
  const accelerators = new Map<string, string>()
  const actions = new Set<string>()
  return bindings.map((binding) => {
    const label = shortcutActionLabel(binding.action)
    let accelerator: string
    try {
      accelerator = normalizeAccelerator(binding.accelerator)
    } catch (error) {
      if (error instanceof ShortcutValidationError) {
        throw new ShortcutValidationError(`${label} (${binding.accelerator}): ${error.message}`)
      }
      throw error
    }
    if (accelerator.toLowerCase() === EMERGENCY_RESTORE_ACCELERATOR.toLowerCase()) {
      throw new ShortcutValidationError(
        `${label} (${accelerator}) cannot use the shortcut reserved for emergency restore.`
      )
    }
    const normalizedAccelerator = accelerator.toLowerCase()
    const existingAction = accelerators.get(normalizedAccelerator)
    if (existingAction !== undefined) {
      throw new ShortcutValidationError(
        `${label} (${accelerator}) conflicts with ${existingAction}, which already uses that combination.`
      )
    }
    accelerators.set(normalizedAccelerator, label)

    const action = actionKey(binding.action)
    if (actions.has(action)) {
      throw new ShortcutValidationError(`${label} can have at most one shortcut binding.`)
    }
    actions.add(action)
    return { action: { ...binding.action }, accelerator }
  })
}

function shortcutActionLabel(action: ShortcutAction): string {
  switch (action.kind) {
    case 'defaultProfile':
      return 'Default'
    case 'previousProfile':
      return 'Previous profile'
    case 'nextProfile':
      return 'Next profile'
    case 'automatic':
      return 'Return to Automatic'
    case 'toggleChromaShift':
      return 'Toggle ChromaShift'
    case 'profile':
      return `Profile ${action.profileId}`
  }
}

function actionKey(action: ShortcutAction): string {
  return action.kind === 'profile' ? `profile:${action.profileId.toLowerCase()}` : action.kind
}

function normalizeModifier(token: string): string | null {
  switch (token.toLowerCase()) {
    case 'ctrl':
    case 'control':
    case 'commandorcontrol':
    case 'cmdorctrl':
      return 'CommandOrControl'
    case 'alt':
    case 'option':
      return 'Alt'
    case 'shift':
      return 'Shift'
    case 'super':
    case 'meta':
    case 'win':
    case 'windows':
    case 'command':
      return 'Super'
    default:
      return null
  }
}

function normalizeKey(token: string): string {
  if (/^[a-z0-9]$/i.test(token)) return token.toUpperCase()
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(token)) return token.toUpperCase()
  const namedKeys: Record<string, string> = {
    backspace: 'Backspace',
    delete: 'Delete',
    down: 'Down',
    end: 'End',
    enter: 'Enter',
    escape: 'Escape',
    esc: 'Escape',
    home: 'Home',
    insert: 'Insert',
    left: 'Left',
    pagedown: 'PageDown',
    pageup: 'PageUp',
    return: 'Return',
    right: 'Right',
    space: 'Space',
    tab: 'Tab',
    up: 'Up'
  }
  const normalized = namedKeys[token.toLowerCase()]
  if (normalized !== undefined) return normalized
  throw new ShortcutValidationError(`${token} is not a supported shortcut key.`)
}
