import { JsonProfileRepository, type ProfileConfigurationStorage } from '@chromashift/core'
import { describe, expect, it, vi } from 'vitest'
import { defaultAppSettings } from './app-settings.js'
import type { CompletedActivationOutcome } from './automatic-activation-controller.js'
import {
  ProfileNotificationController,
  type ProductNotification,
  type ProductNotificationPort
} from './profile-notification-controller.js'

class MemoryStorage implements ProfileConfigurationStorage {
  public read(): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        schemaVersion: 2,
        profiles: [
          {
            id: 'gaming',
            name: 'Gaming',
            enabled: true,
            applications: [],
            displays: []
          }
        ],
        settings: { defaultProfileId: null }
      })
    )
  }

  public write(): Promise<void> {
    return Promise.resolve()
  }
}

class RecordingNotifications implements ProductNotificationPort {
  public supported = true
  public readonly messages: ProductNotification[] = []

  public isSupported(): boolean {
    return this.supported
  }

  public show(message: ProductNotification): void {
    this.messages.push(message)
  }
}

function completed(
  overrides: Partial<CompletedActivationOutcome> = {}
): CompletedActivationOutcome {
  return {
    status: 'activated',
    resolution: {
      target: { kind: 'profile', profileId: 'gaming' },
      reason: 'foregroundApplication',
      changed: true,
      previousTarget: { kind: 'baseline' }
    },
    failures: [],
    deferredDisplayIds: [],
    source: 'automatic',
    origin: 'foreground',
    ...overrides
  }
}

describe('ProfileNotificationController', () => {
  it('shows an opted-in completed transition and opens its profile when clicked', async () => {
    const notifications = new RecordingNotifications()
    const openProfile = vi.fn()
    const controller = new ProfileNotificationController(
      new JsonProfileRepository(new MemoryStorage()),
      () => ({ ...defaultAppSettings, profileChangeNotifications: true }),
      notifications,
      openProfile
    )

    await controller.handle(completed())

    expect(notifications.messages).toHaveLength(1)
    expect(notifications.messages[0]).toMatchObject({
      title: 'Gaming activated',
      body: 'Activated automatically.',
      urgency: 'normal'
    })
    notifications.messages[0]?.onClick()
    expect(openProfile).toHaveBeenCalledWith('gaming')
  })

  it('suppresses startup, duplicate, and opted-out profile transitions', async () => {
    const notifications = new RecordingNotifications()
    const repository = new JsonProfileRepository(new MemoryStorage())
    const controller = new ProfileNotificationController(
      repository,
      () => defaultAppSettings,
      notifications,
      () => undefined
    )

    await controller.handle(completed())
    await controller.handle(completed({ origin: 'startup' }))
    await controller.handle(
      completed({ resolution: { ...completed().resolution!, changed: false } })
    )

    expect(notifications.messages).toEqual([])
  })

  it('does not claim full success for failed or deferred display application', async () => {
    const notifications = new RecordingNotifications()
    const controller = new ProfileNotificationController(
      new JsonProfileRepository(new MemoryStorage()),
      () => ({ ...defaultAppSettings, profileChangeNotifications: true }),
      notifications,
      () => undefined
    )

    await controller.handle(
      completed({
        status: 'partialFailure',
        failures: [{ operation: 'apply', displayId: 'display:one', message: 'Write failed.' }]
      })
    )
    await controller.handle(completed({ deferredDisplayIds: ['display:two'] }))
    await controller.handle(
      completed({
        status: 'partialFailure',
        failures: [{ operation: 'apply', displayId: 'display:one', message: 'Write failed.' }],
        deferredDisplayIds: ['display:two']
      })
    )
    await controller.handle(
      completed({ status: 'skipped', deferredDisplayIds: ['display:one', 'display:two'] })
    )

    expect(notifications.messages).toMatchObject([
      {
        title: 'Gaming was not fully applied',
        body: 'Selected automatically. 1 display operation failed.',
        severity: 'warning'
      },
      {
        title: 'Gaming partially applied',
        body: 'Selected automatically. 1 display was deferred.',
        severity: 'information'
      },
      {
        title: 'Gaming was not fully applied',
        body: 'Selected automatically. 1 display operation failed. 1 display was also deferred.',
        severity: 'warning'
      },
      {
        title: 'Gaming selected',
        body: 'Selected automatically. Waiting for 2 compatible displays.',
        severity: 'information'
      }
    ])
  })

  it('confirms an explicit one-shot restoration even when profile notifications are off', async () => {
    const notifications = new RecordingNotifications()
    const controller = new ProfileNotificationController(
      new JsonProfileRepository(new MemoryStorage()),
      () => defaultAppSettings,
      notifications,
      () => undefined
    )

    await controller.handle(
      completed({
        resolution: {
          target: { kind: 'baseline' },
          reason: 'baseline',
          changed: true,
          previousTarget: { kind: 'profile', profileId: 'gaming' }
        },
        source: 'manual',
        origin: 'originalSettingsRestore'
      })
    )

    expect(notifications.messages).toMatchObject([
      {
        title: 'Original settings restored',
        body: 'ChromaShift remains active.',
        severity: 'information'
      }
    ])
  })

  it('confirms a same-target shortcut without claiming a transition when notifications are off', async () => {
    const notifications = new RecordingNotifications()
    const controller = new ProfileNotificationController(
      new JsonProfileRepository(new MemoryStorage()),
      () => defaultAppSettings,
      notifications,
      () => undefined
    )

    await controller.handle(
      completed({
        source: 'shortcut',
        origin: 'shortcut',
        resolution: { ...completed().resolution!, changed: false }
      })
    )

    expect(notifications.messages).toMatchObject([
      {
        title: 'Gaming already selected',
        body: 'Shortcut did not change the selected target.',
        severity: 'information',
        urgency: 'low'
      }
    ])
  })

  it('reports a failed direct shortcut instead of describing it as already selected', async () => {
    const notifications = new RecordingNotifications()
    const controller = new ProfileNotificationController(
      new JsonProfileRepository(new MemoryStorage()),
      () => defaultAppSettings,
      notifications,
      () => undefined
    )

    await controller.handle(
      completed({
        source: 'shortcut',
        origin: 'shortcut',
        status: 'failed',
        failures: [{ operation: 'control', message: 'Shortcut dispatch failed.' }],
        resolution: { ...completed().resolution!, changed: false }
      })
    )

    expect(notifications.messages).toMatchObject([
      {
        title: 'Gaming was not fully applied',
        body: 'Selected by shortcut. 1 display operation failed.',
        severity: 'error',
        urgency: 'critical'
      }
    ])
  })

  it('reports toggle pause, safety block, and resume outcomes independently of profile opt-in', async () => {
    const notifications = new RecordingNotifications()
    const controller = new ProfileNotificationController(
      new JsonProfileRepository(new MemoryStorage()),
      () => defaultAppSettings,
      notifications,
      () => undefined
    )

    await controller.handle(
      completed({
        source: 'shortcut',
        origin: 'pause',
        resolution: {
          target: { kind: 'baseline' },
          reason: 'baseline',
          changed: true,
          previousTarget: { kind: 'profile', profileId: 'gaming' }
        }
      })
    )
    await controller.handle(
      completed({
        source: 'shortcut',
        origin: 'pause',
        status: 'skipped',
        deferredDisplayIds: ['display:one'],
        resolution: {
          target: { kind: 'baseline' },
          reason: 'baseline',
          changed: true,
          previousTarget: { kind: 'profile', profileId: 'gaming' }
        }
      })
    )
    await controller.handle(
      completed({
        source: 'shortcut',
        origin: 'resume',
        status: 'failed',
        failures: [{ operation: 'control', message: 'Topology refresh failed.' }]
      })
    )
    await controller.handle(completed({ source: 'shortcut', origin: 'resume' }))

    expect(notifications.messages).toMatchObject([
      { title: 'ChromaShift paused', body: 'Original settings restored.' },
      {
        title: 'ChromaShift safety blocked',
        body: '1 display could not be restored safely.',
        urgency: 'critical'
      },
      {
        title: 'ChromaShift remains Safety blocked',
        body: 'Resume could not complete. Retry the safety check.',
        urgency: 'critical'
      },
      { title: 'ChromaShift active', body: 'Gaming applied.' }
    ])
  })
})
