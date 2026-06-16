import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic()

// A small, fast model decides routing — no brittle keyword/regex heuristics.
// Routing is a trivial 64-token classification, so use the cheap model (Haiku 4.5,
// 3× cheaper than Sonnet) by default. Override via env if needed.
const ROUTER_MODEL =
  process.env.ANTHROPIC_ROUTER_MODEL || process.env.ANTHROPIC_CHEAP_MODEL || 'claude-haiku-4-5'

type Mode = 'ask' | 'single' | 'agent'
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type Scope = 'active' | 'selected' | 'deck' | 'ask'
const MODES: Mode[] = ['ask', 'single', 'agent']
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const SCOPES: Scope[] = ['active', 'selected', 'deck', 'ask']

const ROUTER_SYSTEM = `You route messages for an AI slide-editing assistant. Read the user's LATEST message plus the supplied context, then decide how it should be handled. Respond with ONLY a JSON object — no prose, no markdown, no code fences:
{"mode":"ask"|"single"|"agent","effort":"low"|"medium"|"high"|"xhigh"|"max","scope":"active"|"selected"|"deck"|"ask"}

MODES
- "ask": the user is asking a QUESTION or wants analysis/explanation/summary/feedback/an opinion — they do NOT want the deck changed. Use this whenever there is no clear instruction to modify the slides.

CRITICAL — follow-ups and complaints are EDITS, not questions: A message that reacts to a PREVIOUS edit — e.g. "it's not fixed", "that didn't work", "changes weren't applied", "nothing changed", "still wrong/broken/misaligned", "you didn't do it", "do it again", "redo it", "that's not what I asked", or any frustrated complaint about the result (even if it ends with "?" or contains insults) — is an instruction to FIX/REDO the edit. Route these to "single" (small fix) or "agent" (multi-element/relayout), NEVER to "ask". Only use "ask" for genuine information-seeking questions, not for dissatisfaction with an edit.
- "single": a small, well-scoped EDIT that can be produced in ONE shot — e.g. change text/color/font/size, move/align/resize a few elements, restyle or add ONE small element on the current slide.
- "agent": anything that needs an iterative loop: reading one or more slides first, editing MULTIPLE slides, ADDING or INSERTING slides, generating SUBSTANTIAL NEW content (lists of items, several variants, parameters/structures/examples, tables), charts driven by data, full redesign / design-system conversion, "mirror this image/layout", or anything requiring visual verification. When in doubt between single and agent for a content-heavy or multi-step task, choose "agent".

CRITICAL: Judge size by how much NEW CONTENT the message asks you to PRODUCE — NOT by how many elements/slides are selected. A request that asks to "put/add/list different variants / structures / parameters / options / examples / scenarios … etc" produces a LOT of text and MUST be "agent", even if only one slide or a couple of elements are selected. Selecting a few elements does NOT make a content-generation task small.

CONTINUATION: If the message is a resume/continuation of prior work — e.g. "continue", "keep going", "carry on", "finish it", "continue where you left off / finished", "do the rest", "pick up where you stopped" — route to "agent" with at least "medium" effort. These refer to a previous multi-step task that must re-read the slide(s) and finish the outstanding work.

EFFORT (token/thinking budget) — this ALSO picks the model: "low"/"medium" run on a fast, cheap model; "high"/"xhigh"/"max" run on a more powerful model. So effort = how much model horsepower the task deserves. Follow these rules:

CREATE = powerful model (use "high", or "xhigh"/"max" for whole decks):
- Creating a NEW slide, ADDING/INSERTING slide(s), or generating a NEW presentation/deck → ALWAYS at least "high".
- Generating substantial NEW content (lists, several variants, parameters/structures/examples, tables), charts driven by data, a full redesign, or a design-system conversion → "high".
- A large, deck-wide build or redesign across many slides → "xhigh" or "max".

UPDATE existing slide:
- SIMPLE update to one existing slide — edit/replace text, change color/font/size, move/align/resize, tweak or restyle a single element → "low" (one tiny mechanical tweak) or "medium" (normal single-slide edit). These run on the cheap fast model.
- COMPLEX update — restructuring a slide's layout, reflowing/repositioning many elements, adding multiple new elements or a chart, redesigning the slide, or any update that needs careful reasoning → "high" so it runs on the powerful model.

Rule of thumb: anything that CREATES new slides/decks, or a COMPLEX slide change, deserves the powerful model ("high"+). A routine update to an existing slide stays cheap ("low"/"medium").

If the user attached an image/annotation, an edit usually needs "single" (the multi-slide loop can't see images) unless they're only asking a question ("ask").

SCOPE — which slides the edit targets (decide from the message + context, NO keyword matching):
- "active": the change applies to the CURRENT slide only — "this slide", "here", a tweak with no other target, or any single-slide edit when nothing else is indicated.
- "selected": the user refers to "these/those slides", "the selected ones", or otherwise means the slides they've already multi-selected. Use this ONLY when selected slides > 1.
- "deck": the change spans the WHOLE presentation — "all slides", "every slide", "the whole deck", a deck-wide restyle/redesign/design-system conversion, or building/continuing a multi-slide deck.
- "ask": genuinely AMBIGUOUS scope — a broad content/style change on a multi-slide deck (total slides > 1) with NO element/slide selection and no explicit target, where applying it to just the current slide vs the whole deck would differ materially. We will then ask the user which they meant.
Guidance: if mode is "ask" (a question), scope doesn't matter — return "active". If exactly one slide context and the edit is clearly local, use "active". Only return scope "ask" when totalSlides > 1 AND there's no selection AND the target is truly unclear; otherwise pick the best of active/selected/deck.`

function coerceMode(v: unknown): Mode | null {
  return typeof v === 'string' && (MODES as string[]).includes(v) ? (v as Mode) : null
}
function coerceEffort(v: unknown): Effort {
  return typeof v === 'string' && (EFFORTS as string[]).includes(v) ? (v as Effort) : 'medium'
}
function coerceScope(v: unknown): Scope {
  return typeof v === 'string' && (SCOPES as string[]).includes(v) ? (v as Scope) : 'active'
}

/**
 * Strong, specific signals that an edit needs real reasoning (the smart model)
 * even on a single slide. Used only as a FLOOR — it can raise low/medium → high,
 * never the reverse — so it can't make trivial edits expensive. Deliberately
 * narrow: layout restructuring, overlap repair, redesigns, multi-element/grid
 * reorganization, and adding data visuals (chart/table/diagram).
 */
const COMPLEX_EDIT =
  /\b(redesign|re-?design|restructure|re-?structure|reflow|re-?flow|rebalance|re-?balance|rearrange|re-?arrange|re-?layout|relayout|overhaul|rework|revamp|reorganin?[sz]e|re-?organi[sz]e)\b|\b(two|three|multi)-?column\b|\bgrid\b|\b(fix|resolve|remove|eliminate|clean up)\b[^.]*\boverlap|nothing\s+overlaps?|\b(add|insert|create|build|generate|put|include)\b[^.]*\b(chart|graph|table|diagram|timeline|infographic|matrix)\b|\b(condense|consolidate|merge)\b[^.]*\b(into|to)\b|\bmake (it|this|the slide|this slide|everything) (look )?(more )?(professional|polished|clean(er)?|modern|premium|consistent|aligned)\b/i

function isComplexEdit(instruction: string): boolean {
  return COMPLEX_EDIT.test(instruction)
}

/**
 * CREATE/BUILD intent: the user wants slides/a deck generated or populated. This
 * ALWAYS belongs to the iterative agent (which reads context, builds incrementally
 * across slides, renders and verifies) — never the one-shot editor, which would
 * try to emit a whole deck blind or pester the user with scope questions. Used as
 * a hard floor so the cheap router can't mislabel a build as a small "single" edit.
 */
const CREATE_DECK_INTENT =
  /\b(build|create|generate|produce|draft|assemble|compose|populate|flesh\s+out|write\s+up|put\s+together|lay\s+out|fill\s+(?:in|out))\b[^.?!]*\b(deck|decks|presentation|presentations|slide|slides|slideshow|slide\s*deck|pitch\s+deck|investor\s+deck|sections?|outline|the\s+rest)\b/i

function isCreateDeckIntent(instruction: string): boolean {
  return CREATE_DECK_INTENT.test(instruction)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const instruction: string = typeof body.instruction === 'string' ? body.instruction : ''
  const ctx = {
    selectedElementCount: Number(body.selectedElementCount) || 0,
    selectedSlideCount: Number(body.selectedSlideCount) || 0,
    totalSlides: Number(body.totalSlides) || 0,
    hasImages: !!body.hasImages,
  }

  if (!instruction.trim()) {
    return NextResponse.json({ mode: 'ask', effort: 'low', scope: 'active' })
  }

  const userMsg = `CONTEXT
- selected elements: ${ctx.selectedElementCount}
- selected slides: ${ctx.selectedSlideCount}
- total slides in deck: ${ctx.totalSlides}
- user attached image/annotation: ${ctx.hasImages ? 'yes' : 'no'}

USER MESSAGE
"""
${instruction.slice(0, 2000)}
"""

Return the routing JSON now.`

  try {
    const resp = await client.messages.create({
      model: ROUTER_MODEL,
      max_tokens: 64,
      system: ROUTER_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    })
    const textBlock = resp.content.find(b => b.type === 'text')
    const raw = textBlock?.type === 'text' ? textBlock.text : ''
    const match = raw.match(/\{[\s\S]*\}/)
    const parsed = match ? JSON.parse(match[0]) : null
    let mode = coerceMode(parsed?.mode)
    if (mode) {
      // Scope is irrelevant for questions; never let it be "ask" when there's a selection.
      let scope = coerceScope(parsed?.scope)
      if (mode === 'ask') scope = 'active'
      if (scope === 'ask' && (ctx.selectedSlideCount > 1 || ctx.totalSlides <= 1)) {
        scope = ctx.selectedSlideCount > 1 ? 'selected' : 'active'
      }

      let effort = coerceEffort(parsed?.effort)
      // Deterministic complexity floor: the cheap Haiku router sometimes labels a
      // genuinely complex SINGLE-SLIDE edit (layout rebalance, overlap fixing,
      // redesign, multi-element/grid restructure, adding a chart/table) as
      // low/medium → which would run it on Haiku. Such work needs the smart model,
      // so when these signals are present we raise the floor to "high" (→ Sonnet)
      // regardless of slide count. Questions are never bumped.
      if (mode !== 'ask' && (effort === 'low' || effort === 'medium') && isComplexEdit(instruction)) {
        effort = 'high'
      }

      // Hard floor: a build/populate-a-deck request must run on the AGENT (never the
      // one-shot editor). The cheap router occasionally labels "create slides …" as
      // "single"; force it to the agent at high effort so big builds aren't one-shot.
      if (mode === 'single' && isCreateDeckIntent(instruction)) {
        mode = 'agent'
        if (effort === 'low' || effort === 'medium') effort = 'high'
      }

      return NextResponse.json({ mode, effort, scope })
    }
  } catch (err) {
    console.error('[router] model call failed:', err instanceof Error ? err.message : err)
  }

  // Safe fallback when the router model is unavailable: the agent can handle
  // anything, so default to it rather than risk a too-small single-shot.
  return NextResponse.json({ mode: 'agent', effort: 'medium', scope: 'active' })
}
