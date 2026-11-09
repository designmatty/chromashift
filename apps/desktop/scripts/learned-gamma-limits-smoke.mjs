import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

/** Seeded production controls and settings action. No helper or display API exists in this fixture. */
export async function verifyLearnedGammaLimits({
  desktopDirectory,
  screenshotDirectory,
  electronPath,
  environment,
  reservePort,
  waitForDebuggerTarget,
  connectToDebugger,
  waitForExpression,
  hoverElement
}) {
  const parent = resolve(desktopDirectory, 'out')
  await mkdir(parent, { recursive: true })
  await mkdir(screenshotDirectory, { recursive: true })
  const directory = await mkdtemp(join(parent, 'gamma-limits-fixture-'))
  if (!resolve(directory).startsWith(join(parent, 'gamma-limits-fixture-')))
    throw new Error('Unexpected learned-limits fixture directory.')
  const source = (path) => JSON.stringify(join(desktopDirectory, 'src', path).replaceAll('\\', '/'))
  const port = await reservePort()
  let child
  let debuggerClient
  let exited
  try {
    await writeFile(
      join(directory, 'index.html'),
      '<html><head><title>ChromaShift</title></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>'
    )
    await writeFile(
      join(directory, 'preload.cjs'),
      `
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('chromaShift', {
  getFixtureLimits: () => ipcRenderer.invoke('fixture:limits'),
  resetLearnedLimits: (displayId) => ipcRenderer.invoke('fixture:reset', displayId),
  onFixtureLimits: (listener) => {
    const receive = (_event, limits) => listener(limits)
    ipcRenderer.on('fixture:limits-changed', receive)
    return () => ipcRenderer.removeListener('fixture:limits-changed', receive)
  }
})
`
    )
    await writeFile(
      join(directory, 'fixture.tsx'),
      `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Flex, Stack, Text } from '@chakra-ui/react'
import { Provider } from ${source('renderer/components/ui/provider.tsx')}
import { ColorControls } from ${source('renderer/features/profiles/color-controls.tsx')}
import { DisplaysView } from ${source('renderer/features/settings/displays-view.tsx')}
import { applyColorScheme } from ${source('renderer/lib/color-scheme.ts')}
const display = { id: 'display:fixture', name: 'Seeded display', hdr: false, primary: true,
  adapter: { name: 'Fixture adapter', vendor: 'nvidia' }, connection: 'Fixture', refreshRate: 60 }
const available = { supported: true, provider: 'windows' }
const capabilities = Object.fromEntries(['brightness','contrast','gamma','saturation','hue','colorTemperature'].map((key) => [key, available]))
function Fixture() {
  const [view, setView] = useState('app')
  const [limits, setLimits] = useState(null)
  const [error, setError] = useState(null)
  React.useEffect(() => { window.chromaShift.getFixtureLimits().then(setLimits) }, [])
  React.useEffect(() => window.chromaShift.onFixtureLimits(setLimits), [])
  const product = { displays: [display], capabilityReports: { [display.id]: { capabilities } }, gammaLimits: limits, chromaShift: { status: 'active' } }
  return <Stack data-fixture-root p="4" gap="4" color="fg" bg="bg" minH="100vh">
    <Flex gap="2">{['app','mini','displays'].map((item) => <Button key={item} data-fixture-view={item} onClick={() => setView(item)}>{item}</Button>)}</Flex>
    <Flex gap="2">{['dark','light'].map((theme) => <Button key={theme} data-fixture-theme={theme} onClick={() => applyColorScheme(document.documentElement, theme)}>{theme}</Button>)}</Flex>
    <Text>Seeded learned limits. No display writes.</Text>
    <div data-fixture-surface={view} style={{maxWidth: view === 'mini' ? 310 : 800}}>
      {limits !== null && (view === 'displays'
        ? <DisplaysView product={product} onError={(error) => { setError(error); window.chromaShift.getFixtureLimits().then(setLimits) }} />
        : <ColorControls displayId={display.id} product={product} color={{brightness:50,contrast:50,gamma:1.85,saturation:50,hue:0,colorTemperature:50}} editable onChange={() => {}} compact={view === 'mini'} />)}
    </div>
    {error && <Text role="alert">{error.message}</Text>}
  </Stack>
}
createRoot(document.getElementById('root')).render(<Provider><Fixture /></Provider>)
`
    )
    const aliases = {
      '@': join(desktopDirectory, 'src/renderer'),
      '@main': join(desktopDirectory, 'src/main'),
      '@shared': join(desktopDirectory, 'src/shared')
    }
    await build({
      configFile: false,
      root: directory,
      base: './',
      logLevel: 'silent',
      resolve: { alias: aliases },
      plugins: [react()],
      build: { outDir: join(directory, 'renderer'), emptyOutDir: false }
    })
    await writeFile(
      join(directory, 'main.ts'),
      `
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { LearnedGammaLimits } from ${source('main/learned-gamma-limits.ts')}
app.disableHardwareAcceleration()
app.on('window-all-closed', () => app.quit())
app.whenReady().then(async () => {
  const path = join(${JSON.stringify(directory)}, 'display-limits.json')
  await writeFile(path, JSON.stringify({ schemaVersion: 1, displays: { 'display:fixture': { sdr: {
    baselineHash: 'fixture-original-ramp', brightness: { '50': { max: 1.85 } }
  } } } }))
  const limits = new LearnedGammaLimits(path, { write: () => {} })
  await limits.load()
  ipcMain.handle('fixture:limits', () => limits.current)
  ipcMain.handle('fixture:reset', async (event, displayId) => {
    if (event.sender !== window.webContents || displayId !== 'display:fixture') throw Error('Unexpected fixture reset')
    await limits.reset(displayId)
    event.sender.send('fixture:limits-changed', limits.current)
    return { ok: true, value: null }
  })
  const window = new BrowserWindow({ width: 940, height: 800, title: 'ChromaShift',
    webPreferences: { preload: join(${JSON.stringify(directory)}, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadFile(join(${JSON.stringify(directory)}, 'renderer/index.html'))
}).catch((error) => { console.error(error); app.exit(1) })
`
    )
    await build({
      configFile: false,
      logLevel: 'silent',
      ssr: { noExternal: true },
      resolve: { alias: aliases },
      build: {
        ssr: join(directory, 'main.ts'),
        outDir: directory,
        emptyOutDir: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'main.cjs' }
        }
      }
    })
    child = spawn(
      electronPath,
      [
        join(directory, 'main.cjs'),
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${join(directory, 'data')}`
      ],
      { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = ''
    child.stdout.on('data', (data) => {
      output += data
    })
    child.stderr.on('data', (data) => {
      output += data
    })
    exited = new Promise((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', (code) =>
        code === 0 ? resolveExit() : reject(new Error(`Gamma fixture exited ${code}: ${output}`))
      )
    })
    // Observe immediately so an early fixture failure cannot become an unhandled rejection.
    exited.catch(() => {})
    const target = await waitForDebuggerTarget(port)
    debuggerClient = await connectToDebugger(target.webSocketDebuggerUrl)
    await debuggerClient.send('Runtime.enable')
    const click = (selector) =>
      debuggerClient.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})?.click()`
      })
    for (const surface of ['app', 'mini']) {
      await click(`[data-fixture-view="${surface}"]`)
      const palette = `(() => {
        const root = document.querySelector('[data-fixture-root]')
        if (!root) return null
        const style = getComputedStyle(root)
        return JSON.stringify({ color: style.color, background: style.backgroundColor })
      })()`
      await click('[data-fixture-theme="light"]')
      await waitForExpression(
        debuggerClient,
        `document.documentElement.style.colorScheme === 'light' && ${palette} !== null`,
        'Fixture did not initialize its production light theme'
      )
      let previousPalette = (await debuggerClient.send('Runtime.evaluate', { expression: palette }))
        .result.value
      const palettes = {}
      for (const theme of ['dark', 'light']) {
        await click(`[data-fixture-theme="${theme}"]`)
        await waitForExpression(
          debuggerClient,
          `document.documentElement.style.colorScheme === '${theme}' && ${palette} !== ${JSON.stringify(previousPalette)}`,
          `Fixture ${theme} theme did not change computed colors`
        )
        palettes[theme] = (
          await debuggerClient.send('Runtime.evaluate', { expression: palette })
        ).result.value
        previousPalette = palettes[theme]
        await waitForExpression(
          debuggerClient,
          `document.querySelector('[data-fixture-surface="${surface}"] [data-part="gamma-limit-note"]')?.textContent.includes('Limited to 1.85 on this display') && document.querySelector('[data-control="gamma"]')?.dataset.gammaMax === '1.85'`,
          'Seeded gamma limit did not reach the production control'
        )
        await hoverElement(debuggerClient, '[data-part="gamma-limit-note"]')
        await waitForExpression(
          debuggerClient,
          `document.querySelector('[role="tooltip"]')?.textContent.includes('Windows rejected a stronger gamma curve on this display.')`,
          'Learned limit tooltip did not open'
        )
        // Renderer capture: this helper-free fixture checks the production controls,
        // not native window chrome, so it does not depend on window enumeration.
        const screenshot = await debuggerClient.send('Page.captureScreenshot', { format: 'png' })
        await writeFile(
          join(screenshotDirectory, `gamma-learned-${surface}-${theme}.png`),
          globalThis.Buffer.from(screenshot.data, 'base64')
        )
        await debuggerClient.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
      }
      if (palettes.dark === palettes.light)
        throw new Error('Dark and light captures have identical computed colors.')
    }
    await click('[data-fixture-view="displays"]')
    await waitForExpression(
      debuggerClient,
      `document.querySelector('[aria-label="Reset learned limits for Seeded display"]') !== null`,
      'Reset action did not render'
    )
    await click('[aria-label="Reset learned limits for Seeded display"]')
    await waitForExpression(
      debuggerClient,
      `(async () => Object.keys((await window.chromaShift.getFixtureLimits()).displays).length === 0)()`,
      'Reset did not persist'
    )
    await click('[data-fixture-view="app"]')
    await waitForExpression(
      debuggerClient,
      `document.querySelector('[data-control="gamma"]')?.dataset.gammaMax === '2.8' && document.querySelector('[data-part="gamma-limit-note"]') === null`,
      'Reset did not clear the note and restore the initial range'
    )
    await debuggerClient.send('Browser.close').catch(() => {})
    await exited
    globalThis.console.log(
      'Seeded gamma limits: both control layouts, both themes, tooltip and persisted Reset passed.'
    )
  } finally {
    debuggerClient?.close()
    if (child !== undefined && child.exitCode === null) {
      // Only the helper-free fixture created here, never a product or user process.
      child.kill()
      await exited?.catch(() => {})
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  }
}
