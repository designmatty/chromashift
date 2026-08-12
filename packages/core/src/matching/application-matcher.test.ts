import { describe, expect, it } from 'vitest'
import type { ColorProfile } from '../profiles/model.js'
import {
  findMatchingProfile,
  matchApplicationRule,
  normalizeExecutablePath
} from './application-matcher.js'

function profile(
  id: string,
  applications: ColorProfile['applications'],
  enabled = true
): ColorProfile {
  return {
    id,
    name: id,
    enabled,
    applications,
    displays: []
  }
}

describe('application matching', () => {
  it('matches an exact executable path with Windows case normalization', () => {
    const rule = {
      executableName: 'PathOfExileSteam.exe',
      executablePath: 'C:\\Games\\Path of Exile 2\\PathOfExileSteam.exe'
    }

    expect(
      matchApplicationRule(rule, {
        executable: 'PATHOFEXILESTEAM.EXE',
        path: 'c:/games/path of exile 2/pathofexilesteam.exe'
      })
    ).toEqual({ rule, type: 'path' })
  })

  it('falls back to executable filename when the foreground path is unavailable', () => {
    const rule = {
      executableName: 'PathOfExileSteam.exe',
      executablePath: 'C:\\Games\\Path of Exile 2\\PathOfExileSteam.exe'
    }

    expect(
      matchApplicationRule(rule, {
        executable: 'pathofexilesteam.EXE',
        path: null
      })
    ).toEqual({ rule, type: 'filename' })
  })

  it('does not filename-match a different known path', () => {
    expect(
      matchApplicationRule(
        {
          executableName: 'Game.exe',
          executablePath: 'C:\\Trusted\\Game.exe'
        },
        {
          executable: 'Game.exe',
          path: 'D:\\Other\\Game.exe'
        }
      )
    ).toBeNull()
  })

  it('derives a filename from the path when executable is unavailable', () => {
    const rule = { executableName: 'Photoshop.exe' }
    expect(
      matchApplicationRule(rule, {
        executable: null,
        path: 'C:\\Adobe\\Photoshop.exe'
      })
    ).toEqual({ rule, type: 'filename' })
  })

  it('matches any of a profile’s assigned applications', () => {
    const gaming = profile('gaming', [
      { executableName: 'GameA.exe' },
      { executableName: 'GameB.exe' }
    ])

    expect(
      findMatchingProfile([gaming], { executable: 'gameb.exe', path: null })?.profile.id
    ).toBe('gaming')
  })

  it('prefers a path-specific match over an earlier filename-only match', () => {
    const generic = profile('generic', [{ executableName: 'Game.exe' }])
    const specific = profile('specific', [
      { executableName: 'Game.exe', executablePath: 'D:\\Games\\Game.exe' }
    ])

    expect(
      findMatchingProfile([generic, specific], {
        executable: 'Game.exe',
        path: 'D:\\Games\\Game.exe'
      })
    ).toMatchObject({ profile: { id: 'specific' }, type: 'path' })
  })

  it('ignores disabled profiles', () => {
    const disabled = profile('disabled', [{ executableName: 'Game.exe' }], false)
    expect(
      findMatchingProfile([disabled], { executable: 'Game.exe', path: null })
    ).toBeNull()
  })

  it('returns no match for an unrelated or unavailable application', () => {
    const gaming = profile('gaming', [{ executableName: 'Game.exe' }])
    expect(
      findMatchingProfile([gaming], { executable: 'Browser.exe', path: null })
    ).toBeNull()
    expect(findMatchingProfile([gaming], null)).toBeNull()
  })

  it('normalizes quoted and extended-length paths', () => {
    expect(normalizeExecutablePath('"\\\\?\\C:\\Games\\Game.exe"')).toBe(
      'c:\\games\\game.exe'
    )
  })
})
