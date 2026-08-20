import { describe, expect, it } from 'vitest'
import { RendererRecoveryController } from './renderer-recovery-controller.js'
import type { StructuredLogger } from './structured-logger.js'

const logger: StructuredLogger = { write: () => undefined }

describe('RendererRecoveryController', () => {
  it('recreates crashed, OOM, and abnormal renderers but ignores intentional exits', () => {
    const recreated: string[] = []
    const controller = new RendererRecoveryController(logger)

    controller.handle(
      'appPanel',
      'clean-exit',
      () => recreated.push('clean'),
      () => undefined
    )
    controller.handle(
      'appPanel',
      'crashed',
      () => recreated.push('crashed'),
      () => undefined
    )
    controller.handle(
      'miniPanel',
      'oom',
      () => recreated.push('oom'),
      () => undefined
    )
    controller.handle(
      'miniPanel',
      'abnormal-exit',
      () => recreated.push('abnormal'),
      () => undefined
    )

    expect(recreated).toEqual(['crashed', 'oom', 'abnormal'])
  })

  it('caps retries per surface inside the recovery window', () => {
    let now = 1_000
    let recreations = 0
    const terminal: string[] = []
    const controller = new RendererRecoveryController(logger, 2, 500, () => now)

    controller.handle(
      'appPanel',
      'crashed',
      () => (recreations += 1),
      (message) => terminal.push(message)
    )
    controller.handle(
      'appPanel',
      'oom',
      () => (recreations += 1),
      (message) => terminal.push(message)
    )
    controller.handle(
      'appPanel',
      'crashed',
      () => (recreations += 1),
      (message) => terminal.push(message)
    )
    now += 501
    controller.handle(
      'appPanel',
      'crashed',
      () => (recreations += 1),
      (message) => terminal.push(message)
    )

    expect(recreations).toBe(3)
    expect(terminal).toHaveLength(1)
  })
})
