import { ChakraProvider, Flex } from '@chakra-ui/react'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNeutralColorSettings, type ColorProfile } from '@chromashift/core'
import type { ProductState } from '@shared/product-api'
import { system } from '@/theme/system'
import { ProfileDetail } from '@/features/profiles/profile-detail'
import { PROFILE_HEADER_HEIGHT } from '@/features/profiles/profile-layout'

// Keep tooltip content inspectable without opening a browser portal.
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({
    content,
    disabled,
    children
  }: {
    content: string
    disabled?: boolean
    children: React.ReactNode
  }) => (
    <span data-tooltip={content} data-tooltip-disabled={disabled}>
      {children}
    </span>
  )
}))

afterEach(() => vi.unstubAllGlobals())

function profile(names: string[], id = 'game'): ColorProfile {
  return {
    id,
    name: 'Game',
    enabled: true,
    displays: [],
    applications: names.map((executableName) => ({ executableName }))
  }
}

describe('profile detail', () => {
  function render(
    id: string,
    bound = true,
    names: string[] = [],
    comparison: 'clean' | 'draft' | 'saved' | 'saved-missing' = 'clean',
    displayCount = 1
  ): string {
    vi.stubGlobal('localStorage', { getItem: () => null })
    const product = {
      displays:
        comparison === 'clean'
          ? []
          : Array.from({ length: displayCount }, (_, index) => ({
              id: index === 0 ? 'display:one' : `display:${index}`,
              name: `Display ${index + 1}`,
              hdr: false,
              primary: index === 0,
              adapter: { name: 'Test adapter' },
              connection: 'DisplayPort'
            })),
      capabilityReports: {
        'display:one': {
          capabilities: Object.fromEntries(
            ['brightness', 'contrast', 'gamma', 'saturation', 'hue', 'colorTemperature'].map(
              (key) => [key, { supported: true, provider: 'nvidia' }]
            )
          )
        }
      },
      chromaShift: { status: 'active' },
      settings: {
        shortcutBindings: bound
          ? [
              {
                accelerator: 'Control+G',
                action:
                  id === 'default' ? { kind: 'defaultProfile' } : { kind: 'profile', profileId: id }
              }
            ]
          : []
      }
    } as unknown as ProductState
    return renderToStaticMarkup(
      <ChakraProvider value={system}>
        <ProfileDetail
          profile={{
            ...profile(names, id),
            displays:
              comparison === 'clean'
                ? []
                : [
                    {
                      displayId: 'display:one',
                      color: { ...createNeutralColorSettings(), brightness: 61 }
                    }
                  ],
            applications: names.map((executableName) => ({
              executableName,
              executablePath: `C:\\Apps\\${executableName}`
            }))
          }}
          product={product}
          busy={false}
          dirty={comparison !== 'clean'}
          compare={{
            showingSaved: comparison.startsWith('saved'),
            savedProfile: {
              ...profile(names, id),
              displays:
                comparison === 'saved-missing'
                  ? []
                  : [
                      {
                        displayId: 'display:one',
                        color: { ...createNeutralColorSettings(), brightness: 54 }
                      }
                    ]
            },
            onPress: vi.fn(),
            onRelease: vi.fn(async () => undefined)
          }}
          onChange={vi.fn()}
          onCancel={vi.fn()}
          onSave={vi.fn()}
          onCopy={vi.fn()}
          onDelete={vi.fn()}
          onToggleEnabled={vi.fn()}
          onError={vi.fn()}
        />
      </ChakraProvider>
    )
  }

  it('shows compare only for dirty drafts and displays disabled saved controls while held', () => {
    expect(render('game')).not.toContain('Hold to compare with saved')
    const draft = render('game', true, [], 'draft')
    expect(draft).toContain('aria-label="Hold to compare with saved"')
    expect(draft).toContain('aria-pressed="false"')
    expect(draft).not.toContain('Showing saved values')
    const saved = render('game', true, [], 'saved')
    expect(saved).toContain('aria-pressed="true"')
    expect(saved).not.toContain('compare-saved-indicator')
    expect(saved).toContain('data-comparing="true"')
    expect(saved).toContain('Showing saved values')
    const controls = saved.slice(saved.indexOf('data-part="profile-color-controls"'))
    expect(controls).toContain('54%')
    expect(controls).not.toContain('61%')
    const sliders = [...controls.matchAll(/<div\b[^>]*data-slot="slider"[^>]*>/g)]
    expect(sliders).toHaveLength(6)
    expect(sliders.every(([slider]) => slider.includes('data-disabled=""'))).toBe(true)
  })

  it('puts Triggers above display controls and shows the configured profile shortcut in the header', () => {
    const html = render('game')
    expect(html.indexOf('data-part="profile-triggers"')).toBeLessThan(
      html.indexOf('data-part="profile-color-controls"')
    )
    expect(html).toContain('>Triggers</h2>')
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    expect(header).toContain('data-accelerator="Control+G"')
    // The hotkey leads the header action group on the right.
    const hotkey = header.indexOf('data-part="shortcut-display"')
    expect(hotkey).toBeGreaterThan(header.indexOf('data-part="profile-header-actions"'))
    expect(header).toContain('data-part="profile-hotkey"')
    expect(header).toContain('More profile actions')
    expect(render('game', false)).not.toContain('data-part="shortcut-display"')
  })

  it('pins the whole header with an opaque panel surface and stable height', () => {
    for (const comparison of ['clean', 'draft'] as const) {
      const html = render('game', true, [], comparison)
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
      const headerClass = header.match(/class="([^"]+)"/)![1]!
      const rules = [...html.matchAll(new RegExp(`\\.${headerClass}\\{[^}]*\\}`, 'g'))]
        .map(([rule]) => rule)
        .join('\n')
      expect(rules).toContain('position:sticky;')
      // The header covers main-panel's 20px top padding so nothing scrolls above it.
      expect(rules).toContain('top:-20px;')
      expect(rules).toContain('margin-top:-20px;')
      expect(rules).toContain('padding-top:20px;')
      expect(rules).toContain('z-index:1;')
      expect(rules).toContain('background:var(--chromashift-colors-bg)')
      expect(rules).toContain('background:var(--chromashift-colors-bg-muted)')
      expect(rules).toContain('min-height:calc(var(--chromashift-sizes-10) + 20px)')
      expect(header).toContain('profile-title')
      expect(header).toContain('Profile name')
      expect(header).toContain('More profile actions')
      if (comparison === 'draft') {
        for (const action of ['Discard changes', 'Update profile']) expect(header).toContain(action)
      }
      expect(header).not.toContain('Hold to compare')
    }
  })

  it('keeps compare inside the display bar after the scrolling tab list', () => {
    const html = render('game', true, [], 'draft')
    const bar = html.slice(html.indexOf('data-part="display-tab-bar"'))
    const listStart = bar.indexOf('role="tablist"')
    const listEnd = bar.indexOf('</div>', listStart)
    const compare = bar.indexOf('aria-label="Hold to compare with saved"')
    expect(listStart).toBeGreaterThan(0)
    expect(compare).toBeGreaterThan(listEnd)
    expect(compare).toBeLessThan(bar.indexOf('data-part="display-control"'))
    expect(bar.slice(listEnd, compare)).toContain('flex-shrink:0')
    const tabClass = bar
      .slice(0, listEnd)
      .match(/role="tablist"[^>]*class="([^"]+)"/)![1]!
      .split(' ')
      .find((name) => name.startsWith('css-'))!
    const rules = [...html.matchAll(new RegExp(`\\.${tabClass}\\{[^}]*\\}`, 'g'))]
      .map(([rule]) => rule)
      .join('\n')
    expect(rules).toContain('overflow-x:auto')
    expect(rules).toContain('min-width:0')
  })

  it('keeps focus below the header, rename height stable and compare outside overflowing tabs in Chromium', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chromashift-profile-layout-'))
    try {
      // RR96-3 focus proof: real ProfileDetail SSR in an isolated scrollport.
      // Electron stays hidden and offscreen, with no helper or display writes.
      const body = renderToStaticMarkup(
        <ChakraProvider value={system}>
          <Flex
            as="main"
            data-part="main-panel"
            isolation="isolate"
            flexDir="column"
            h="220px"
            w="720px"
            p="20px"
            overflow="auto"
            scrollPaddingTop={`calc(${PROFILE_HEADER_HEIGHT} + {spacing.1})`}
            dangerouslySetInnerHTML={{ __html: render('game', true, [], 'draft', 8) }}
          />
        </ChakraProvider>
      )
      writeFileSync(
        join(directory, 'fixture.html'),
        `<!doctype html><body style="margin:0">${body}`
      )
      const script = join(directory, 'probe.cjs')
      writeFileSync(
        script,
        `
        const { app, BrowserWindow } = require('electron')
        const assert = require('node:assert/strict')
        app.disableHardwareAcceleration()
        app.setPath('userData', ${JSON.stringify(directory)})
        app.whenReady().then(async () => {
          try {
            const win = new BrowserWindow({ show: false, width: 760, height: 260,
              webPreferences: { offscreen: true } })
            await win.loadFile(${JSON.stringify(join(directory, 'fixture.html'))})
            const result = await win.webContents.executeJavaScript(
              ${JSON.stringify(`(() => {
                const main = document.querySelector('[data-part="main-panel"]')
                const header = main.querySelector('header')
                const bar = main.querySelector('[data-part="display-tab-bar"]')
                const list = bar.querySelector('[role="tablist"]')
                const compare = bar.querySelector('[aria-label="Hold to compare with saved"]')
                const before = compare.getBoundingClientRect()
                list.scrollLeft = list.scrollWidth
                const after = compare.getBoundingClientRect(), barRect = bar.getBoundingClientRect()
                const thumb = [...main.querySelectorAll('[data-part="thumb"]')]
                  .filter(t => t.getBoundingClientRect().height > 0)[1]
                main.scrollTop = main.scrollHeight
                thumb.focus()
                const h = header.getBoundingClientRect(), t = thumb.getBoundingClientRect()
                const hit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2)
                const title = header.querySelector('[data-part="profile-title"]')
                const input = header.querySelector('[data-part="profile-name"]')
                const height = h.height
                title.style.display = 'none'; input.hidden = false
                return { focused: document.activeElement === thumb,
                  belowHeader: t.top >= h.bottom, obscured: header.contains(hit),
                  height, renameHeight: header.getBoundingClientRect().height,
                  compareOutsideList: !list.contains(compare),
                  tabsOverflow: list.scrollLeft > 0,
                  compareStaysVisible: after.left === before.left && after.left >= barRect.left && after.right <= barRect.right,
                  scrollPadding: getComputedStyle(main).scrollPaddingTop }
              })()`)}
            )
            assert.equal(result.focused, true)
            assert.equal(result.belowHeader, true, JSON.stringify(result))
            assert.equal(result.obscured, false, JSON.stringify(result))
            assert.equal(result.scrollPadding, '64px')
            assert.equal(result.height, 60)
            assert.equal(result.renameHeight, result.height)
            assert.equal(result.compareOutsideList, true)
            assert.equal(result.tabsOverflow, true)
            assert.equal(result.compareStaysVisible, true)
            app.quit()
          } catch (error) { console.error(error); app.exit(1) }
        })
      `
      )
      const electron = createRequire(import.meta.url)('electron') as string
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = spawnSync(electron, [script], { encoding: 'utf8', timeout: 15000, env })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 20000)

  it('keeps disabled control rows without a hint for a missing saved target', () => {
    const html = render('game', true, [], 'saved-missing')
    const controls = html.slice(html.indexOf('data-part="profile-color-controls"'))
    expect(controls).not.toContain('Original settings')
    const sliders = [...controls.matchAll(/<div\b[^>]*data-slot="slider"[^>]*>/g)]
    expect(sliders).toHaveLength(6)
    expect(sliders.every(([slider]) => slider.includes('data-disabled=""'))).toBe(true)
  })

  it('keeps trigger actions beside the heading and uses compact wrapping executable chips', () => {
    const html = render('game', true, ['game.exe', 'other.exe'])
    const triggers = html.slice(
      html.indexOf('data-part="profile-triggers"'),
      html.indexOf('data-part="profile-color-controls"')
    )
    expect(triggers.indexOf('data-part="trigger-heading"')).toBeLessThan(
      triggers.indexOf('>Triggers</h2>')
    )
    expect(triggers.indexOf('data-part="trigger-actions"')).toBeLessThan(
      triggers.indexOf('data-part="trigger-chips"')
    )
    expect(triggers.match(/data-part="trigger-chip"/g)).toHaveLength(2)
    expect(triggers).toContain('flex-wrap:wrap')
    for (const name of ['game.exe', 'other.exe']) {
      expect(triggers).toContain(`>${name}</p>`)
      expect(triggers).toContain(`aria-label="Remove ${name}"`)
      expect(triggers).toContain(`data-tooltip="Remove ${name}"`)
    }
    expect(html).not.toContain('C:\\Apps')
    expect(html).not.toContain('Triggers:')
  })

  it('keeps Default grey with its fallback explanation and no trigger list', () => {
    const html = render('default')
    expect(
      html.includes('--chromashift-colors-color-palette-fg:var(--chromashift-colors-gray-fg)')
    ).toBe(true)
    expect(html).toContain('Used in automatic mode when no other profile is triggered')
    expect(html).not.toContain('Select from open apps')
    expect(html).not.toContain('profile-trigger-summary')
    expect(html).toContain('data-accelerator="Control+G"')
  })
})
