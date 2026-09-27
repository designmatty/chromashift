import './styles/index.css'
import { fetchLatestInstaller } from './release'

// The static links already point at GitHub releases. Point them at the newest
// installer when the lookup succeeds; otherwise leave the fallback in place.
async function linkLatestInstaller(): Promise<void> {
  const installer = await fetchLatestInstaller()
  if (installer === undefined) return
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-download-link]')) {
    link.href = installer.url
  }
  for (const line of document.querySelectorAll('[data-installer-line]')) {
    line.textContent = installer.filename
  }
}

if (document.querySelector('[data-download-link]') !== null) {
  linkLatestInstaller().catch(() => undefined)
}
