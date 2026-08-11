import type { ProductError, ProductResult } from '../../shared/product-api.js'

export async function run<T>(
  request: Promise<ProductResult<T>>,
  setError: (error: ProductError | null) => void
): Promise<T | undefined> {
  try {
    const result = await request
    if (!result.ok) {
      setError(result.error)
      return undefined
    }
    return result.value
  } catch (error) {
    setError({
      code: 'OPERATION_FAILED',
      message: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}

export function formatName(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase())
}
