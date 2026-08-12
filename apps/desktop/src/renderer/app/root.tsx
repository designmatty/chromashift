import { Heading, Spinner, Stack, Text } from '@chakra-ui/react'
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
      <CenterState role="alert" title="ChromaShift could not start">
        {product.error.message}
      </CenterState>
    )
  }
  if (product.state === null) {
    return <CenterState busy>Connecting to DisplayService…</CenterState>
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
  return <CenterState busy>Loading ChromaShift…</CenterState>
}

export function CenterState({
  children,
  busy = false,
  role,
  title
}: {
  children: React.ReactNode
  busy?: boolean
  role?: 'alert'
  title?: string
}): React.JSX.Element {
  return (
    <Stack
      minH="260px"
      placeContent="center"
      align="center"
      gap="10px"
      color="fg.muted"
      aria-busy={busy || undefined}
      role={role}
    >
      {busy && <Spinner size="md" borderWidth="2px" color="fg" />}
      {title !== undefined && (
        <Heading as="h1" color="fg" fontSize="16px">
          {title}
        </Heading>
      )}
      {typeof children === 'string' ? <Text>{children}</Text> : children}
    </Stack>
  )
}
