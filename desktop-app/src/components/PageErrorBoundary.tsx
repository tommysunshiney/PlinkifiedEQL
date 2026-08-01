import { Component, ErrorInfo, ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('PEQL page render error:', error, info)
  }

  componentDidUpdate(previousProps: Props) {
    if (previousProps.children !== this.props.children && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <section className="page-error">
          <h2>This page hit a snag</h2>
          <p>{this.state.error.message}</p>
          <p>The rest of PEQL is still running. Switch tabs and try again.</p>
        </section>
      )
    }

    return this.props.children
  }
}
