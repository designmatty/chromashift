// Browser-only smoke of the built website and its "Try it out" demo. Uses the
// installed Electron Chromium; it does not launch ChromaShift or its helper.
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { URL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist')
const output = join(root, 'out', 'smoke')
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
}
let server
let window
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

async function run() {
  const headers = await readFile(join(dist, '_headers'), 'utf8')
  const csp = headers.match(/Content-Security-Policy: (.+)/)[1]
  const requests = []
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    requests.push(pathname)
    const file = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(`${dist}${sep}`)) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      response.writeHead(200, {
        'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': csp
      })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
  await mkdir(output, { recursive: true })
  window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
  })
  const browserErrors = []
  window.webContents.on('console-message', (event) => {
    if (event.level !== 'info' && event.level !== 'debug') browserErrors.push(event.message)
  })
  const cdp = window.webContents.debugger
  cdp.attach('1.3')

  const evaluate = (code) => window.webContents.executeJavaScript(code, true)
  const query = (selector) => `document.querySelector(${JSON.stringify(selector)})`
  const click = (selector) => evaluate(`${query(selector)}.click()`)
  const value = (name) => evaluate(`Number(${query(`#demo-${name}`)}.value)`)
  const text = (selector) => evaluate(`${query(selector)}.textContent.trim()`)
  const hidden = (selector) => evaluate(`${query(selector)}.hidden`)
  const filter = () => evaluate(`${query('[data-demo-screen]')}.style.filter`)
  const waitFor = async (code, label) => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await evaluate(code)) return
      await delay(50)
    }
    throw new Error(`Timed out: ${label}`)
  }
  const capture = async (name) => {
    await delay(450)
    await writeFile(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG())
  }
  const bounds = (selector) =>
    evaluate(
      `(() => { const r = ${query(selector)}.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
    )
  const mouse = async (type, x, y) => {
    await cdp.sendCommand('Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1
    })
    await delay(30)
  }
  const key = async (name) => {
    const keys = {
      Enter: ['Enter', 13],
      Escape: ['Escape', 27],
      Tab: ['Tab', 9],
      Right: ['ArrowRight', 39],
      Space: [' ', 32]
    }
    const [key, windowsVirtualKeyCode] = keys[name]
    const input = { key, code: name === 'Space' ? 'Space' : key, windowsVirtualKeyCode }
    await cdp.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...(name === 'Enter' ? { text: '\r' } : name === 'Space' ? { text: ' ' } : {}),
      ...input
    })
    await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...input })
    await delay(40)
  }
  const change = (name, next) =>
    evaluate(
      `(() => { const input = ${query(`#demo-${name}`)}; input.value = ${next}; input.dispatchEvent(new Event('input', { bubbles: true })) })()`
    )
  const screenLoaded = (scene) =>
    waitFor(
      `${query('[data-demo-screen]')}.src.endsWith('/media/demo/${scene}') && !${query('[data-demo-screen]')}.classList.contains('is-loading')`,
      scene
    )
  // Sample only screenshot pixels, away from the bar, dock, and panel.
  const pixelHash = async () => {
    await delay(150)
    const capture = await window.webContents.capturePage({
      x: 260,
      y: 260,
      width: 160,
      height: 160
    })
    return createHash('sha256').update(capture.toBitmap()).digest('hex')
  }

  await window.loadURL(`http://127.0.0.1:${server.address().port}/`)
  await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  await waitFor(`!${query('[data-demo-open]')}.hidden`, 'demo initialized')
  await evaluate('document.fonts.ready')
  assert.ok(
    await evaluate(
      `${query('.brand__logo')}.complete && ${query('.brand__logo')}.naturalWidth > 0`
    ),
    'the header shows the full logo'
  )
  await capture('page-top')
  assert.equal(
    requests.some((path) => path.startsWith('/media/demo/')),
    false,
    'screenshots load only when the demo opens'
  )
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('use')].every((use) => document.querySelector(use.getAttribute('href')))`
    ),
    true,
    'every icon references a symbol'
  )
  await evaluate(`${query('.hero-media')}.scrollIntoView({ block: 'center' })`)
  await capture('hero')
  const hero = await bounds('.hero-media__frame')
  await mouse('mouseMoved', hero.x + hero.width / 2, hero.y + hero.height / 2)
  await capture('hero-hover')
  assert.equal(await evaluate(`getComputedStyle(${query('[data-demo-open]')}).opacity`), '1')

  // Open from the keyboard. Tarkov at night resolves its night profile.
  await evaluate(`${query('[data-demo-open]')}.focus()`)
  await key('Enter')
  await waitFor(`${query('#color-demo')}.open`, 'keyboard open')
  await screenLoaded('tarkov-night.jpg')

  // The first open starts the guided tour; it never blocks the demo.
  await waitFor(`!${query('[data-tour]')}.hidden`, 'tour starts')
  assert.equal(await text('[data-tour-step]'), '1 of 5')
  assert.equal(await text('[data-tour-title]'), 'This is the mini panel')
  assert.equal(await evaluate('document.activeElement.hasAttribute("data-tour-next")'), true)
  await capture('demo-tour')
  for (let step = 2; step <= 5; step++) {
    await click('[data-tour-next]')
    assert.equal(await text('[data-tour-step]'), `${step} of 5`)
  }
  assert.equal(await text('[data-tour-next]'), 'Done')
  await capture('demo-tour-last')
  await click('[data-tour-back]')
  assert.equal(await text('[data-tour-step]'), '4 of 5')
  await key('Escape')
  assert.equal(await hidden('[data-tour]'), true, 'Escape dismisses the tour')
  assert.equal(await evaluate(`${query('#color-demo')}.open`), true, 'the demo stays open')
  assert.equal(await evaluate('localStorage.getItem("chromashift.demo-tour-seen")'), '1')
  await click('[data-tour-start]')
  assert.equal(await text('[data-tour-step]'), '1 of 5', 'the tour can be restarted')
  await click('[data-tour-skip]')
  assert.equal(await hidden('[data-tour]'), true, 'Skip dismisses the tour')

  assert.equal(await text('[data-mini-mode]'), 'Automatic')
  assert.equal(await text('[data-mini-profile]'), 'Tarkov night')
  assert.equal(await value('gamma'), 2.6)
  assert.equal(await hidden('[data-mini-override]'), true)
  assert.match(await filter(), /url\(.+demo-ramp/)
  await capture('demo-tarkov-night')

  const profiled = await pixelHash()
  await click('[data-mini-power]')
  assert.equal(await filter(), 'none', 'pause shows the original')
  assert.equal(await evaluate(`${query('#demo-brightness')}.disabled`), true)
  const unfiltered = await pixelHash()
  assert.notEqual(profiled, unfiltered, 'the Tarkov profile changes screenshot pixels')
  await capture('demo-paused')
  await click('[data-mini-power]')
  assert.equal(await pixelHash(), profiled, 'resume reapplies the profile')

  // Every control changes the rendered screenshot on its own.
  await click('[data-mini-reset]')
  for (const [name, next] of [
    ['brightness', 80],
    ['contrast', 85],
    ['gamma', 1.8],
    ['saturation', 0],
    ['hue', 40]
  ]) {
    await click('[data-mini-reset]')
    const before = await pixelHash()
    await change(name, next)
    assert.notEqual(await pixelHash(), before, `${name} changes screenshot pixels`)
  }
  assert.equal(await hidden('[data-mini-override]'), false, 'changes show Reset and Update')
  await capture('demo-dirty')
  await click('[data-mini-reset]')
  assert.equal(await hidden('[data-mini-override]'), true)
  assert.equal(await pixelHash(), profiled, 'Reset changes returns to the profile')

  // The gamma envelope follows brightness, and per-control reset returns to neutral.
  await change('gamma', 2.8)
  await change('brightness', 100)
  assert.equal(await value('gamma'), 2.3)
  await click('[data-control="brightness"] .mini-control__reset')
  assert.equal(await value('brightness'), 50)
  await click('[data-mini-reset]')

  // Restore is one-shot; the next change reapplies.
  await click('[data-mini-restore]')
  assert.equal(await filter(), 'none')
  await change('saturation', 70)
  assert.notEqual(await filter(), 'none')
  await click('[data-mini-reset]')

  // Hold to compare shows the original only while pressed.
  const compare = await bounds('[data-demo-compare]')
  await mouse('mousePressed', compare.x + 20, compare.y + 18)
  assert.equal(await filter(), 'none')
  await mouse('mouseReleased', compare.x + 20, compare.y + 18)
  assert.notEqual(await filter(), 'none')

  // Native mouse input drives the real slider.
  const slider = await bounds('#demo-saturation')
  await mouse('mousePressed', slider.x + slider.width * 0.15, slider.y + 13)
  await mouse('mouseReleased', slider.x + slider.width * 0.15, slider.y + 13)
  assert.ok((await value('saturation')) < 30, 'mouse adjusts saturation')
  await evaluate(`${query('#demo-hue')}.focus()`)
  await key('Right')
  assert.equal(await value('hue'), 1, 'keyboard adjusts hue')
  await click('[data-mini-update]')
  assert.equal(await hidden('[data-mini-override]'), true, 'Update profile saves the draft')
  assert.equal(await text('[data-hero-controls] [data-control="hue"] [data-value]'), '0')

  // Daytime switches automatically to the app's general profile.
  await click('[data-demo-variant="day"]')
  await screenLoaded('tarkov-day.jpg')
  assert.equal(await text('[data-mini-profile]'), 'Escape from Tarkov')
  assert.equal(await value('gamma'), 0.9)
  assert.equal(await value('hue'), 0, 'night changes stay with the night profile')
  await change('hue', 1)
  await click('[data-mini-update]')
  assert.equal(
    await text('[data-hero-controls] [data-control="hue"] [data-value]'),
    '1',
    'saving Tarkov updates the hero replica'
  )

  // Rust keeps the time of day and has its own day and night profiles.
  await click('[data-demo-app="rust"]')
  await screenLoaded('rust-day.jpg')
  assert.equal(await text('[data-mini-profile]'), 'Rust')
  assert.equal(await value('gamma'), 0.85)
  await click('[data-demo-variant="night"]')
  await screenLoaded('rust-night.jpg')
  assert.equal(await text('[data-mini-profile]'), 'Rust night')
  assert.equal(await value('gamma'), 1.7)
  await capture('demo-rust-night')

  // Blender has its own profile; Figma falls back to Default.
  await click('[data-demo-app="blender"]')
  await screenLoaded('blender.jpg')
  assert.equal(await text('[data-mini-profile]'), 'Blender')
  assert.equal(await evaluate(`${query('[data-demo-variant="day"]')}.disabled`), true)
  await capture('demo-blender')
  await click('[data-demo-app="figma"]')
  await screenLoaded('figma.jpg')
  assert.equal(await text('[data-mini-profile]'), 'Default profile')
  assert.equal(await filter(), 'none', 'Default is neutral')
  assert.equal(
    await evaluate(`getComputedStyle(${query('[data-demo-screen]')}).objectFit`),
    'contain'
  )
  await capture('demo-figma')

  // A manual selection overrides the foreground app until Automatic is chosen.
  await click('[data-mini-picker-open]')
  assert.equal(await hidden('[data-mini-picker-view]'), false)
  await capture('demo-picker')
  await click('input[name="demo-profile"][value="tarkov"]')
  assert.equal(await hidden('[data-mini-picker-view]'), true)
  assert.equal(await text('[data-mini-mode]'), 'Manually selected')
  assert.equal(await text('[data-mini-profile]'), 'Escape from Tarkov')
  assert.equal(await value('hue'), 1, 'the updated profile was kept')
  await click('[data-mini-picker-open]')
  await key('Escape')
  assert.equal(
    await evaluate(`${query('#color-demo')}.open`),
    true,
    'Escape closes the picker first'
  )
  await click('[data-mini-picker-open]')
  await click('input[name="demo-profile"][value="automatic"]')
  assert.equal(await text('[data-mini-profile]'), 'Default profile')

  // Dragging by the title bar moves the panel and keeps it on screen.
  const panel = await bounds('[data-mini]')
  const handle = await bounds('[data-mini-drag]')
  await mouse('mousePressed', handle.x + 60, handle.y + 20)
  await mouse('mouseMoved', handle.x - 500, handle.y - 200)
  await mouse('mouseMoved', handle.x - 700, handle.y - 300)
  await mouse('mouseReleased', handle.x - 700, handle.y - 300)
  const moved = await bounds('[data-mini]')
  assert.ok(moved.x < panel.x - 600 && moved.y < panel.y - 250, 'mouse drags the panel')
  await mouse('mousePressed', moved.x + 60, moved.y + 20)
  await mouse('mouseMoved', -2000, -2000)
  await mouse('mouseReleased', -2000, -2000)
  const pinned = await bounds('[data-mini]')
  assert.ok(pinned.x >= 0 && pinned.y >= 0, 'the panel stays inside the stage')
  await click('[data-demo-app="tarkov"]')
  await screenLoaded('tarkov-day.jpg')
  await capture('demo-tarkov-day-moved')

  // Escape closes the dialog and focus returns to the hero action.
  await key('Escape')
  assert.equal(await evaluate(`${query('#color-demo')}.open`), false)
  assert.equal(await evaluate(`document.activeElement.hasAttribute('data-demo-open')`), true)

  // Mobile: the action is visible without hover, and touch drags the panel.
  await cdp.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await cdp.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: true })
  window.setContentSize(390, 844)
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`)
  await waitFor(`!${query('[data-demo-open]')}.hidden`, 'mobile initialized')
  await evaluate('document.fonts.ready')
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
  await evaluate(`${query('.hero-media')}.scrollIntoView({ block: 'center' })`)
  await capture('hero-mobile')
  await click('[data-demo-open]')
  await screenLoaded('tarkov-night.jpg')
  const touchPanel = await bounds('[data-mini]')
  assert.ok(touchPanel.x >= 0 && touchPanel.x + touchPanel.width <= 390, 'panel fits on mobile')
  await capture('demo-mobile')
  assert.equal(await hidden('[data-tour]'), true, 'a seen tour does not start again')
  await click('[data-tour-start]')
  const bubble = await bounds('[data-tour-bubble]')
  assert.ok(bubble.x >= 0 && bubble.x + bubble.width <= 390, 'the tour bubble fits on mobile')
  await capture('demo-tour-mobile')
  await click('[data-tour-skip]')
  const touchHandle = await bounds('[data-mini-drag]')
  const touch = (type, x, y) =>
    cdp.sendCommand('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }]
    })
  await touch('touchStart', touchHandle.x + 70, touchHandle.y + 18)
  await touch('touchMove', touchHandle.x + 70, touchHandle.y - 100)
  await touch('touchMove', touchHandle.x + 70, touchHandle.y - 200)
  await touch('touchEnd')
  await delay(100)
  assert.ok((await bounds('[data-mini]')).y < touchPanel.y - 150, 'touch drags the panel')

  cdp.detach()
  assert.deepEqual(browserErrors, [], 'no CSP violations or browser errors')
  globalThis.console.log(`Website smoke passed. Captures: ${output}`)
}

app
  .whenReady()
  .then(run)
  .then(
    () => {
      window.destroy()
      server.close()
      app.quit()
    },
    (error) => {
      globalThis.console.error(error)
      window?.destroy()
      server?.close()
      app.exit(1)
    }
  )
