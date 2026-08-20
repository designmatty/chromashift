import { describe, expect, it } from 'vitest'
import {
  nativeRecoveryTerminalMessage,
  nativeRecoveryTerminalTitle
} from './native-recovery-user-message.js'

describe('native recovery user message', () => {
  it('uses actionable product language without exposing raw display identifiers', () => {
    expect(nativeRecoveryTerminalTitle).toBe('Display control paused')
    expect(nativeRecoveryTerminalMessage).toContain('GPU control panel')
    expect(nativeRecoveryTerminalMessage).toContain('Diagnostics')
    expect(nativeRecoveryTerminalMessage).not.toContain('display:')
    expect(nativeRecoveryTerminalMessage).not.toContain('DISPLAY_NOT_FOUND')
  })
})
