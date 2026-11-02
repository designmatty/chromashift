import { useEffect } from 'react'
import { applyColorScheme } from '@/lib/color-scheme'
import type { ProductState } from '@shared/product-api.js'

export function useProductTheme(theme: ProductState['settings']['theme']): void {
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      applyColorScheme(root, theme === 'system' ? (media.matches ? 'dark' : 'light') : theme)
    }

    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}
