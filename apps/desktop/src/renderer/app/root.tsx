import { MiniPanel } from '@/features/mini-panel/mini-panel'
import { useProduct } from '@/hooks/use-product'
import { MainApp } from './main-app'

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
  return new URLSearchParams(location.search).get('panel') === 'mini' ? (
    <MiniPanel product={product.state} />
  ) : (
    <MainApp product={product.state} />
  )
}
