import { useEffect, useState } from 'react'
import type { ProductError, ProductState } from '../../shared/product-api.js'

export function useProduct(): {
  state: ProductState | null
  error: ProductError | null
} {
  const [state, setState] = useState<ProductState | null>(null)
  const [error, setError] = useState<ProductError | null>(null)

  useEffect(() => {
    void window.chromaShift
      .getState()
      .then((result) => (result.ok ? setState(result.value) : setError(result.error)))
    window.chromaShift.onStateChanged(setState)
  }, [])

  return { state, error }
}
