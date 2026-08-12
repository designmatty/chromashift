import { describe, expect, it } from 'vitest'
import type { ProfileConfiguration } from '../profiles/configuration.js'
import type { ColorProfile } from '../profiles/model.js'
import {
  ActivationResolver,
  automaticActivationMode,
  manualActivationMode,
  selectActivation,
  type ActivationContext
} from './activation-resolver.js'

function profile(
  id: string,
  executableName?: string,
  enabled = true
): ColorProfile {
  return {
    id,
    name: id,
    enabled,
    applications: executableName === undefined ? [] : [{ executableName }],
    displays: []
  }
}

function configuration(
  profiles: ColorProfile[],
  defaultProfileId: string | null = null
): ProfileConfiguration {
  return {
    schemaVersion: 2,
    profiles,
    settings: { defaultProfileId }
  }
}

function context(
  config: ProfileConfiguration,
  executable: string | null = null
): ActivationContext {
  return {
    configuration: config,
    foregroundApplication:
      executable === null ? null : { executable, path: null },
    mode: automaticActivationMode
  }
}

describe('activation selection', () => {
  it('selects baseline when no enabled profile applies', () => {
    expect(selectActivation(context(configuration([])))).toEqual({
      target: { kind: 'baseline' },
      reason: 'baseline'
    })
  })

  it('selects the default profile when no foreground profile matches', () => {
    const config = configuration([profile('default'), profile('gaming', 'Game.exe')], 'default')
    expect(selectActivation(context(config, 'Browser.exe'))).toEqual({
      target: { kind: 'profile', profileId: 'default' },
      reason: 'defaultProfile'
    })
  })

  it('selects a foreground profile ahead of the default', () => {
    const config = configuration([profile('default'), profile('gaming', 'Game.exe')], 'default')
    expect(selectActivation(context(config, 'Game.exe'))).toEqual({
      target: { kind: 'profile', profileId: 'gaming' },
      reason: 'foregroundApplication'
    })
  })

  it('selects a manual override ahead of foreground and default profiles', () => {
    const config = configuration(
      [profile('default'), profile('gaming', 'Game.exe'), profile('accurate')],
      'default'
    )
    expect(
      selectActivation({
        ...context(config, 'Game.exe'),
        mode: manualActivationMode('accurate')
      })
    ).toEqual({
      target: { kind: 'profile', profileId: 'accurate' },
      reason: 'manualOverride'
    })
  })

  it('falls back to automatic resolution for a missing or disabled manual override', () => {
    const config = configuration(
      [profile('default'), profile('disabled', undefined, false)],
      'default'
    )
    expect(
      selectActivation({ ...context(config), mode: manualActivationMode('disabled') })
    ).toMatchObject({ reason: 'defaultProfile' })
    expect(
      selectActivation({ ...context(config), mode: manualActivationMode('missing') })
    ).toMatchObject({ reason: 'defaultProfile' })
  })
})

describe('activation transitions', () => {
  const config = configuration(
    [profile('default'), profile('game-a', 'GameA.exe'), profile('game-b', 'GameB.exe'), profile('manual')],
    'default'
  )

  it('returns from a manual override to automatic matching', () => {
    const resolver = new ActivationResolver()
    resolver.resolve({ ...context(config, 'GameA.exe'), mode: manualActivationMode('manual') })

    expect(resolver.resolve(context(config, 'GameA.exe'))).toMatchObject({
      target: { kind: 'profile', profileId: 'game-a' },
      reason: 'foregroundApplication',
      changed: true,
      previousTarget: { kind: 'profile', profileId: 'manual' }
    })
  })

  it('marks Profile A to Profile B as a change', () => {
    const resolver = new ActivationResolver()
    resolver.resolve(context(config, 'GameA.exe'))
    expect(resolver.resolve(context(config, 'GameB.exe'))).toMatchObject({
      target: { kind: 'profile', profileId: 'game-b' },
      changed: true,
      previousTarget: { kind: 'profile', profileId: 'game-a' }
    })
  })

  it('suppresses a duplicate foreground event for the active profile', () => {
    const resolver = new ActivationResolver()
    expect(resolver.resolve(context(config, 'GameA.exe')).changed).toBe(true)
    expect(resolver.resolve(context(config, 'GameA.exe')).changed).toBe(false)
  })

  it('resolves rapid events in arrival order without retaining stale state', () => {
    const resolver = new ActivationResolver()
    const profileIds = ['GameA.exe', 'Browser.exe', 'GameB.exe', 'GameA.exe'].map(
      (executable) => {
        const target = resolver.resolve(context(config, executable)).target
        return target.kind === 'profile' ? target.profileId : 'baseline'
      }
    )

    expect(profileIds).toEqual(['game-a', 'default', 'game-b', 'game-a'])
    expect(resolver.currentTarget).toEqual({ kind: 'profile', profileId: 'game-a' })
  })

  it('can reset deduplication after external restoration', () => {
    const resolver = new ActivationResolver()
    resolver.resolve(context(config, 'GameA.exe'))
    resolver.reset()

    expect(resolver.resolve(context(config, 'GameA.exe')).changed).toBe(true)
  })
})
