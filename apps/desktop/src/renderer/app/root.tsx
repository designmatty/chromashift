import { useProduct } from '@/hooks/use-product'
import { lazy, Suspense } from 'react'

const MainApp = lazy(async () => {
  const module = await import('./main-app')
  return { default: module.MainApp }
})
const MiniPanel = lazy(async () => {
  const module = await import('@/features/mini-panel/mini-panel')
  return { default: module.MiniPanel }
})

export function Root(): React.JSX.Element {
  const product = useProduct()
  if (product.error !== null) {
    return (
      <div className="center-state" role="alert">
        <h1>ChromaShift could not start</h1>
        <p>{product.error.message}</p>
      </div>
    )
  }
  if (product.state === null) {
    return (
      <div className="center-state" aria-busy="true">
        <div className="spinner" />
        <p>Connecting to DisplayService…</p>
      </div>
    )
  }
  return (
    <Suspense fallback={<LoadingState />}>
      {new URLSearchParams(location.search).get('panel') === 'mini' ? (
        <MiniPanel product={product.state} />
      ) : (
        <MainApp product={product.state} />
      )}
    </Suspense>
  )
}

function LoadingState(): React.JSX.Element {
  return (
    <div className="center-state" aria-busy="true">
      <div className="spinner" />
      <p>Loading ChromaShift…</p>
    </div>
  )
}
