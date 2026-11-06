import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { promisify } from 'node:util'
import { build } from 'vite'

/** Real native dialog and production close controller, with no native service or display writes. */
export async function verifyCloseRetryGuidance({
  desktopDirectory,
  screenshotDirectory,
  electronPath,
  environment
}) {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-close-retry-'))
  if (!directory.startsWith(join(tmpdir(), 'chromashift-close-retry-'))) {
    throw new Error('Unexpected close retry fixture cleanup path.')
  }
  const entry = join(directory, 'fixture.ts')
  const mainPath = (name) =>
    JSON.stringify(join(desktopDirectory, 'src', 'main', name).replaceAll('\\', '/'))
  await writeFile(
    entry,
    `
import { app, BrowserWindow, dialog } from 'electron'
import { AppPanelCloseController } from ${mainPath('app-panel-close-controller.ts')}
import { PreviewRestoreError } from ${mainPath('preview-session-controller.ts')}
import { confirmRestoreRetry } from ${mainPath('restore-retry-dialog.ts')}
app.disableHardwareAcceleration()
const watchdog = setTimeout(() => { console.error('Close retry fixture timed out'); app.exit(1) }, 30000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ title: 'ChromaShift close retry smoke', width: 800, height: 600,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html,' + encodeURIComponent('<title>ChromaShift close retry smoke</title><body style="background:#111114;color:white;font:16px Segoe UI;padding:32px">Close retry presentation fixture. Display restoration is faked.</body>'))
  let failed = true
  let released = false
  const controller = new AppPanelCloseController({
    isExiting: () => false, closeBehavior: () => 'tray', isDestroyed: () => window.isDestroyed(),
    isVisible: () => window.isVisible(), flushWindowState: () => {}, requestShutdown: () => { throw Error('Unexpected quit') },
    cancelNonOverride: async (done) => { if (failed) throw new PreviewRestoreError(['fake display restore failure']); done() },
    notifyClosed: () => {}, releaseToTray: () => { released = true; window.destroy() },
    errors: { show: () => window.show(), showError: (title, message) => confirmRestoreRetry(dialog, title, message, window) },
    logger: { write: (event) => console.log(JSON.stringify(event)) }
  })
  await controller.handleClose({ preventDefault() {} })
  if (released || window.isDestroyed() || !window.isVisible()) throw Error('Keep the window open did not preserve the app')
  failed = false
  await controller.handleClose({ preventDefault() {} })
  if (!released || !window.isDestroyed()) throw Error('The later successful close did not release the app')
  console.log('Close retry native guidance passed.')
}).catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => { clearTimeout(watchdog); app.quit() })
`
  )
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      ssr: { noExternal: true },
      resolve: {
        alias: {
          '@main': join(desktopDirectory, 'src', 'main'),
          '@shared': join(desktopDirectory, 'src', 'shared')
        }
      },
      build: {
        ssr: entry,
        outDir: directory,
        emptyOutDir: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'fixture.cjs' }
        }
      }
    })
    const child = spawn(
      electronPath,
      [join(directory, 'fixture.cjs'), `--user-data-dir=${join(directory, 'data')}`],
      {
        env: environment,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let output = ''
    child.stdout.on('data', (data) => {
      output += data
    })
    child.stderr.on('data', (data) => {
      output += data
    })
    // This child is only the display-free fixture, never the product/helper process.
    const childDeadline = setTimeout(() => child.kill(), 35_000)
    const exited = new Promise((resolve, reject) => {
      child.on('error', (error) => {
        clearTimeout(childDeadline)
        reject(error)
      })
      child.on('exit', (code) => {
        clearTimeout(childDeadline)
        if (code === 0) resolve()
        else reject(new Error(`Close retry fixture exited ${code}: ${output}`))
      })
    })
    const path = join(screenshotDirectory, 'close-retry-guidance-native.png')
    const command = `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ChromaShiftRetryCapture {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
}
'@
$condition = [System.Windows.Automation.AndCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]${child.pid}),
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Display settings need attention'))
$deadline = [DateTime]::UtcNow.AddSeconds(20)
$prompt = $null
while ($null -eq $prompt -and [DateTime]::UtcNow -lt $deadline) {
  $prompt = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if ($null -eq $prompt) { Start-Sleep -Milliseconds 100 }
}
if ($null -eq $prompt) { throw 'The smoke-owned close retry prompt did not open.' }
$handle = [IntPtr]$prompt.Current.NativeWindowHandle
try {
  foreach ($label in @('Try again', 'Keep the window open')) {
    if ($null -eq $prompt.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $label))) {
      throw "The close retry prompt did not offer $label."
    }
  }
  $ownerCondition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]${child.pid}),
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'ChromaShift close retry smoke'))
  $owner = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $ownerCondition)
  if ($null -eq $owner -or [ChromaShiftRetryCapture]::IsWindowEnabled([IntPtr]$owner.Current.NativeWindowHandle)) {
    throw 'The close retry prompt was not modal to its app window.'
  }
  $rect = $prompt.Current.BoundingRectangle
  $bitmap = [System.Drawing.Bitmap]::new([int]$rect.Width, [int]$rect.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    [void][ChromaShiftRetryCapture]::DwmFlush()
    $graphics.CopyFromScreen([int]$rect.Left, [int]$rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save('${path.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
} finally {
  [void][ChromaShiftRetryCapture]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
}
`
    const results = await Promise.allSettled([
      promisify(execFile)(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { windowsHide: true, timeout: 30_000 }
      ),
      exited
    ])
    const failure = results.find((result) => result.status === 'rejected')
    if (failure !== undefined) throw new Error(`${failure.reason}\nFixture output:\n${output}`)
    if (!output.includes('Close retry native guidance passed.')) throw new Error(output)
    globalThis.console.log(
      'Close retry guidance: native window-modal capture, Keep open, and later successful close passed.'
    )
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  }
}
