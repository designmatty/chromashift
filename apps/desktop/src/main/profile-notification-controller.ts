import type { ColorProfile, ProfileRepository } from '@chromashift/core'
import type { AppSettings } from '../shared/product-api.js'
import type { CompletedActivationOutcome } from './automatic-activation-controller.js'

export interface ProductNotification {
  title: string
  body: string
  severity: 'information' | 'warning' | 'error'
  urgency: 'normal' | 'critical' | 'low'
  onClick(): void
}

export interface ProductNotificationPort {
  isSupported(): boolean
  show(message: ProductNotification): void
}

export class ProfileNotificationController {
  public constructor(
    private readonly repository: ProfileRepository,
    private readonly getSettings: () => AppSettings,
    private readonly notifications: ProductNotificationPort,
    private readonly openProfile: (profileId: string | null) => void
  ) {}

  public async handle(outcome: CompletedActivationOutcome): Promise<void> {
    if (!this.notifications.isSupported()) return
    if (!this.#shouldNotify(outcome)) return

    const profiles = await this.repository.list()
    const selected = this.#selectedProfile(outcome, profiles)
    const profileId = selected?.id ?? null
    const label =
      outcome.resolution?.target.kind === 'baseline'
        ? 'Original settings'
        : (selected?.name ?? 'Selected profile')
    this.notifications.show({
      ...this.#describeOutcome(outcome, label),
      onClick: () => this.openProfile(profileId)
    })
  }

  #shouldNotify(outcome: CompletedActivationOutcome): boolean {
    if (outcome.origin === 'originalSettingsRestore') return true
    if (
      outcome.origin === 'pause' ||
      outcome.origin === 'safetyRetry' ||
      outcome.origin === 'resume' ||
      outcome.origin === 'statusControl'
    )
      return true
    if (outcome.source === 'shortcut' && outcome.origin === 'shortcut') return true
    if (!this.getSettings().profileChangeNotifications) return false
    if (
      outcome.origin === 'startup' ||
      outcome.origin === 'configurationChange' ||
      outcome.origin === 'topologyChange' ||
      outcome.origin === 'previewRollback'
    ) {
      return false
    }
    return outcome.resolution?.changed === true
  }

  #selectedProfile(
    outcome: CompletedActivationOutcome,
    profiles: readonly ColorProfile[]
  ): ColorProfile | null {
    const target = outcome.resolution?.target
    if (target === undefined || target.kind === 'baseline') return null
    return (
      profiles.find((profile) => profile.id.toLowerCase() === target.profileId.toLowerCase()) ??
      null
    )
  }

  #describeOutcome(
    outcome: CompletedActivationOutcome,
    label: string
  ): Omit<ProductNotification, 'onClick'> {
    if (outcome.origin === 'originalSettingsRestore') {
      if (outcome.status === 'failed' || outcome.status === 'partialFailure') {
        return {
          title: 'Original settings were not fully restored',
          body: `${outcome.failures.length} display operation${outcome.failures.length === 1 ? '' : 's'} failed.`,
          severity: 'error',
          urgency: 'critical'
        }
      }
      if (outcome.deferredDisplayIds.length > 0) {
        return {
          title: 'Original settings restoration is waiting',
          body: `${outcome.deferredDisplayIds.length} display${outcome.deferredDisplayIds.length === 1 ? ' is' : 's are'} not currently restorable.`,
          severity: 'warning',
          urgency: 'critical'
        }
      }
      return {
        title: 'Original settings restored',
        body: 'ChromaShift remains active.',
        severity: 'information',
        urgency: 'normal'
      }
    }

    if (outcome.origin === 'pause' || outcome.origin === 'safetyRetry') {
      const unsafeCount = outcome.failures.length + outcome.deferredDisplayIds.length
      if (unsafeCount > 0 || outcome.status === 'failed' || outcome.status === 'partialFailure') {
        const count = unsafeCount || 1
        return {
          title: 'ChromaShift safety blocked',
          body: `${count} display${count === 1 ? '' : 's'} could not be restored safely.`,
          severity: 'error',
          urgency: 'critical'
        }
      }
      return {
        title: outcome.origin === 'pause' ? 'ChromaShift paused' : 'Safety check complete',
        body:
          outcome.origin === 'pause'
            ? 'Original settings restored.'
            : 'ChromaShift is paused. Original settings restored.',
        severity: 'information',
        urgency: 'normal'
      }
    }

    if (outcome.origin === 'resume') {
      if (outcome.failures.some((failure) => failure.operation === 'control')) {
        return {
          title: 'ChromaShift remains Safety blocked',
          body: 'Resume could not complete. Retry the safety check.',
          severity: 'error',
          urgency: 'critical'
        }
      }
      if (outcome.status === 'failed' || outcome.status === 'partialFailure') {
        return {
          title: 'ChromaShift resumed with errors',
          body: `${outcome.failures.length} display operation${outcome.failures.length === 1 ? '' : 's'} failed.`,
          severity: 'warning',
          urgency: 'critical'
        }
      }
      if (outcome.deferredDisplayIds.length > 0) {
        return {
          title: 'ChromaShift active',
          body: `${label} is waiting on ${outcome.deferredDisplayIds.length} display${outcome.deferredDisplayIds.length === 1 ? '' : 's'}.`,
          severity: 'information',
          urgency: 'normal'
        }
      }
      return {
        title: 'ChromaShift active',
        body: `${label} applied.`,
        severity: 'information',
        urgency: 'normal'
      }
    }

    const selected = this.#sourceDescription(outcome, false)
    if (outcome.status === 'failed' || outcome.status === 'partialFailure') {
      const count = outcome.failures.length
      const deferred = outcome.deferredDisplayIds.length
      const deferredText =
        deferred === 0
          ? ''
          : ` ${deferred} display${deferred === 1 ? ' was' : 's were'} also deferred.`
      return {
        title: `${label} was not fully applied`,
        body: `${selected} ${count} display operation${count === 1 ? '' : 's'} failed.${deferredText}`,
        severity: outcome.status === 'failed' ? 'error' : 'warning',
        urgency: 'critical'
      }
    }

    if (outcome.source === 'shortcut' && outcome.resolution?.changed === false) {
      return {
        title: `${label} already selected`,
        body: 'Shortcut did not change the selected target.',
        severity: 'information',
        urgency: 'low'
      }
    }

    const deferredCount = outcome.deferredDisplayIds.length
    if (outcome.status === 'skipped' && deferredCount > 0) {
      return {
        title: `${label} selected`,
        body: `${selected} Waiting for ${deferredCount} compatible display${deferredCount === 1 ? '' : 's'}.`,
        severity: 'information',
        urgency: 'normal'
      }
    }
    if (deferredCount > 0) {
      return {
        title: `${label} partially applied`,
        body: `${selected} ${deferredCount} display${deferredCount === 1 ? ' was' : 's were'} deferred.`,
        severity: 'information',
        urgency: 'normal'
      }
    }
    return {
      title: `${label} activated`,
      body: this.#sourceDescription(outcome, true),
      severity: 'information',
      urgency: 'normal'
    }
  }

  #sourceDescription(outcome: CompletedActivationOutcome, activated: boolean): string {
    if (!activated) {
      if (outcome.source === 'automatic') return 'Selected automatically.'
      if (outcome.source === 'shortcut') return 'Selected by shortcut.'
      return 'Selected manually.'
    }
    if (outcome.source === 'automatic') return 'Activated automatically.'
    if (outcome.source === 'shortcut') return 'Activated by shortcut.'
    return 'Selected manually.'
  }
}
