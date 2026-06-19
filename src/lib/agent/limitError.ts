/** Structured agent step-limit / timeout errors for chat UI. */

export type AgentLimitReached = {
  type:
    | 'step_limit'
    | 'timeout'
    | 'apply_limit'
    | 'oscillation'
    | 'no_tool_call'
    | 'spacing_limit'
    | 'overloaded'
    | 'rate_limit'
  stepLimit?: number
  applyLimit?: number
  modifiedSlideIds: string[]
  modifiedOverflow?: number
  applyBatches?: number
  lastAction?: string
  hasChanges: boolean
  /** When true, Continue resumes the exact agent thread (not a fresh run). */
  pausable?: boolean
}

export function buildStepLimitError(opts: {
  stepLimit: number
  modifiedSlideIds: string[]
  lastAction?: string
  hasChanges: boolean
}): AgentLimitReached {
  const overflow =
    opts.modifiedSlideIds.length > 5 ? opts.modifiedSlideIds.length - 5 : undefined
  return {
    type: 'step_limit',
    stepLimit: opts.stepLimit,
    modifiedSlideIds: opts.modifiedSlideIds.slice(0, 5),
    modifiedOverflow: overflow,
    lastAction: opts.lastAction,
    hasChanges: opts.hasChanges,
    pausable: true,
  }
}

export function buildTimeoutError(opts: {
  modifiedSlideIds: string[]
  applyBatches?: number
  lastAction?: string
  hasChanges: boolean
}): AgentLimitReached {
  const overflow =
    opts.modifiedSlideIds.length > 6 ? opts.modifiedSlideIds.length - 6 : undefined
  return {
    type: 'timeout',
    modifiedSlideIds: opts.modifiedSlideIds.slice(0, 6),
    modifiedOverflow: overflow,
    applyBatches: opts.applyBatches,
    lastAction: opts.lastAction,
    hasChanges: opts.hasChanges,
    pausable: opts.hasChanges,
  }
}

export function buildApplyLimitError(opts: {
  applyLimit: number
  modifiedSlideIds: string[]
  applyBatches?: number
  lastAction?: string
  hasChanges: boolean
  oscillation?: boolean
}): AgentLimitReached {
  const overflow =
    opts.modifiedSlideIds.length > 5 ? opts.modifiedSlideIds.length - 5 : undefined
  return {
    type: opts.oscillation ? 'oscillation' : 'apply_limit',
    applyLimit: opts.applyLimit,
    modifiedSlideIds: opts.modifiedSlideIds.slice(0, 5),
    modifiedOverflow: overflow,
    applyBatches: opts.applyBatches,
    lastAction: opts.lastAction,
    hasChanges: opts.hasChanges,
    pausable: true,
  }
}

export function buildNoToolCallPauseError(opts: {
  modifiedSlideIds: string[]
  lastAction?: string
  hasChanges: boolean
}): AgentLimitReached {
  return {
    type: 'no_tool_call',
    modifiedSlideIds: opts.modifiedSlideIds.slice(0, 5),
    modifiedOverflow:
      opts.modifiedSlideIds.length > 5 ? opts.modifiedSlideIds.length - 5 : undefined,
    lastAction: opts.lastAction,
    hasChanges: opts.hasChanges,
    pausable: true,
  }
}

export function buildOverloadedError(opts: {
  modifiedSlideIds: string[]
  applyBatches?: number
  lastAction?: string
  hasChanges: boolean
}): AgentLimitReached {
  const overflow =
    opts.modifiedSlideIds.length > 5 ? opts.modifiedSlideIds.length - 5 : undefined
  return {
    type: 'overloaded',
    modifiedSlideIds: opts.modifiedSlideIds.slice(0, 5),
    modifiedOverflow: overflow,
    applyBatches: opts.applyBatches,
    lastAction: opts.lastAction,
    hasChanges: opts.hasChanges,
    pausable: true,
  }
}

export function buildRateLimitError(opts: {
  modifiedSlideIds: string[]
  applyBatches?: number
  lastAction?: string
  hasChanges: boolean
}): AgentLimitReached {
  const overflow =
    opts.modifiedSlideIds.length > 5 ? opts.modifiedSlideIds.length - 5 : undefined
  return {
    type: 'rate_limit',
    modifiedSlideIds: opts.modifiedSlideIds.slice(0, 5),
    modifiedOverflow: overflow,
    applyBatches: opts.applyBatches,
    lastAction: opts.lastAction,
    hasChanges: opts.hasChanges,
    pausable: true,
  }
}

export function buildSpacingLimitError(opts: {
  modifiedSlideIds: string[]
  applyBatches?: number
  lastAction?: string
  hasChanges: boolean
}): AgentLimitReached {
  const overflow =
    opts.modifiedSlideIds.length > 5 ? opts.modifiedSlideIds.length - 5 : undefined
  return {
    type: 'spacing_limit',
    modifiedSlideIds: opts.modifiedSlideIds.slice(0, 5),
    modifiedOverflow: overflow,
    applyBatches: opts.applyBatches,
    lastAction: opts.lastAction,
    hasChanges: opts.hasChanges,
    pausable: true,
  }
}

/** Plain-text fallback label (history, logs). */
export function formatAgentLimitError(info: AgentLimitReached): string {
  const shown = info.modifiedSlideIds
  const overflowSuffix =
    info.modifiedOverflow && info.modifiedOverflow > 0
      ? ` +${info.modifiedOverflow} more`
      : ''
  const slideList = shown.length ? `${shown.join(', ')}${overflowSuffix}` : ''

  if (info.type === 'step_limit') {
    let msg = `Reached the ${info.stepLimit ?? '?'} step limit before finishing.`
    if (shown.length) {
      msg += ` Modified ${shown.length + (info.modifiedOverflow ?? 0)} slide(s): ${slideList}.`
      if (info.hasChanges) msg += ' Use Accept / Decline above the canvas.'
    } else {
      msg += ' No slides were modified.'
    }
    if (info.lastAction) msg += ` Last action: ${info.lastAction}.`
    return `${msg} Say "continue" to resume from the exact step (context preserved).`
  }

  if (info.type === 'apply_limit' || info.type === 'oscillation') {
    const kind = info.type === 'oscillation' ? 'identical edit loop' : 'edit batch limit'
    let msg = `Paused: reached the ${info.applyLimit ?? '?'}-${kind} for this segment.`
    if (shown.length) {
      msg += ` Modified ${shown.length + (info.modifiedOverflow ?? 0)} slide(s): ${slideList}.`
      if (info.hasChanges) msg += ' Use Accept / Decline above the canvas.'
    }
    if (info.applyBatches) msg += ` (${info.applyBatches} apply batch(es) so far.)`
    if (info.lastAction) msg += ` Last action: ${info.lastAction}.`
    return `${msg} Say "continue" to resume the agent pipeline from this exact point.`
  }

  if (info.type === 'no_tool_call') {
    let msg = 'Paused: agent stopped without calling a tool.'
    if (shown.length) msg += ` Modified ${shown.length} slide(s): ${slideList}.`
    if (info.lastAction) msg += ` Last action: ${info.lastAction}.`
    return `${msg} Say "continue" to resume with full context.`
  }

  if (info.type === 'overloaded') {
    let msg = 'Paused: Anthropic API is temporarily overloaded.'
    if (shown.length) {
      msg += ` Modified ${shown.length + (info.modifiedOverflow ?? 0)} slide(s): ${slideList}.`
      if (info.hasChanges) msg += ' Use Accept / Decline above the canvas.'
    }
    if (info.lastAction) msg += ` Last action: ${info.lastAction}.`
    return `${msg} Wait ~30s, then say "continue" to resume from the exact step.`
  }

  if (info.type === 'rate_limit') {
    let msg = 'Paused: Anthropic rate limit reached for this minute.'
    if (shown.length) {
      msg += ` Modified ${shown.length + (info.modifiedOverflow ?? 0)} slide(s): ${slideList}.`
      if (info.hasChanges) msg += ' Use Accept / Decline above the canvas.'
    }
    if (info.lastAction) msg += ` Last action: ${info.lastAction}.`
    return `${msg} Wait ~60s, then say "continue" to resume from the exact step.`
  }

  if (info.type === 'spacing_limit') {
    let msg = 'Paused: spacing/balance review limit reached for this segment.'
    if (shown.length) {
      msg += ` Modified ${shown.length + (info.modifiedOverflow ?? 0)} slide(s): ${slideList}.`
      if (info.hasChanges) msg += ' Use Accept / Decline above the canvas.'
    }
    if (info.applyBatches) msg += ` (${info.applyBatches} apply batch(es) so far.)`
    if (info.lastAction) msg += ` Last action: ${info.lastAction}.`
    return `${msg} Say "continue" to resume spacing fixes from the exact step.`
  }

  let msg = 'This agent step took too long (server limit).'
  if (info.applyBatches) msg += `\n· ${info.applyBatches} apply batch(es) completed`
  if (shown.length) {
    msg += `\n· Slides modified (${shown.length + (info.modifiedOverflow ?? 0)}): ${slideList}`
  } else {
    msg += '\n· No slides were modified before the timeout.'
  }
  if (info.lastAction) msg += `\n· Last completed action: ${info.lastAction}`
  msg += '\n\n'
  msg += info.hasChanges
    ? 'Changes are live on the canvas — use Accept / Decline in the bar above.'
    : 'No changes were applied — narrow scope (e.g. "fix layout on slides 1–6") or retry.'
  return msg
}

/** Parse legacy plain-text limit errors already in display history. */
export function parseAgentLimitError(label: string): AgentLimitReached | null {
  const t = label.trim()
  if (!t) return null

  const stepMatch = t.match(/^Reached the (\d+)-step limit before finishing\./)
  if (stepMatch) {
    const stepLimit = Number(stepMatch[1])
    const modifiedMatch = t.match(/Modified (\d+) slide\(s\):\s*([^.]+)/)
    const ids = modifiedMatch?.[2]
      ? modifiedMatch[2]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : []
    const overflowMatch = modifiedMatch?.[2]?.match(/\+(\d+) more/)
    const lastAction = t.match(/Last action:\s*([^.]+)/)?.[1]?.trim()
    const hasChanges = ids.length > 0 || !t.includes('No slides were modified')
    return {
      type: 'step_limit',
      stepLimit,
      modifiedSlideIds: ids.filter(id => !/^\+?\d+ more$/.test(id)),
      modifiedOverflow: overflowMatch ? Number(overflowMatch[1]) : undefined,
      lastAction,
      hasChanges,
    }
  }

  if (/took too long \(server limit\)/i.test(t)) {
    const batchMatch = t.match(/(\d+) apply batch\(es\) completed/)
    const modifiedMatch = t.match(/Slides modified \((\d+)\):\s*([^\n]+)/)
    const ids = modifiedMatch?.[2]
      ? modifiedMatch[2]
          .split(',')
          .map(s => s.trim())
          .filter(s => s && !/^\+?\d+ more$/.test(s))
      : []
    const overflowMatch = modifiedMatch?.[2]?.match(/\+(\d+) more/)
    const lastAction = t.match(/Last completed action:\s*([^\n]+)/)?.[1]?.trim()
    const hasChanges =
      ids.length > 0 ||
      (!t.includes('No slides were modified') && !t.includes('No changes were applied'))
    return {
      type: 'timeout',
      modifiedSlideIds: ids,
      modifiedOverflow: overflowMatch ? Number(overflowMatch[1]) : undefined,
      applyBatches: batchMatch ? Number(batchMatch[1]) : undefined,
      lastAction,
      hasChanges,
    }
  }

  if (/^Paused: reached the (\d+)-edit ceiling/i.test(t) || /^Stopped: reached the (\d+)-edit ceiling/i.test(t)) {
    const applyLimit = Number(t.match(/(\d+)-edit ceiling/)?.[1] ?? 0)
    const lastAction = t.match(/Last action:\s*([^.]+)/)?.[1]?.trim()
    const hasChanges = !t.includes('No slides were modified')
    return {
      type: 'apply_limit',
      applyLimit,
      modifiedSlideIds: [],
      lastAction,
      hasChanges,
      pausable: true,
    }
  }

  if (/^Paused:/i.test(t) && /identical edit/i.test(t)) {
    return {
      type: 'oscillation',
      modifiedSlideIds: [],
      hasChanges: true,
      pausable: true,
    }
  }

  if (/stopped without finishing \(no tool call\)/i.test(t)) {
    return {
      type: 'no_tool_call',
      modifiedSlideIds: [],
      hasChanges: !t.includes('No slides'),
      pausable: true,
    }
  }

  return null
}
