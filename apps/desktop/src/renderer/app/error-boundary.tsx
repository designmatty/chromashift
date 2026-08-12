import { Button, Text } from '@chakra-ui/react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { CenterState } from './root'

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
      <CenterState role="alert" title="ChromaShift could not render">
        <Text>{this.state.error.message}</Text>
        <Button onClick={() => location.reload()}>Reload</Button>
      </CenterState>
    )
  }
}
