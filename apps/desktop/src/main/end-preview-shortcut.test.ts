import { expect, it, vi } from 'vitest'
import type { PreviewState } from '@shared/product-api.js'
import { requestEndPreview } from '@main/end-preview-shortcut.js'

it.each([false, true])(
  'dispatches the existing renderer action after flushing, unsaved=%s',
  async (unsavedChanges) => {
    let preview: PreviewState = {
      state: 'active',
      sessionId: 1,
      profileId: 'game',
      kind: 'preview',
      targets: [],
      unsavedChanges: false
    }
    const dispatch = vi.fn()
    let finish!: () => void
    const flushDrafts = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const request = requestEndPreview({
      panelLifetime: () => 21,
      preview: () => preview,
      dispatch,
      flushDrafts
    })
    expect(dispatch).not.toHaveBeenCalled()
    preview = { ...preview, kind: unsavedChanges ? 'edit' : 'preview', unsavedChanges }
    finish()
    await request
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      { lifetime: 21, sessionId: 1, profileId: 'game' },
      unsavedChanges
    )
  }
)

it.each<PreviewState>([
  { state: 'inactive' },
  { state: 'restorePending', displayIds: ['display:one'] },
  {
    state: 'active',
    sessionId: 1,
    profileId: 'game',
    kind: 'override',
    targets: [],
    unsavedChanges: true
  }
])('does nothing without an app preview: $state $kind', async (preview) => {
  const dispatch = vi.fn()
  const flushDrafts = vi.fn(async () => undefined)
  await requestEndPreview({
    panelLifetime: () => 21,
    preview: () => preview,
    dispatch,
    flushDrafts
  })
  expect(dispatch).not.toHaveBeenCalled()
  expect(flushDrafts).not.toHaveBeenCalled()
})

it('does not dispatch when the preview ends during the draft flush', async () => {
  let preview: PreviewState = {
    state: 'active',
    sessionId: 1,
    profileId: 'game',
    kind: 'preview',
    targets: [],
    unsavedChanges: false
  }
  const dispatch = vi.fn()
  await requestEndPreview({
    panelLifetime: () => 21,
    preview: () => preview,
    dispatch,
    flushDrafts: async () => {
      preview = { state: 'inactive' }
    }
  })
  expect(dispatch).not.toHaveBeenCalled()
})

it.each([null, 22])(
  'drops a request when its panel lifetime becomes %s during flush',
  async (next) => {
    const preview: PreviewState = {
      state: 'active',
      sessionId: 1,
      profileId: 'game',
      kind: 'preview',
      targets: [],
      unsavedChanges: false
    }
    let lifetime: number | null = 21
    const dispatch = vi.fn()
    await requestEndPreview({
      preview: () => preview,
      panelLifetime: () => lifetime,
      flushDrafts: async () => {
        lifetime = next
      },
      dispatch
    })
    expect(dispatch).not.toHaveBeenCalled()
  }
)

it('does nothing for an app preview without an originating panel lifetime', async () => {
  const dispatch = vi.fn()
  const flushDrafts = vi.fn(async () => undefined)
  await requestEndPreview({
    preview: () => ({
      state: 'active',
      sessionId: 1,
      profileId: 'game',
      kind: 'preview',
      targets: [],
      unsavedChanges: false
    }),
    panelLifetime: () => null,
    flushDrafts,
    dispatch
  })
  expect(flushDrafts).not.toHaveBeenCalled()
  expect(dispatch).not.toHaveBeenCalled()
})
