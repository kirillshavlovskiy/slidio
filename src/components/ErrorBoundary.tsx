'use client'

import { Component, ReactNode } from 'react'
import { reportReactError } from '@/lib/clientLog'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string
}

/**
 * App-wide error boundary. Without this, ANY render-time exception bubbles to the
 * Next.js root, triggers a full reload, and silently wipes in-memory state (e.g.
 * the message the user just typed) — which looks like "the app ate my message".
 *
 * Instead we catch the crash, log it loudly to the terminal (via /api/log) AND
 * the browser console, and show a recoverable panel with the actual error so the
 * failure is visible and the rest of the session isn't lost.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    this.setState({ componentStack: info.componentStack })
    reportReactError(error, info.componentStack)
  }

  private reset = () => this.setState({ error: null, componentStack: '' })

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060d1a] p-6">
        <div className="max-w-2xl w-full rounded-xl border border-[#7f1d1d] bg-[#1a1212] p-6 shadow-2xl">
          <p className="text-sm font-bold tracking-widest text-[#f87171]">SOMETHING CRASHED</p>
          <p className="mt-2 text-base text-white">
            The editor hit a runtime error and stopped this view from rendering. Your work is still
            saved — this is recoverable.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-[#0b0808] p-3 text-xs text-[#fca5a5] whitespace-pre-wrap">
            {error.message}
          </pre>
          {componentStack && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[#94a3b8]">Component stack</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-[#0b0808] p-3 text-[10px] text-[#64748b] whitespace-pre-wrap">
                {componentStack}
              </pre>
            </details>
          )}
          <p className="mt-3 text-xs text-[#64748b]">
            The full stack was printed to the dev terminal (look for a CLIENT ERROR block).
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={this.reset}
              className="rounded-md bg-[#16a34a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#15803d]"
            >
              Try to recover
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md border border-[#334155] px-4 py-2 text-sm text-[#cbd5e1] hover:bg-[#1e293b]"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    )
  }
}
