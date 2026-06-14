/**
 * Knowledge Context Builder
 * Implements the DeckPilot context management strategy:
 * "The entire graph is never sent to the model. Retrieve only what's needed."
 */

import type { KnowledgeLayer, KnowledgeLayerType, DecisionRecord, SlideData } from './types'

// ── Relevance retrieval helpers ───────────────────────────────────────────────

// Small stopword list so scoring keys on meaningful terms, not glue words.
const STOPWORDS = new Set(
  ('the a an and or of to in on for with is are be this that it as at by from into ' +
    'make set change add use using your you our we their them they all any each more ' +
    'less please can could should would will do does just so then than only also').split(' ')
)

/** Extract distinct lowercase keyword tokens (len ≥ 3, minus stopwords). */
function keywordSet(text: string): Set<string> {
  const out = new Set<string>()
  ;(text.toLowerCase().match(/[a-z0-9#]{3,}/g) || []).forEach(w => {
    if (!STOPWORDS.has(w)) out.add(w)
  })
  return out
}

/** Truncate on a word boundary with an explicit marker (never silent). */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max).replace(/\s+\S*$/, '') + ' … [truncated]'
}

/** Concatenate an active slide's text so retrieval can key on its content too. */
export function activeSlideText(slides: SlideData[] | undefined, activeSlideId: string): string {
  const slide = slides?.find(s => s.id === activeSlideId)
  if (!slide) return ''
  return slide.elements.map(e => e.content || '').filter(Boolean).join(' ')
}

export interface KnowledgeContextOptions {
  /** The user's current instruction — drives relevance scoring. */
  instruction?: string
  /** Text of the active slide — adds task context to scoring. */
  slideText?: string
  /** Cap accepted/rejected decisions to the most relevant/recent (default true). */
  recentOnly?: boolean
  /** Total character budget for knowledge layers (default ~6000 ≈ 1.5k tokens). */
  charBudget?: number
}

// ── Context assembly ──────────────────────────────────────────────────────────

export function buildKnowledgeContext(
  layers: KnowledgeLayer[],
  decisions: DecisionRecord[],
  activeSlideId: string,
  opts: KnowledgeContextOptions = {}
): string {
  const recentOnly = opts.recentOnly ?? true
  const enabled = layers.filter(l => l.enabled)
  if (enabled.length === 0 && decisions.length === 0) return ''

  const parts: string[] = []

  // ── Smart retrieval: never dump the whole graph. Score each layer by keyword
  // overlap with the instruction + active slide, always keep global guidance
  // (style/stakeholder), truncate long layers, and respect a total budget. ──
  const PER_LAYER_CHARS = 1200
  const totalBudget = opts.charBudget ?? 6000
  const ALWAYS = new Set<KnowledgeLayerType>(['style', 'stakeholder'])
  const query = keywordSet(`${opts.instruction ?? ''} ${opts.slideText ?? ''}`)

  const scoreOf = (l: KnowledgeLayer): number => {
    let s = 0
    if (query.size > 0) {
      const lk = keywordSet(`${l.name} ${l.content}`)
      Array.from(query).forEach(w => {
        if (lk.has(w)) s++
      })
    }
    // Global guidance is small and broadly relevant — bias it in even with no
    // keyword hits so tone/brand rules are never dropped.
    if (ALWAYS.has(l.type)) s += 3
    return s
  }

  const ranked = enabled
    .map(l => ({ l, s: scoreOf(l) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)

  const selected: KnowledgeLayer[] = []
  let used = 0
  ranked.forEach(({ l }) => {
    const piece = truncate(l.content, PER_LAYER_CHARS)
    // Always-include layers bypass the budget gate; others must fit.
    if (!ALWAYS.has(l.type) && used + piece.length > totalBudget) return
    selected.push({ ...l, content: piece })
    used += piece.length
  })

  const byType = (t: KnowledgeLayerType) => selected.filter(l => l.type === t)
  const emit = (header: string, items: KnowledgeLayer[], withName = false) => {
    if (!items.length) return
    parts.push(header)
    items.forEach(l => parts.push(withName ? `**${l.name}**\n${l.content}` : l.content))
  }

  emit('## STYLE SYSTEM', byType('style'))
  emit('## TERMINOLOGY REGISTRY', byType('terminology'))
  emit('## STAKEHOLDER & AUDIENCE PROFILE', byType('stakeholder'))
  emit('## WORKSPACE INTELLIGENCE', byType('workspace'))
  emit('## KNOWLEDGE BASE', byType('custom'), true)

  // Surface what was held back so omission is visible, not silent.
  const omitted = enabled.length - selected.length
  if (omitted > 0) {
    parts.push(
      `_(${omitted} less-relevant knowledge layer(s) omitted for this request; open the Knowledge panel to review.)_`
    )
  }

  // ── Decision memory (Layer 6: accepted + Layer 7: rejected) ──────────────────
  // Three problems with naive memory we guard against here:
  //   1. Duplicates — the same instruction tried repeatedly floods the prompt.
  //   2. Over-generalization — "X was rejected, never do similar" turns one
  //      context-specific no into a blanket ban. We frame rejections as advisory
  //      and attach the user's reason + slide scope so the model can judge.
  //   3. Irrelevance — decisions about other slides dilute the current task. We
  //      rank decisions touching the active slide first, then by recency.
  const MAX_PER_BUCKET = 8

  const slidePosition = (d: DecisionRecord) =>
    activeSlideId && d.slideIds.includes(activeSlideId) ? 1 : 0

  // Most-relevant-first: active-slide decisions, then most recent.
  const rank = (a: DecisionRecord, b: DecisionRecord) =>
    slidePosition(b) - slidePosition(a) || b.timestamp - a.timestamp

  // Collapse repeats of the same instruction, keeping the latest occurrence.
  const dedupeLatest = (list: DecisionRecord[]) => {
    const byKey = new Map<string, DecisionRecord>()
    for (const d of list) {
      const key = d.instruction.trim().toLowerCase()
      const existing = byKey.get(key)
      if (!existing || d.timestamp > existing.timestamp) byKey.set(key, d)
    }
    return Array.from(byKey.values())
  }

  const scopeLabel = (d: DecisionRecord) => {
    if (!d.slideIds?.length) return ''
    if (activeSlideId && d.slideIds.includes(activeSlideId)) return ' (on this slide)'
    if (d.slideIds.length === 1) return ` (on ${d.slideIds[0]})`
    return ` (on ${d.slideIds.length} slides)`
  }

  const accepted = dedupeLatest(decisions.filter(d => d.status === 'accepted'))
    .sort(rank)
    .slice(0, recentOnly ? MAX_PER_BUCKET : undefined)

  const rejected = dedupeLatest(decisions.filter(d => d.status === 'rejected'))
    .sort(rank)
    .slice(0, recentOnly ? MAX_PER_BUCKET : undefined)

  if (accepted.length > 0) {
    parts.push('## ACCEPTED PATTERNS (the user approved these — prefer consistency)')
    accepted.forEach(d => {
      parts.push(`- "${d.instruction}"${scopeLabel(d)} → ${d.proposedSummary}`)
    })
  }

  if (rejected.length > 0) {
    parts.push(
      '## PREVIOUSLY REJECTED (advisory — not a hard ban)\n' +
        'The user declined these proposals. Understand WHY before doing something similar; ' +
        'a rejection may be specific to that slide or moment, so do not over-generalize. If the ' +
        'current request clearly asks for it anyway, follow the request.'
    )
    rejected.forEach(d => {
      const reason = d.rejectionReason?.trim()
      parts.push(
        `- "${d.instruction}"${scopeLabel(d)} was rejected` +
          (reason ? ` — reason: ${reason}` : ' (no reason given)') +
          '.'
      )
    })
  }

  if (parts.length === 0) return ''

  return `\n=== KNOWLEDGE CONTEXT ===\n${parts.join('\n\n')}\n=== END KNOWLEDGE CONTEXT ===`
}

// ── Default knowledge layers ──────────────────────────────────────────────────

export function defaultKnowledgeLayers(): KnowledgeLayer[] {
  return [
    {
      id: 'style-default',
      type: 'style',
      name: 'FX Presentation Style',
      enabled: true,
      source: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      content: `Color palette: background #0D1B2A, panel #112236, accent #162C44
Accent colors: gold #F59E0B, teal #2DD4BF, red #F87171, blue #60A5FA, purple #A78BFA, amber #FCD34D, green #4ADE80
Text colors: white #FFFFFF, off-white #CBD5E1, dim #64748B
Font: Calibri. Slide size: 10×7.5 inches (960×720px at 96dpi).
Design rules: dark backgrounds only, use colored bars as section accents, chips for labels.`,
    },
    {
      id: 'terminology-default',
      type: 'terminology',
      name: 'FX / Finance Terms',
      enabled: true,
      source: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      content: `NOP = Net Open Position (True NOP = FCY Assets − FCY Liabilities + Derivatives net delta)
FCY = Foreign Currency
GAAP = Generally Accepted Accounting Principles
ASC 830 = GAAP remeasurement standard for FCY monetary items
ASC 815 = Hedge accounting standard (not currently used)
MTM = Mark to Market (fair value of derivatives)
B/S = Balance Sheet
CCY = Currency
VaR = Value at Risk
P&L = Profit and Loss
NOP is invisible in current NetSuite reporting — this is the core problem.
Accrual-before-pricing: invoices are accrued BEFORE FX rate is set (GAAP sees first, risk desk sees at pricing date).`,
    },
    {
      id: 'stakeholder-default',
      type: 'stakeholder',
      name: 'Executive Audience',
      enabled: true,
      source: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      content: `Audience: Senior executives and finance leadership.
Tone: Direct, authoritative, data-driven. No filler text.
Density: Low. Each slide should make one point clearly.
Preferred format: Short headlines, bullet points max 3-5 items per column, no walls of text.
Avoid: Technical jargon without definition, overly complex formulas on single slides.`,
    },
  ]
}

// ── Version diff utility ──────────────────────────────────────────────────────

export function diffSlideIds(before: SlideData[], after: SlideData[]): string[] {
  const changed: string[] = []
  const afterMap = new Map(after.map(s => [s.id, s]))
  for (const s of before) {
    const a = afterMap.get(s.id)
    if (!a || JSON.stringify(s) !== JSON.stringify(a)) changed.push(s.id)
  }
  // also catch new slides
  for (const s of after) {
    if (!before.find(b => b.id === s.id)) changed.push(s.id)
  }
  return Array.from(new Set(changed))
}
