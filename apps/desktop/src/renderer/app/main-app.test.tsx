import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type {} from '@/env'
import { MainApp } from '@/app/main-app'
import { ProfileList } from '@/features/profiles/profile-list'
import { SettingsNav } from '@/features/settings/settings-nav'
import { AboutPanel } from '@/features/settings/about-panel'
import { MiniPanel } from '@/features/mini-panel/mini-panel'
import { MiniProfilePicker } from '@/features/mini-panel/mini-profile-picker'
import { createNeutralColorSettings } from '@chromashift/core'
import type { ColorProfile } from '@chromashift/core'
import { ColorControls } from '@/features/profiles/color-controls'
import { ProfileDetail } from '@/features/profiles/profile-detail'
import { ProfileActionDialog } from '@/features/profiles/profile-action-dialog'
import { LatestEventRelay } from '@shared/latest-event-relay'
import type { AppPanelView, ProductState } from '@shared/product-api'

// Exercise MainApp and usePreviewDraft effects using the same browser-free
// approach as override-hydration.integration.test.ts. Children remain elements.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  pending: false,
  effects: [] as Array<() => void>
}))
vi.mock('react', async (original) => {
  function effect(work: () => void | (() => void), deps?: unknown[]): void {
    const index = hooks.cursor++
    const previous = hooks.slots[index] as
      { deps?: unknown[]; cleanup?: void | (() => void) } | undefined
    if (deps && previous?.deps && deps.every((value, i) => Object.is(value, previous.deps![i])))
      return
    hooks.effects.push(() => {
      previous?.cleanup?.()
      hooks.slots[index] = { deps, cleanup: work() }
    })
  }
  return {
    ...(await original<typeof import('react')>()),
    useState(initial: unknown) {
      const index = hooks.cursor++
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === 'function' ? initial() : initial
      return [
        hooks.slots[index],
        (value: unknown) => {
          const next = typeof value === 'function' ? value(hooks.slots[index]) : value
          if (!Object.is(next, hooks.slots[index])) hooks.pending = true
          hooks.slots[index] = next
        }
      ]
    },
    useMemo(work: () => unknown, deps: unknown[]) {
      const index = hooks.cursor++
      const previous = hooks.slots[index] as { deps: unknown[]; value: unknown } | undefined
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i])))
        hooks.slots[index] = { deps, value: work() }
      return (hooks.slots[index] as { value: unknown }).value
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++
      hooks.slots[index] ??= { current: initial }
      return hooks.slots[index]
    },
    useEffect: effect,
    useLayoutEffect: effect
  }
})

vi.mock('@/hooks/use-product-theme', () => ({ useProductTheme: () => undefined }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function find<P>(node: ReactNode, type: ReactElement<P>['type']): ReactElement<P> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find<P>(child, type)
      if (found) return found
    }
  } else if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.type === type) return node as ReactElement<P>
    return find<P>(node.props.children, type)
  }
  return undefined
}

function setup(withLimits = true, Surface = MainApp) {
  hooks.slots = []
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  })
  const navigation = new LatestEventRelay<AppPanelView>()
  const endPreviewRequests = new LatestEventRelay<string>()
  let product: ProductState = {
    version: 'test',
    configuration: {
      schemaVersion: 3,
      settings: { defaultProfileId: 'default' },
      profiles: [{ id: 'default', name: 'Default', enabled: true, applications: [], displays: [] }]
    },
    settings: {
      schemaVersion: 3,
      launchAtStartup: false,
      launchBehavior: 'tray',
      closeBehavior: 'tray',
      theme: 'system',
      notificationsEnabled: false,
      shortcutBindings: []
    },
    displays: [],
    activation: {
      enabled: true,
      mode: { kind: 'automatic' },
      currentTarget: { kind: 'profile', profileId: 'default' }
    },
    foregroundApplication: null,
    capabilityReports: {},
    gammaLimits: withLimits ? { schemaVersion: 1, displays: {} } : undefined,
    preview: { state: 'inactive' },
    chromaShift: {
      status: 'active',
      pendingOperation: null,
      transitionInProgress: false,
      intendedMode: { kind: 'automatic' },
      intendedTarget: { kind: 'profile', profileId: 'default' }
    }
  }
  const getState = vi.fn<typeof window.chromaShift.getState>(async () => ({
    ok: true,
    value: product
  }))
  const startPreview = vi.fn(async (profile: import('@chromashift/core').ColorProfile) => {
    product = {
      ...product,
      preview: {
        state: 'active',
        kind: 'preview',
        profileId: profile.id,
        targets: profile.displays,
        unsavedChanges: false
      }
    }
    hooks.pending = true
    return { ok: true as const, value: null }
  })
  const updatePreview = vi.fn(async () => ({ ok: true as const, value: null }))
  vi.stubGlobal('window', {
    chromaShift: {
      getState,
      openAppPanel: vi.fn(async () => ({ ok: true, value: null })),
      onEndPreviewRequested: (listener: (profileId: string) => void) =>
        endPreviewRequests.subscribe(listener),
      getPanelLifetime: () => 1,
      cancelPreview: vi.fn(async () => {
        product = { ...product, preview: { state: 'inactive' } }
        hooks.pending = true
        return { ok: true, value: null }
      }),
      activateProfile: vi.fn(async (profileId: string) => {
        product = {
          ...product,
          activation: { ...product.activation, mode: { kind: 'manual', profileId } },
          chromaShift: {
            ...product.chromaShift,
            intendedMode: { kind: 'manual', profileId },
            intendedTarget: { kind: 'profile', profileId }
          }
        }
        hooks.pending = true
        return { ok: true, value: null }
      }),
      setMiniPanelView: vi.fn(async () => ({ ok: true, value: null })),
      openProfile: vi.fn(async () => ({ ok: true, value: null })),
      saveProfile: vi.fn(async (profile: ColorProfile) => {
        product = {
          ...product,
          configuration: {
            ...product.configuration,
            profiles: product.configuration.profiles.map((item) =>
              item.id === profile.id ? profile : item
            )
          }
        }
        hooks.pending = true
        return { ok: true, value: profile }
      }),
      updateSettings: vi.fn(async (settings: ProductState['settings']) => {
        // IPC state broadcasts deserialize fresh profile/capability objects.
        product = structuredClone({ ...product, settings })
        hooks.pending = true
        return { ok: true, value: settings }
      }),
      onAppPanelNavigation: (listener: (view: AppPanelView) => void) =>
        navigation.subscribe(listener),
      onAppPanelProfileSelection: () => undefined,
      onAppPanelClosed: vi.fn(),
      onAppPanelMinimized: () => undefined,
      onPanelClosing: () => () => undefined,
      onFlushPreviewDraft: () => () => undefined,
      startPreview,
      updatePreview
    }
  })
  let tree: ReactElement | null = null
  function render(): void {
    for (let count = 0; count < 20; count++) {
      hooks.pending = false
      hooks.cursor = 0
      hooks.effects = []
      tree = Surface({ product })
      for (const effect of hooks.effects) effect()
      if (!hooks.pending) return
    }
    throw new Error('MainApp effects did not settle')
  }
  async function settle(assert?: () => void): Promise<void> {
    for (let turn = 0; turn < 80; turn++) {
      await Promise.resolve()
      if (hooks.pending) render()
      assert?.()
    }
  }
  const settingsNav = () => find<Parameters<typeof SettingsNav>[0]>(tree, SettingsNav)!.props
  const profiles = () => find<Parameters<typeof ProfileList>[0]>(tree, ProfileList)
  return {
    render,
    settle,
    profiles,
    settingsNav,
    getState,
    startPreview,
    updatePreview,
    navigation,
    endPreviewRequests,
    storage,
    get product() {
      return product
    },
    set product(next: ProductState) {
      product = next
      hooks.pending = true
    },
    get tree() {
      return tree
    }
  }
}

it.each([true, false])(
  'keeps Profiles rendered after About, a settings update and Back, gamma limits=%s',
  async (withLimits) => {
    const f = setup(withLimits)
    const {
      render,
      settle,
      profiles,
      settingsNav,
      getState,
      startPreview,
      updatePreview,
      storage
    } = f
    render()
    profiles()!.props.onOpenSettings()
    render()
    await settle()
    expect(settingsNav().page).toBe('settings')

    // Hold About's queued returnToLive so Back can arrive after its initial paint.
    let releaseAbout!: () => void
    getState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAbout = () => resolve({ ok: true, value: f.product })
        })
    )
    settingsNav().onSelect('about')
    render()
    await settle()
    expect(find(f.tree, AboutPanel)).toBeDefined()
    await window.chromaShift.updateSettings({ ...f.product.settings, theme: 'dark' })
    render()
    settingsNav().onBack()
    render()
    const assertProfiles = () => {
      expect(profiles(), 'Back must keep the profile list mounted').toBeDefined()
      expect(find(f.tree, AboutPanel)).toBeUndefined()
    }
    assertProfiles()
    releaseAbout()
    await settle(assertProfiles)
    expect(profiles()!.props.busy).toBe(false)
    expect(profiles()!.props.selectedId).toBe('default')
    expect(profiles()!.props.dirtyProfileId).toBeNull()
    expect(storage.get('chromashift.app-panel.view')).toBe('profiles')
    expect(startPreview).not.toHaveBeenCalled()
    expect(updatePreview).not.toHaveBeenCalled()
  }
)

function delayed<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function addProfile(f: ReturnType<typeof setup>, id = 'smoke'): ColorProfile {
  const profile: ColorProfile = { id, name: id, enabled: true, applications: [], displays: [] }
  f.product = {
    ...f.product,
    configuration: {
      ...f.product.configuration,
      profiles: [...f.product.configuration.profiles, profile]
    }
  }
  return profile
}

it.each(['inactive', 'clean', 'dirty'] as const)(
  'End preview shortcut uses the button action: %s',
  async (state) => {
    const f = setup()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const profile = addProfile(f, 'preview')
    if (state !== 'inactive') {
      f.product = {
        ...f.product,
        preview: {
          state: 'active',
          kind: state === 'dirty' ? 'edit' : 'preview',
          profileId: profile.id,
          targets: [],
          draft: state === 'dirty' ? { ...profile, name: 'Unsaved' } : profile,
          unsavedChanges: state === 'dirty'
        }
      }
    }
    f.render()
    f.endPreviewRequests.publish(profile.id)
    f.render()
    await f.settle()
    const dialog = () =>
      find<Parameters<typeof ProfileActionDialog>[0]>(f.tree, ProfileActionDialog)!.props
    if (state === 'dirty') {
      expect(window.chromaShift.openAppPanel).toHaveBeenCalledExactlyOnceWith('profiles')
      expect(dialog().open).toBe(true)
      expect(window.chromaShift.cancelPreview).not.toHaveBeenCalled()
      dialog().onCancel()
      f.render()
      expect(f.product.preview.state).toBe('active')
      f.endPreviewRequests.publish(profile.id)
      f.render()
      dialog().onDiscard!()
      await f.settle()
      expect(f.product.preview.state).toBe('inactive')
      expect(window.chromaShift.cancelPreview).toHaveBeenCalledTimes(2)
    } else if (state === 'clean') {
      expect(window.chromaShift.cancelPreview).toHaveBeenCalledExactlyOnceWith(1)
      expect(f.product.preview.state).toBe('inactive')
      expect(
        find<Parameters<typeof ProfileDetail>[0]>(f.tree, ProfileDetail)!.props.profile.id
      ).toBe('default')
      expect(dialog().open).toBe(false)
    } else {
      expect(window.chromaShift.cancelPreview).not.toHaveBeenCalled()
      expect(dialog().open).toBe(false)
    }
  }
)

it('does not repaint Profiles when an older profile open finishes after Settings navigation', async () => {
  const f = setup()
  const profile = addProfile(f)
  f.render()
  const open = delayed<Awaited<ReturnType<typeof window.chromaShift.getState>>>()
  f.getState.mockImplementationOnce(() => open.promise)
  f.profiles()!.props.onSelect(profile)
  await f.settle()
  f.profiles()!.props.onOpenSettings()
  f.render()
  expect(f.settingsNav().page).toBe('settings')
  open.resolve({ ok: true, value: f.product })
  await f.settle()
  expect(f.profiles(), 'the older open must not replay its view').toBeUndefined()
  expect(f.settingsNav().page).toBe('settings')
  expect(f.startPreview).not.toHaveBeenCalled()
})

it('does not replace a newer selected row when an older returnToLive finishes', async () => {
  const f = setup()
  const first = addProfile(f, 'first')
  const second = addProfile(f, 'second')
  f.render()
  f.profiles()!.props.onSelect(first)
  await f.settle()
  const state = delayed<Awaited<ReturnType<typeof window.chromaShift.getState>>>()
  f.getState.mockImplementationOnce(() => state.promise)
  f.profiles()!.props.onUseProfile(first)
  await f.settle()
  // A buffered main selection may arrive while the UI is busy.
  f.navigation.publish('profiles')
  f.profiles()!.props.onSelect(second)
  f.render()
  expect(f.profiles()!.props.selectedId).toBe(second.id)
  state.resolve({ ok: true, value: f.product })
  await f.settle(() => expect(f.profiles()!.props.selectedId).toBe(second.id))
})

it('publishes Preview before the Use button is enabled, then sends exactly one manual activation', async () => {
  const f = setup()
  const profile = addProfile(f)
  f.render()
  const reply = delayed<{ ok: true; value: null }>()
  f.startPreview.mockImplementationOnce(async () => {
    f.product = {
      ...f.product,
      preview: {
        state: 'active',
        kind: 'preview',
        profileId: profile.id,
        targets: [],
        unsavedChanges: false
      }
    }
    return reply.promise
  })
  f.profiles()!.props.onSelect(profile)
  await f.settle()
  const button = () =>
    findWhere<{ disabled?: boolean; onClick(): void; children?: ReactNode }>(
      f.tree,
      (props) => props.children === 'Use this profile'
    )!
  expect(f.product.preview.state).toBe('active')
  expect(button().props.disabled).toBe(true)
  // HTMLElement.click() ignores a disabled button; main receives no request.
  if (!button().props.disabled) button().props.onClick()
  expect(window.chromaShift.cancelPreview).toHaveBeenCalledTimes(1)
  expect(window.chromaShift.activateProfile).not.toHaveBeenCalled()
  reply.resolve({ ok: true, value: null })
  await f.settle()
  expect(button().props.disabled).toBe(false)
  button().props.onClick()
  await f.settle()
  expect(window.chromaShift.activateProfile).toHaveBeenCalledExactlyOnceWith(profile.id, 1)
  expect(f.product.preview.state).toBe('inactive')
  expect(f.product.activation.mode).toEqual({ kind: 'manual', profileId: profile.id })
})

it('keeps a reopened mini picker open when an older activation reply arrives', async () => {
  const f = setup(true, MiniPanel)
  const first = addProfile(f, 'first')
  const second = addProfile(f, 'second')
  f.render()
  findWhere<{ 'data-part'?: string; onClick(): void }>(
    f.tree,
    (props) => props['data-part'] === 'active-profile'
  )!.props.onClick()
  f.render()
  const picker = () =>
    find<Parameters<typeof MiniProfilePicker>[0]>(f.tree, MiniProfilePicker)!.props
  const reply = delayed<{ ok: true; value: null }>()
  const activate = vi.mocked(window.chromaShift.activateProfile).getMockImplementation()!
  vi.mocked(window.chromaShift.activateProfile).mockImplementationOnce(async (id) => {
    await activate(id)
    return reply.promise
  })
  picker().onChoose(first.id)
  await f.settle()
  picker().onChoose(second.id)
  await f.settle()
  const active = findWhere<{ 'data-part'?: string; onClick(): void }>(
    f.tree,
    (props) => props['data-part'] === 'active-profile'
  )
  active?.props.onClick()
  f.render()
  reply.resolve({ ok: true, value: null })
  await f.settle()
  expect(
    find(f.tree, MiniProfilePicker),
    'an older reply must not close the reopened picker'
  ).toBeDefined()
  expect(f.product.activation.mode).toEqual({ kind: 'manual', profileId: second.id })
})

it('does not reset the mini-panel draft to the profile captured before choosing', async () => {
  const f = setup(true, MiniPanel)
  const profile = addProfile(f)
  profile.displays.push({
    displayId: 'display:one',
    color: { ...createNeutralColorSettings(), brightness: 51 }
  })
  connectDisplay(f)
  f.render()
  findWhere<{ 'data-part'?: string; onClick(): void }>(
    f.tree,
    (props) => props['data-part'] === 'active-profile'
  )!.props.onClick()
  f.render()
  find<Parameters<typeof MiniProfilePicker>[0]>(f.tree, MiniProfilePicker)!.props.onChoose(
    profile.id
  )
  await f.settle()
  expect(f.product.chromaShift.intendedTarget).toEqual({ kind: 'profile', profileId: profile.id })
  expect(
    find<Parameters<typeof ColorControls>[0]>(f.tree, ColorControls)!.props.color.brightness
  ).toBe(51)
})

it('does not resurrect a dirty navigation dialog after the panel closes', async () => {
  const f = setup()
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  f.render()
  const detail = find<Parameters<typeof ProfileDetail>[0]>(f.tree, ProfileDetail)!.props
  detail.onChange({ ...detail.profile, name: 'Changed' })
  f.render()
  f.profiles()!.props.onOpenSettings()
  const onClosed = vi.mocked(window.chromaShift.onAppPanelClosed).mock.calls.at(-1)![0]
  onClosed()
  for (const frame of frames) frame(0)
  await f.settle()
  expect(
    find<Parameters<typeof ProfileActionDialog>[0]>(f.tree, ProfileActionDialog)!.props.open
  ).toBe(false)
})

it('finishes a requested profile toggle without repainting over newer navigation', async () => {
  const f = setup()
  const profile = addProfile(f)
  f.render()
  const state = delayed<Awaited<ReturnType<typeof window.chromaShift.getState>>>()
  f.getState.mockImplementationOnce(() => state.promise)
  f.profiles()!.props.onToggleEnabled(profile)
  await f.settle()
  f.navigation.publish('settings')
  f.render()
  state.resolve({ ok: true, value: f.product })
  await f.settle()
  expect(window.chromaShift.saveProfile).toHaveBeenCalledExactlyOnceWith({
    ...profile,
    enabled: false
  })
  expect(f.settingsNav().page).toBe('settings')
})

it('ignores an old mini save reply after choosing a different profile', async () => {
  const f = setup(true, MiniPanel)
  const chosen = addProfile(f)
  chosen.displays.push({
    displayId: 'display:one',
    color: { ...createNeutralColorSettings(), brightness: 51 }
  })
  connectDisplay(f)
  f.product = {
    ...f.product,
    preview: {
      state: 'active',
      kind: 'override',
      profileId: 'default',
      targets: [],
      unsavedChanges: true
    }
  }
  f.render()
  const reply = delayed<Awaited<ReturnType<typeof window.chromaShift.confirmPreview>>>()
  window.chromaShift.confirmPreview = vi.fn(() => reply.promise)
  findWhere<{ children?: ReactNode; onClick(): void }>(
    f.tree,
    (props) => props.children === 'Update profile'
  )!.props.onClick()
  await f.settle()
  findWhere<{ 'data-part'?: string; onClick(): void }>(
    f.tree,
    (props) => props['data-part'] === 'active-profile'
  )!.props.onClick()
  f.render()
  find<Parameters<typeof MiniProfilePicker>[0]>(f.tree, MiniProfilePicker)!.props.onChoose(
    chosen.id
  )
  await f.settle()
  expect(
    find<Parameters<typeof ColorControls>[0]>(f.tree, ColorControls)!.props.color.brightness
  ).toBe(51)
  reply.resolve({
    ok: true,
    value: { ...f.product.configuration.profiles[0]!, name: 'Old saved draft' }
  })
  await f.settle()
  expect(
    find<Parameters<typeof ColorControls>[0]>(f.tree, ColorControls)!.props.color.brightness
  ).toBe(51)
})

it('drains a mini override before choosing even when its active broadcast has not arrived', async () => {
  vi.useFakeTimers()
  const f = setup(true, MiniPanel)
  const chosen = addProfile(f)
  connectDisplay(f)
  f.render()
  const reply = delayed<{ ok: true; value: null }>()
  f.startPreview.mockImplementationOnce(async (profile) => {
    await reply.promise
    f.product = {
      ...f.product,
      preview: {
        state: 'active',
        kind: 'override',
        profileId: profile.id,
        targets: profile.displays,
        unsavedChanges: true
      }
    }
    return { ok: true, value: null }
  })
  find<Parameters<typeof ColorControls>[0]>(f.tree, ColorControls)!.props.onChange({
    ...createNeutralColorSettings(),
    brightness: 51
  })
  f.render()
  await vi.advanceTimersByTimeAsync(120)
  expect(f.startPreview).toHaveBeenCalledTimes(1)
  expect(f.product.preview.state).toBe('inactive')
  findWhere<{ 'data-part'?: string; onClick(): void }>(
    f.tree,
    (props) => props['data-part'] === 'active-profile'
  )!.props.onClick()
  f.render()
  find<Parameters<typeof MiniProfilePicker>[0]>(f.tree, MiniProfilePicker)!.props.onChoose(
    chosen.id
  )
  await f.settle()
  expect(window.chromaShift.activateProfile).not.toHaveBeenCalled()
  reply.resolve({ ok: true, value: null })
  await f.settle()
  expect(f.product.preview.state).toBe('inactive')
  expect(window.chromaShift.activateProfile).toHaveBeenCalledExactlyOnceWith(chosen.id, 1)
})

function findWhere<P>(
  node: ReactNode,
  predicate: (props: P) => boolean
): ReactElement<P> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = findWhere(child, predicate)
      if (result) return result
    }
  } else if (isValidElement<{ children?: ReactNode }>(node)) {
    if (predicate(node.props as P)) return node as ReactElement<P>
    return findWhere(node.props.children, predicate)
  }
  return undefined
}

function connectDisplay(f: ReturnType<typeof setup>): void {
  f.product = {
    ...f.product,
    displays: [
      {
        id: 'display:one',
        name: 'Display',
        windowsDisplayName: 'DISPLAY1',
        monitorDevicePath: 'monitor:one',
        manufacturer: 'TST',
        productCode: '0001',
        serialNumber: 'one',
        adapter: { id: 'adapter', name: 'Adapter', vendor: 'nvidia', deviceId: 'PCI' },
        connection: 'DisplayPort',
        primary: true,
        hdr: false,
        advancedColorSupported: true,
        bitsPerColorChannel: 8,
        refreshRate: 60
      }
    ]
  }
}

it('rereview92: a mini selection must not activate after its panel lifetime ends', async () => {
  const f = setup(true, MiniPanel)
  const chosen = addProfile(f, 'chosen')
  const closing: Array<() => void> = []
  let lifetime: number | null = 1
  window.chromaShift.getPanelLifetime = () => lifetime
  window.chromaShift.onPanelClosing = (listener) => {
    closing.push(listener)
    return () => {}
  }
  f.render()
  findWhere<{ 'data-part'?: string; onClick(): void }>(
    f.tree,
    (props) => props['data-part'] === 'active-profile'
  )!.props.onClick()
  f.render()
  const reply = delayed<{ ok: true; value: null }>()
  // The cancellation was admitted while lifetime 1 was still open.
  vi.mocked(window.chromaShift.cancelPreview).mockImplementationOnce(() => reply.promise)
  find<Parameters<typeof MiniProfilePicker>[0]>(f.tree, MiniProfilePicker)!.props.onChoose(
    chosen.id
  )
  await f.settle()
  expect(window.chromaShift.cancelPreview).toHaveBeenCalledExactlyOnceWith(1)
  expect(window.chromaShift.activateProfile).not.toHaveBeenCalled()
  lifetime = null
  for (const listener of closing) listener()
  reply.resolve({ ok: true, value: null })
  await f.settle()
  expect(
    window.chromaShift.activateProfile,
    'a closed mini panel must not issue a new activation'
  ).not.toHaveBeenCalled()
})

it('rereview92: an older save must not dismiss a newer dirty navigation request', async () => {
  const f = setup()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  f.render()
  const detail = find<Parameters<typeof ProfileDetail>[0]>(f.tree, ProfileDetail)!.props
  detail.onChange({ ...detail.profile, name: 'Changed' })
  f.render()
  f.profiles()!.props.onOpenSettings()
  f.render()
  const dialog = () =>
    find<Parameters<typeof ProfileActionDialog>[0]>(f.tree, ProfileActionDialog)!.props
  expect(dialog().open).toBe(true)
  const reply = delayed<Awaited<ReturnType<typeof window.chromaShift.confirmPreview>>>()
  window.chromaShift.confirmPreview = vi.fn(async () => {
    const result = await reply.promise
    if (result.ok)
      f.product = {
        ...f.product,
        preview: { state: 'inactive' },
        configuration: {
          ...f.product.configuration,
          profiles: f.product.configuration.profiles.map((profile) =>
            profile.id === result.value.id ? result.value : profile
          )
        }
      }
    return result
  })
  dialog().onPrimary()
  await f.settle()
  // A second request from the tray can arrive while the first save is in flight.
  f.navigation.publish('about')
  f.render()
  expect(dialog().open).toBe(true)
  reply.resolve({ ok: true, value: { ...detail.profile, name: 'Changed' } })
  await f.settle()
  expect(f.profiles()).toBeDefined()
  expect(dialog().open, 'the newer About request must remain actionable').toBe(true)
  dialog().onDiscard!()
  await f.settle()
  expect(find(f.tree, AboutPanel)).toBeDefined()
})

it.each([
  { nextLifetime: 1, closingEvent: true },
  { nextLifetime: 2, closingEvent: false }
])(
  'invalidates pending mini-panel Automatic choices for %j',
  async ({ nextLifetime, closingEvent }) => {
    const f = setup(true, MiniPanel)
    const listeners: Array<() => void> = []
    let lifetime = 1
    window.chromaShift.getPanelLifetime = () => lifetime
    window.chromaShift.onPanelClosing = (listener) => {
      listeners.push(listener)
      return () => {}
    }
    window.chromaShift.enableAutomatic = vi.fn<typeof window.chromaShift.enableAutomatic>(
      async () => ({ ok: true, value: null })
    )
    f.render()
    findWhere<{ 'data-part'?: string; onClick(): void }>(
      f.tree,
      (props) => props['data-part'] === 'active-profile'
    )!.props.onClick()
    f.render()
    const reply = delayed<{ ok: true; value: null }>()
    vi.mocked(window.chromaShift.cancelPreview).mockImplementationOnce(() => reply.promise)
    find<Parameters<typeof MiniProfilePicker>[0]>(f.tree, MiniProfilePicker)!.props.onChoose(null)
    await f.settle()
    expect(window.chromaShift.cancelPreview).toHaveBeenCalledExactlyOnceWith(1)
    lifetime = nextLifetime
    if (closingEvent) for (const listener of listeners) listener()
    reply.resolve({ ok: true, value: null })
    await f.settle()
    expect(window.chromaShift.enableAutomatic).not.toHaveBeenCalled()
  }
)
