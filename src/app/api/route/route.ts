import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import {
  isKnowledgeBasedEditRequest,
  isLayoutAuditChangeRequest,
} from '@/lib/agent/routingHeuristics'
import { agentModel } from '@/lib/agent/models'

const client = new Anthropic()

const ROUTER_MODEL = process.env.ANTHROPIC_ROUTER_MODEL || agentModel('low')

type Mode = 'ask' | 'agent'
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type Scope = 'active' | 'selected' | 'deck' | 'ask'
const MODES: Mode[] = ['ask', 'agent']
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const SCOPES: Scope[] = ['active', 'selected', 'deck', 'ask']

const ROUTER_SYSTEM = `You route messages for an AI slide-editing assistant. Read the user's LATEST message plus the supplied context, then decide how it should be handled. Respond with ONLY a JSON object — no prose, no markdown, no code fences:
{"mode":"ask"|"agent","effort":"medium"|"high"|"xhigh"|"max","scope":"active"|"selected"|"deck"|"ask"}

MODES — only two flows exist:
- "ask": the user wants an ANSWER, explanation, analysis, opinion, or plan — they do NOT want the deck changed right now. Questions about structure/content ("what should this include?") are "ask".
- "agent": EVERYTHING else — any edit, fix, redo, complaint about a bad edit, visual tweak, layout fix, content change, deck build, or "continue". NEVER return "single" — all edits use the agent loop.

CRITICAL — complaints and redo requests are ALWAYS "agent": "not fixed", "wrong", "stupid", "redo", "that's not what I asked", insults + fix request → "agent" with "high" effort.

EFFORT (never "low" — agent always reasons):
- "medium": single-slide visual/style fix, small text edit, recolor, move element.
- "high": multi-element layout, multi-slide, content generation, redesign, deck build.
- "xhigh"/"max": full deck from scratch (10+ slides).

SCOPE:
- "active": current slide only.
- "selected": multi-selected slides (selectedSlideCount > 1).
- "deck": whole presentation.
- "ask": ambiguous scope on multi-slide deck — we will ask user.`

function coerceMode(v: unknown): Mode | null {
  if (v === 'single' || v === 'agent') return 'agent'
  return typeof v === 'string' && (MODES as string[]).includes(v) ? (v as Mode) : null
}
function coerceEffort(v: unknown): Effort {
  const e =
    typeof v === 'string' && (EFFORTS as string[]).includes(v) ? (v as Effort) : 'medium'
  return e === 'low' ? 'medium' : e
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

/**
 * User wants to apply hub research / extracted claims — needs the agent loop
 * (reads slides, applies knowledge graph plan, validates). Never one-shot.
 */
function isKnowledgeBasedEdit(instruction: string): boolean {
  return isKnowledgeBasedEditRequest(instruction)
}

/** Deck-wide scope when the message names the deck/presentation explicitly. */
const DECK_WIDE =
  /\b(the\s+)?(whole\s+)?(deck|presentation|slideshow|pitch\s+deck|investor\s+deck)\b|\b(all|every)\s+slides?\b/i

function isDeckWide(instruction: string): boolean {
  return DECK_WIDE.test(instruction)
}

/**
 * Heuristic "this is a question, not a command" guard. Used only to SUPPRESS the
 * create-deck escalation (so a question that happens to mention building isn't
 * turned into an edit). It never forces editing — at worst a real command that
 * looks question-y stays on the model's chosen lane.
 */
const QUESTION_LIKE =
  /(^\s*(what|why|how|which|who|whom|whose|when|where|should|shall|can|could|would|do|does|did|is|are|am|was|were|will|won't|may|might|tell\s+me|explain|describe|recommend|suggest|advise|do\s+you|could\s+you|can\s+you)\b)|\?\s*$/i

function isQuestionLike(instruction: string): boolean {
  return QUESTION_LIKE.test(instruction.trim())
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
      system: [{ type: 'text', text: ROUTER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    })
    const { logLlmCall } = await import('@/lib/llmLog')
    logLlmCall({
      caller: 'router',
      model: ROUTER_MODEL,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      cacheReadTokens: (resp.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens,
      cacheWriteTokens: (resp.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens,
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
      if (mode !== 'ask' && effort === 'medium' && isComplexEdit(instruction)) {
        effort = 'high'
      }

      if (mode !== 'ask' && isDeckWide(instruction) && scope === 'active' && ctx.totalSlides > 1) {
        scope = 'deck'
      }

      if (isLayoutAuditChangeRequest(instruction)) {
        mode = 'agent'
        if (ctx.totalSlides > 1 && (isDeckWide(instruction) || scope === 'active')) {
          scope = 'deck'
        }
        if (effort === 'medium') effort = 'high'
      }

      // Short slide-number answer during a layout fix (e.g. "14 and 15") → agent edit.
      const slideNums = [...instruction.matchAll(/\b(?:slide\s*)?(\d{1,2})\b/gi)]
        .map(m => parseInt(m[1], 10))
        .filter(n => n >= 1 && n <= ctx.totalSlides)
      const uniqueNums = [...new Set(slideNums)]
      const remainder = instruction
        .replace(/\b(?:slide\s*)?\d{1,2}\b/gi, '')
        .replace(/\b(and|or|&,|to|-|–|only|just|slides?)\b/gi, '')
        .replace(/[^\w\s]/g, '')
        .trim()
      if (
        uniqueNums.length > 0 &&
        remainder.length < 50 &&
        !isQuestionLike(instruction) &&
        mode === 'ask'
      ) {
        mode = 'agent'
        scope = uniqueNums.length > 1 ? 'selected' : 'active'
        effort = 'medium'
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
