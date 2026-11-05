import { renderToStaticMarkup } from 'react-dom/server'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import { expect, it } from 'vitest'
import {
  usePreviewDraft,
  type UsePreviewDraftOptions
} from '@/features/profiles/use-preview-draft.js'

const saved: ColorProfile = {
  id: 'game',
  name: 'Game',
  enabled: true,
  applications: [],
  displays: [{ displayId: 'display:one', color: createNeutralColorSettings() }]
}

function dirtyOnRender(options: Partial<UsePreviewDraftOptions>): boolean {
  let dirty = false
  function Draft(): null {
    dirty = usePreviewDraft({
      kind: 'edit',
      session: { state: 'inactive' },
      enabled: false,
      onError: () => undefined,
      initialDraft: () => structuredClone(saved),
      initialDirty: () => true,
      savedProfile: saved,
      ...options
    }).dirty
    return null
  }
  renderToStaticMarkup(<Draft />)
  return dirty
}

it('clears edit dirtiness when the draft returns to saved content', () => {
  const changed = structuredClone(saved)
  changed.displays[0]!.color.brightness = 60
  expect(dirtyOnRender({ initialDraft: () => changed })).toBe(true)
  changed.displays[0]!.color.brightness = saved.displays[0]!.color.brightness
  expect(dirtyOnRender({ initialDraft: () => changed })).toBe(false)
  expect(dirtyOnRender({ initialDraft: () => ({ ...saved, name: 'Renamed' }) })).toBe(true)
})

it('does not turn an externally saved profile toggle into a local edit', () => {
  expect(
    dirtyOnRender({
      initialDirty: () => false,
      savedProfile: { ...saved, enabled: false }
    })
  ).toBe(false)
})
