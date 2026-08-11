import { Button } from '@chakra-ui/react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  public override state = { error: null as Error | null }

  public static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info)
  }

  public override render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return (
      <div className="center-state" role="alert">
        <h1>ChromaShift could not render</h1>
        <p>{this.state.error.message}</p>
        <Button colorPalette="brand" onClick={() => location.reload()}>
          Reload
        </Button>
      </div>
    )
  }
}
