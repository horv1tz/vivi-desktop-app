import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertOctagon } from 'lucide-react'
import i18n from '../i18n'
import { Button } from './ui/Button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * UX-04: an uncaught error while rendering (a bug in a message/tool-card renderer, a bad response
 * shape, ...) previously unmounted the whole React tree with no feedback — a blank window the
 * user has no obvious way to recover from short of force-quitting. This can't happen for a main
 * process crash (that's handled separately via `render-process-gone`), only for a JS exception
 * thrown during render in this renderer's own tree.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack)
  }

  private reset = (): void => this.setState({ error: null })

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-fg">
        <AlertOctagon size={40} className="text-danger" />
        <h1 className="text-xl font-semibold">{i18n.t('errorBoundary.title')}</h1>
        <p className="max-w-md text-sm text-muted">{i18n.t('errorBoundary.body')}</p>
        <p className="max-w-md truncate text-xs text-faint selectable" title={error.message}>
          {error.message}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={this.reset}>
            {i18n.t('errorBoundary.tryToContinue')}
          </Button>
          <Button variant="primary" onClick={() => window.location.reload()}>
            {i18n.t('errorBoundary.reload')}
          </Button>
        </div>
      </div>
    )
  }
}
