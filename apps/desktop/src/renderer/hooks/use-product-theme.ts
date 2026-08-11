import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import type { ProductState } from '../../shared/product-api.js'

export function useProductTheme(theme: ProductState['settings']['theme']): void {
  const { setTheme } = useTheme()

  useEffect(() => {
    setTheme(theme)
  }, [setTheme, theme])
}
