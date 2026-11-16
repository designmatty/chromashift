import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import { expect, it, vi } from 'vitest'
import { NativeServiceError } from '@chromashift/native-client'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort, testDisplay } from '@main/testing/fake-native-display.js'

const a = 'display:a'
const b = 'display:b'
const color = (brightness: number) => ({ ...createNeutralColorSettings(), brightness })

async function twoDisplays(kind: 'edit' | 'override' = 'edit') {
  const native = new FakeNativeDisplayPort(0, [testDisplay(a), testDisplay(b)])
  native.currentSettings.set(a, { brightness: 43 })
  native.currentSettings.set(b, { brightness: 47 })
  const saved: ColorProfile = {
    id: 'game',
    name: 'Game',
    enabled: true,
    applications: [],
    displays: [
      { displayId: a, color: color(54) },
      { displayId: b, color: color(44) }
    ]
  }
  const draft: ColorProfile = {
    ...saved,
    displays: [
      { displayId: a, color: color(61) },
      { displayId: b, color: color(71) }
    ]
  }
  const controller = new PreviewSessionController(
    native,
    {
      beginPreview: async () => [],
      continuePreview: async () => [],
      cancelPreview: async () => undefined,
      confirmPreview: async () => undefined
    },
    () => undefined
  )
  await controller.start(draft, kind, saved)
  return { native, saved, draft, controller }
}

// Reviewer proof 1: failed ownership validation must block edits until Retry
// restores every display the hold wrote, including an otherwise unchanged B.
it('an invalidated hold blocks edits until Retry restores the whole draft', async () => {
  const f = await twoDisplays()
  await f.controller.setCompare(f.saved.id, true)
  expect(f.native.currentSettings.get(b)).toMatchObject({ brightness: 44 })
  await f.controller.invalidateComparison()
  expect(f.controller.state).toMatchObject({ comparing: false, targets: f.draft.displays })
  expect(f.controller.sessionRecoveryPending).toBe(true)
  const calls = [...f.native.calls]
  const edited = {
    ...f.draft,
    displays: [{ displayId: a, color: color(62) }, f.draft.displays[1]!]
  }
  await expect(f.controller.update(edited.id, edited.displays, edited)).rejects.toThrow('Restore the pending displays')
  expect(f.native.calls).toEqual(calls)
  await f.controller.retryRestoration()
  expect(f.native.currentSettings.get(a)).toMatchObject({ brightness: 61 })
  expect(f.native.currentSettings.get(b)).toMatchObject({ brightness: 71 })
  await f.controller.update(edited.id, edited.displays, edited)
  expect(f.controller.state).toMatchObject({ targets: edited.displays })
  expect(f.native.currentSettings.get(a)).toMatchObject({ brightness: 62 })
  expect(f.native.currentSettings.get(b)).toMatchObject({ brightness: 71 })
})

// Reviewer proof 3: Retry must restore a saved-only target in an override after
// the next saved write fails with an unconfirmed rollback.
it('override Retry after a failed saved write returns every display to the draft', async () => {
  const native = new FakeNativeDisplayPort(0, [testDisplay(a), testDisplay(b)])
  native.currentSettings.set(a, { brightness: 43 })
  native.currentSettings.set(b, { brightness: 47 })
  const saved: ColorProfile = {
    id: 'game',
    name: 'Game',
    enabled: true,
    applications: [],
    displays: [
      { displayId: b, color: color(44) },
      { displayId: a, color: color(54) }
    ]
  }
  const draft: ColorProfile = { ...saved, displays: [{ displayId: a, color: color(61) }] }
  const controller = new PreviewSessionController(
    native,
    {
      beginPreview: async () => [],
      continuePreview: async () => [],
      cancelPreview: async () => undefined,
      confirmPreview: async () => undefined
    },
    () => undefined
  )
  await controller.start(draft, 'override', saved)
  const apply = native.applyDisplaySettings.bind(native)
  vi.spyOn(native, 'applyDisplaySettings').mockImplementation(async (id, settings) => {
    if (id === a && settings.brightness === 54)
      throw new NativeServiceError('BASELINE_RESTORE_FAILED', 'Rollback failed', 'display.apply', 'x')
    return apply(id, settings)
  })
  await expect(controller.setCompare(saved.id, true)).rejects.toThrow()
  expect(native.currentSettings.get(b)).toMatchObject({ brightness: 44 })
  vi.mocked(native.applyDisplaySettings).mockImplementation(apply)
  await controller.retryRestoration()
  expect(controller.state).toMatchObject({ comparing: false, targets: draft.displays })
  expect(native.currentSettings.get(a)).toMatchObject({ brightness: 61 })
  // B has no draft target, so it must be at Original settings (47), not saved (44).
  expect(native.currentSettings.get(b)).toMatchObject({ brightness: 47 })
})

// Reviewer proof 5: quit still prompts and releases with no renderer flush.
it('quit while held prompts with the full draft after main releases compare', async () => {
  const { prepareUnsavedQuit } = await import('@main/unsaved-quit.js')
  const f = await twoDisplays()
  await f.controller.setCompare(f.saved.id, true)
  const decide = vi.fn(async () => 'cancel' as const)
  const proceed = await prepareUnsavedQuit({
    flushRendererDrafts: async () => undefined,
    settle: () => f.controller.releaseComparison(),
    state: () => f.controller.state,
    decide,
    confirm: async () => undefined
  })
  expect(proceed).toBe(false)
  expect(decide).toHaveBeenCalledWith('Game')
  expect(f.controller.state).toMatchObject({ comparing: false, unsavedChanges: true })
  expect(f.native.currentSettings.get(b)).toMatchObject({ brightness: 71 })
})

