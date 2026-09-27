// Renders the website's committed icon and social-card images from the brand
// PNGs at the repository root. Run with `npm run render:assets --workspace
// @chromashift/website` after changing the brand assets or social/social-card.html.
import { app, BrowserWindow, nativeImage } from 'electron'
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const websiteDirectory = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(websiteDirectory, '..', '..')
const publicDirectory = join(websiteDirectory, 'public')
const icons = {
  darkmode: join(repositoryRoot, 'chromashift-icon-darkmode.png'),
  lightmode: join(repositoryRoot, 'chromashift-icon-lightmode.png')
}
const background = '#0e0e11'

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

async function write(relativePath, buffer) {
  const path = join(publicDirectory, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, buffer)
  globalThis.console.log(`${relativePath} (${buffer.length} bytes)`)
}

function resizedPng(source, size) {
  const image = nativeImage.createFromPath(source)
  if (image.isEmpty()) throw new Error(`Could not read ${source}`)
  return image.resize({ width: size, height: size, quality: 'best' }).toPNG()
}

// PNG-compressed ICO entries are supported by every browser that requests /favicon.ico.
function ico(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...pngs.map(({ png }) => png)])
}

async function loadWindow(file, width, height) {
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
  })
  await window.loadFile(file)
  await window.webContents.executeJavaScript(
    'document.fonts.ready.then(() => Promise.all([...document.images].map((image) => image.decode())))'
  )
  return window
}

// Draws the mark centered on the page background for platforms that do not
// honor transparency, such as iOS home-screen icons.
async function paddedIcon(window, size, scale) {
  const dataUrl = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image()
    image.src = ${JSON.stringify(pathToFileURL(icons.darkmode).href)}
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = ${size}
    canvas.height = ${size}
    const context = canvas.getContext('2d')
    context.fillStyle = ${JSON.stringify(background)}
    context.fillRect(0, 0, ${size}, ${size})
    context.imageSmoothingQuality = 'high'
    const mark = Math.round(${size} * ${scale})
    const inset = Math.round((${size} - mark) / 2)
    context.drawImage(image, inset, inset, mark, mark)
    return canvas.toDataURL('image/png')
  })()`)
  return nativeImage.createFromDataURL(dataUrl).toPNG()
}

async function render() {
  await write('icons/mark-darkmode.png', resizedPng(icons.darkmode, 60))
  await write('icons/favicon-darkmode.png', resizedPng(icons.darkmode, 96))
  await write('icons/favicon-lightmode.png', resizedPng(icons.lightmode, 96))
  await write(
    'favicon.ico',
    ico([16, 32, 48].map((size) => ({ size, png: resizedPng(icons.darkmode, size) })))
  )

  const card = await loadWindow(join(websiteDirectory, 'social', 'social-card.html'), 1200, 630)
  const capture = await card.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 630 })
  const { width, height } = capture.getSize()
  if (width !== 1200 || height !== 630) {
    throw new Error(`Social card rendered at ${width}×${height}, expected 1200×630.`)
  }
  await write('media/social-card.png', capture.toPNG())

  await write('icons/apple-touch-icon.png', await paddedIcon(card, 180, 0.72))
  await write('icons/icon-192.png', await paddedIcon(card, 192, 0.72))
  await write('icons/icon-512.png', await paddedIcon(card, 512, 0.72))
  card.destroy()
}

app
  .whenReady()
  .then(render)
  .then(
    () => app.quit(),
    (error) => {
      globalThis.console.error(error)
      app.exit(1)
    }
  )
