import type {
  ActivationMode,
  ActivationTarget,
  ColorProfile,
  ProfileRepository
} from '@chromashift/core'
import type { ActivationOutcome } from './activation-coordinator.js'
import type { ActivationControllerState } from './automatic-activation-controller.js'
import type { ChromaShiftState } from './chroma-shift-controller.js'
import { describeError, type StructuredLogger } from './structured-logger.js'

export interface TrayProfileItem {
  id: string
  name: string
  enabled: boolean
  checked: boolean
}

export interface TrayReadModel {
  chromaShiftStatusLabel: 'Active' | 'Paused' | 'Safety blocked'
  currentProfileLabel: string
  automaticEnabled: boolean
  automaticChecked: boolean
  controlsEnabled: boolean
  restoreEnabled: boolean
  controlAction: 'pause' | 'resume' | 'retry'
  profiles: TrayProfileItem[]
}

export interface TrayCommands {
  openAppPanel(): void
  openMiniPanel(): void
  exit(): void
  enableAutomatic(): void
  selectProfile(profileId: string): void
  resetBaseline(): void
  controlChromaShift(): void
}

export interface TrayMenuPort {
  update(model: TrayReadModel, commands: TrayCommands): void
  showError(title: string, message: string): void
  destroy(): void
}

export interface TrayActivationPort {
  readonly state: ActivationControllerState
  readonly chromaShiftState: ChromaShiftState
  subscribe(listener: (state: ChromaShiftState) => void): () => void
  enableAutomatic(): Promise<ActivationOutcome>
  selectManualProfile(profileId: string): Promise<ActivationOutcome>
  restoreBaseline(): Promise<ActivationOutcome>
  pause(source: 'manual'): Promise<ActivationOutcome>
  resume(source: 'manual'): Promise<ActivationOutcome>
  retrySafetyCheck(source: 'manual'): Promise<ActivationOutcome>
}

export interface PanelPort {
  openAppPanel(): void
  openMiniPanel(): void
}

export interface ShutdownRequestPort {
  request(source: 'tray'): Promise<boolean>
}

function targetLabel(target: ActivationTarget | null, profiles: readonly ColorProfile[]): string {
  if (target === null) return 'None'
  if (target.kind === 'baseline') return 'Original settings'
  return (
    profiles.find((profile) => profile.id.toLowerCase() === target.profileId.toLowerCase())?.name ??
    `Unknown (${target.profileId})`
  )
}

function isManualProfile(mode: ActivationMode, profileId: string): boolean {
  return mode.kind === 'manual' && mode.profileId.toLowerCase() === profileId.toLowerCase()
}

export function createTrayReadModel(
  profiles: readonly ColorProfile[],
  state: ActivationControllerState,
  chromaShift: ChromaShiftState
): TrayReadModel {
  const controlsEnabled = !chromaShift.transitionInProgress
  return {
    chromaShiftStatusLabel:
      chromaShift.status === 'safetyBlocked'
        ? 'Safety blocked'
        : chromaShift.status === 'paused'
          ? 'Paused'
          : 'Active',
    currentProfileLabel: targetLabel(chromaShift.intendedTarget, profiles),
    automaticEnabled: state.enabled && controlsEnabled,
    automaticChecked: chromaShift.intendedMode.kind === 'automatic',
    controlsEnabled: state.enabled && controlsEnabled,
    restoreEnabled: state.enabled && controlsEnabled && chromaShift.status === 'active',
    controlAction:
      chromaShift.status === 'safetyBlocked'
        ? 'retry'
        : chromaShift.status === 'paused'
          ? 'resume'
          : 'pause',
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      enabled: state.enabled && profile.enabled,
      checked: isManualProfile(chromaShift.intendedMode, profile.id)
    }))
  }
}

export class TrayController {
  #unsubscribe: (() => void) | undefined
  #refreshGeneration = 0
  #disposed = false

  public constructor(
    private readonly repository: ProfileRepository,
    private readonly activation: TrayActivationPort,
    private readonly panels: PanelPort,
    private readonly shutdown: ShutdownRequestPort,
    private readonly menu: TrayMenuPort,
    private readonly logger: StructuredLogger
  ) {}

  public async start(): Promise<void> {
    if (this.#unsubscribe !== undefined) return
    this.#unsubscribe = this.activation.subscribe(() => {
      void this.refresh()
    })
    await this.refresh()
  }

  public async refresh(): Promise<void> {
    const generation = ++this.#refreshGeneration
    try {
      const profiles = await this.repository.list()
      if (this.#disposed || generation !== this.#refreshGeneration) return
      this.menu.update(
        createTrayReadModel(profiles, this.activation.state, this.activation.chromaShiftState),
        this.#commands()
      )
    } catch (error) {
      this.#reportError('Tray menu could not be refreshed', error)
    }
  }

  public dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.menu.destroy()
  }

  #commands(): TrayCommands {
    return {
      openAppPanel: () => this.panels.openAppPanel(),
      openMiniPanel: () => this.panels.openMiniPanel(),
      exit: () => {
        void this.shutdown.request('tray')
      },
      enableAutomatic: () => {
        void this.#runAction('Automatic mode could not be enabled', () =>
          this.activation.enableAutomatic()
        )
      },
      selectProfile: (profileId) => {
        void this.#runAction('The profile could not be activated', () =>
          this.activation.selectManualProfile(profileId)
        )
      },
      resetBaseline: () => {
        void this.#runAction('Original display settings could not be restored', () =>
          this.activation.restoreBaseline()
        )
      },
      controlChromaShift: () => {
        const status = this.activation.chromaShiftState.status
        const title =
          status === 'safetyBlocked'
            ? 'The safety check could not be completed'
            : status === 'paused'
              ? 'ChromaShift could not be resumed'
              : 'ChromaShift could not be paused'
        void this.#runAction(title, () =>
          status === 'safetyBlocked'
            ? this.activation.retrySafetyCheck('manual')
            : status === 'paused'
              ? this.activation.resume('manual')
              : this.activation.pause('manual')
        )
      }
    }
  }

  async #runAction(title: string, action: () => Promise<ActivationOutcome>): Promise<void> {
    try {
      const outcome = await action()
      if (outcome.status === 'failed' || outcome.status === 'partialFailure') {
        const messages = outcome.failures.map((failure) => failure.message)
        throw new Error(messages.join(' ') || `Activation ended with ${outcome.status}.`)
      }
      await this.refresh()
    } catch (error) {
      this.#reportError(title, error)
    }
  }

  #reportError(title: string, error: unknown): void {
    const details = describeError(error)
    this.logger.write({
      level: 'error',
      eventName: 'TrayActionFailed',
      title,
      ...details
    })
    this.menu.showError(
      title,
      `${details.message}\n\nOpen ChromaShift for diagnostics, then retry.`
    )
  }
}
