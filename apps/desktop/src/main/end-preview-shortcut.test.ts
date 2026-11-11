import { expect, it, vi } from 'vitest'
import type { PreviewState } from '@shared/product-api.js'
import { requestEndPreview } from '@main/end-preview-shortcut.js'

it.each([false, true])(
  'dispatches the existing renderer action after flushing, unsaved=%s',
  async (unsavedChanges) => {
    let preview: PreviewState = {
      state: 'active',
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
    const request = requestEndPreview({ preview: () => preview, dispatch, flushDrafts })
    expect(dispatch).not.toHaveBeenCalled()
    preview = { ...preview, kind: unsavedChanges ? 'edit' : 'preview', unsavedChanges }
    finish()
    await request
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('game', unsavedChanges)
  }
)

it.each<PreviewState>([
  { state: 'inactive' },
  { state: 'restorePending', displayIds: ['display:one'] },
  { state: 'active', profileId: 'game', kind: 'override', targets: [], unsavedChanges: true }
])('does nothing without an app preview: $state $kind', async (preview) => {
  const dispatch = vi.fn()
  const flushDrafts = vi.fn(async () => undefined)
  await requestEndPreview({ preview: () => preview, dispatch, flushDrafts })
  expect(dispatch).not.toHaveBeenCalled()
  expect(flushDrafts).not.toHaveBeenCalled()
})

it('does not dispatch when the preview ends during the draft flush', async () => {
  let preview: PreviewState = {
    state: 'active',
    profileId: 'game',
    kind: 'preview',
    targets: [],
    unsavedChanges: false
  }
  const dispatch = vi.fn()
  await requestEndPreview({
    preview: () => preview,
    dispatch,
    flushDrafts: async () => {
      preview = { state: 'inactive' }
    }
  })
  expect(dispatch).not.toHaveBeenCalled()
})
