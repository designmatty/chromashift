import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type {} from '@/env'
import { MainApp } from '@/app/main-app'
import { ProfileList } from '@/features/profiles/profile-list'
import { SettingsNav } from '@/features/settings/settings-nav'
import { AboutPanel } from '@/features/settings/about-panel'
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

afterEach(() => vi.unstubAllGlobals())

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

it.each([true, false])(
  'keeps Profiles rendered after About, a settings update and Back, gamma limits=%s',
  async (withLimits) => {
    hooks.slots = []
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    })
    const navigation = new LatestEventRelay<AppPanelView>()
    let product: ProductState = {
      version: 'test',
      configuration: {
        schemaVersion: 3,
        settings: { defaultProfileId: 'default' },
        profiles: [
          { id: 'default', name: 'Default', enabled: true, applications: [], displays: [] }
        ]
      },
      settings: {
        schemaVersion: 2,
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
    const getState = vi.fn(async () => ({ ok: true as const, value: product }))
    const startPreview = vi.fn()
    const updatePreview = vi.fn()
    vi.stubGlobal('window', {
      chromaShift: {
        getState,
        getPanelLifetime: () => 1,
        cancelPreview: vi.fn(async () => ({ ok: true, value: null })),
        openProfile: vi.fn(async () => ({ ok: true, value: null })),
        updateSettings: vi.fn(async (settings: ProductState['settings']) => {
          // IPC state broadcasts deserialize fresh profile/capability objects.
          product = structuredClone({ ...product, settings })
          hooks.pending = true
          return { ok: true, value: settings }
        }),
        onAppPanelNavigation: (listener: (view: AppPanelView) => void) =>
          navigation.subscribe(listener),
        onAppPanelProfileSelection: () => undefined,
        onAppPanelClosed: () => undefined,
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
        tree = MainApp({ product })
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
          releaseAbout = () => resolve({ ok: true, value: product })
        })
    )
    settingsNav().onSelect('about')
    render()
    await settle()
    expect(find(tree, AboutPanel)).toBeDefined()
    await window.chromaShift.updateSettings({ ...product.settings, theme: 'dark' })
    render()
    settingsNav().onBack()
    render()
    const assertProfiles = () => {
      expect(profiles(), 'Back must keep the profile list mounted').toBeDefined()
      expect(find(tree, AboutPanel)).toBeUndefined()
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
