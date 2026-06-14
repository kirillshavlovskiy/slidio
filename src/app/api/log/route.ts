import { NextRequest, NextResponse } from 'next/server'

/**
 * Client-error sink. The browser POSTs runtime errors (render crashes, unhandled
 * promise rejections, caught failures in handlers) here so they show up in the
 * SAME dev terminal as the server logs — otherwise a client crash is invisible to
 * anyone watching `npm run dev`. We print a loud, structured block so failures are
 * easy to spot and tell you WHAT failed, WHERE, and WHY.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const {
      level = 'error',
      context = 'client',
      message = '(no message)',
      stack,
      componentStack,
      url,
      extra,
    } = body as {
      level?: 'error' | 'warn' | 'info'
      context?: string
      message?: string
      stack?: string
      componentStack?: string
      url?: string
      extra?: unknown
    }

    const tag = level === 'warn' ? 'CLIENT WARN' : level === 'info' ? 'CLIENT INFO' : 'CLIENT ERROR'
    const lines: string[] = [
      `\n╔═══════════════════ ${tag} ═══════════════════`,
      `║ context : ${context}`,
      `║ message : ${message}`,
    ]
    if (url) lines.push(`║ url     : ${url}`)
    if (extra !== undefined) {
      let extraStr: string
      try {
        extraStr = typeof extra === 'string' ? extra : JSON.stringify(extra)
      } catch {
        extraStr = String(extra)
      }
      lines.push(`║ extra   : ${extraStr}`)
    }
    if (componentStack) {
      lines.push('║ component stack:')
      for (const l of String(componentStack).split('\n')) if (l.trim()) lines.push(`║   ${l.trim()}`)
    }
    if (stack) {
      lines.push('║ stack:')
      for (const l of String(stack).split('\n')) if (l.trim()) lines.push(`║   ${l.trim()}`)
    }
    lines.push('╚════════════════════════════════════════════════════')

    const out = lines.join('\n')
    if (level === 'warn') console.warn(out)
    else if (level === 'info') console.info(out)
    else console.error(out)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/log] failed to record client error:', err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
