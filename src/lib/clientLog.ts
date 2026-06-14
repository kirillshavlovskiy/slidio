'use client'

/**
 * Forward a client-side error to the server so it appears in the dev terminal
 * (the place people actually watch). Also logs to the browser console. Best-effort
 * and fire-and-forget — never throws, never blocks the UI.
 */
export function reportClientError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const err = error instanceof Error ? error : new Error(String(error))
  // Always log locally first so it's visible in the browser console too.
  // eslint-disable-next-line no-console
  console.error(`[${context}]`, err, extra ?? '')

  try {
    const payload = JSON.stringify({
      level: 'error',
      context,
      message: err.message,
      stack: err.stack,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      extra,
    })
    // keepalive lets the report survive even if the page is unloading/reloading.
    void fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // ignore — logging must never break the app
  }
}

/**
 * Report a React render crash (with the component stack) to the terminal.
 */
export function reportReactError(error: Error, componentStack: string): void {
  // eslint-disable-next-line no-console
  console.error('[react-error-boundary]', error, componentStack)
  try {
    void fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'error',
        context: 'react-error-boundary',
        message: error.message,
        stack: error.stack,
        componentStack,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // ignore
  }
}

let installed = false
/**
 * Install global listeners that pipe uncaught errors and unhandled promise
 * rejections to the terminal. Idempotent.
 */
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', event => {
    reportClientError('window.onerror', event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    })
  })

  window.addEventListener('unhandledrejection', event => {
    reportClientError('unhandledrejection', event.reason)
  })
}
