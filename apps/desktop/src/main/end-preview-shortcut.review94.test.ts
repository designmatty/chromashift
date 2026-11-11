import { expect, it, vi } from 'vitest'
import type { ColorProfile } from '@chromashift/core'
import { requestEndPreview } from '@main/end-preview-shortcut.js'
import { PreviewSessionController } from '@main/preview-session-controller.js'
import { FakeNativeDisplayPort } from '@main/testing/fake-native-display.js'

const profile: ColorProfile = {
  id: 'game',
  name: 'Game',
  enabled: true,
  applications: [],
  displays: []
}

function controller() {
  return new PreviewSessionController(
    new FakeNativeDisplayPort(),
    {
      beginPreview: async () => [],
      cancelPreview: async () => undefined,
      confirmPreview: async () => undefined
    },
    () => undefined
  )
}

it('REVIEW94: ignores a request after its session ends and the same profile is previewed again during flush', async () => {
  const preview = controller()
  await preview.start(profile, 'preview', profile)
  const dispatch = vi.fn()
  await requestEndPreview({
    panelLifetime: () => 21,
    preview: () => preview.state,
    flushDrafts: async () => {
      await preview.cancel()
      await preview.start(profile, 'preview', profile)
    },
    dispatch
  })
  expect(preview.state).toMatchObject({ state: 'active', profileId: 'game' })
  expect(dispatch, 'the shortcut belongs to the ended session').not.toHaveBeenCalled()
})

it('REVIEW94: still dispatches after a draft flush promotes the same session to Edit', async () => {
  const preview = controller()
  await preview.start(profile, 'preview', profile)
  const dispatch = vi.fn()
  await requestEndPreview({
    panelLifetime: () => 21,
    preview: () => preview.state,
    flushDrafts: async () => {
      await preview.start({ ...profile, name: 'Unsaved name' }, 'edit', profile)
    },
    dispatch
  })
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(
    { lifetime: 21, sessionId: 1, profileId: 'game' },
    true
  )
})
