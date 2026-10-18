import { Alert, Button, Code, Stack } from '@mantine/core'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Shows what went wrong instead of an empty page, with a way back. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <Alert color="red" title="Diese Seite konnte nicht angezeigt werden">
          <Stack gap="sm">
            <span>Bitte laden Sie die Seite neu. Tritt der Fehler wieder auf, schicken Sie uns diese Meldung:</span>
            <Code block>{this.state.error.message}</Code>
            <Button w="fit-content" onClick={() => window.location.reload()}>
              Seite neu laden
            </Button>
          </Stack>
        </Alert>
      </div>
    )
  }
}
