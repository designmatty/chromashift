import '@/styles/index.css'
import { initColorDemo } from '@/color-demo'
import { fetchLatestInstaller, installerLine } from '@/release'

initColorDemo()

// The static links already point at GitHub releases. Point them at the newest
// installer when the lookup succeeds; otherwise leave the fallback in place.
async function linkLatestInstaller(): Promise<void> {
  const installer = await fetchLatestInstaller()
  if (installer === undefined) return
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-download-link]')) {
    link.href = installer.url
  }
  const line = installerLine(installer)
  if (line === undefined) return
  for (const element of document.querySelectorAll('[data-installer-line]')) {
    element.textContent = line
  }
}

if (document.querySelector('[data-download-link]') !== null) {
  linkLatestInstaller().catch(() => undefined)
}
