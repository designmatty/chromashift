import { useEffect } from 'react'
import type { ProductState } from '../../shared/product-api.js'

export function useProductTheme(theme: ProductState['settings']['theme']): void {
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      root.classList.toggle('dark', resolved === 'dark')
      root.classList.toggle('light', resolved === 'light')
      root.style.colorScheme = resolved
    }

    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}
