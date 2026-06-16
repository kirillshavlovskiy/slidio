export interface ElementStyle {
  fontSize?: number
  bold?: boolean
  italic?: boolean
  /** Numeric font weight (100–900). Takes precedence over `bold` when set. */
  fontWeight?: number
  /** Unitless line-height multiplier (e.g. 1.2). Defaults to 1.25. */
  lineHeight?: number
  color?: string
  bg?: string
  /** Optional gradient fill for the element's box (overrides `bg` visually). */
  bgGradient?: SlideGradient
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  charSpacing?: number
  fontFace?: string
  // Inner text insets in inches. Use to create breathing room between the cell
  // edge (or an accent bar sitting on the edge) and the text content.
  padLeft?: number
  padRight?: number
  padTop?: number
  padBottom?: number
  /** Element opacity, 0–100 (%). Defaults to 100. */
  opacity?: number
  /** Corner radius in px. */
  borderRadius?: number
  /** Border width in px (0/undefined = no border). */
  borderWidth?: number
  /** Border color hex (no leading #). */
  borderColor?: string
  borderStyle?: 'solid' | 'dashed' | 'dotted'
  /** Image elements only: invert the image colors (e.g. dark logo → light). */
  invert?: boolean
  /** Image elements only: how the image fills its box. Defaults to "contain". */
  objectFit?: 'contain' | 'cover' | 'fill'
  /** Icon elements only: lucide stroke width (default 2). */
  iconStrokeWidth?: number
}

// ── Charts ────────────────────────────────────────────────────────────────────
export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'combo'

/** Per-series render type — only meaningful when the chart's type is "combo". */
export type SeriesType = 'bar' | 'line' | 'area'

export interface ChartSeries {
  /** Series label (shown in legend / tooltip). */
  name: string
  /** One numeric value per category (same length / order as ChartSpec.categories). */
  values: number[]
  /** Optional hex (no #) overriding the palette color for this series. */
  color?: string
  /** Combo only: how THIS series is drawn (bar/line/area). Defaults to "bar". */
  type?: SeriesType
  /**
   * Combo only: which value axis this series is measured against.
   * "left" (primary, default) or "right" (secondary). Use "right" for a metric
   * on a different scale (e.g. a % win-rate line beside absolute P&L bars).
   */
  axis?: 'left' | 'right'
}

/** Self-contained chart definition stored on a "chart" element. */
export interface ChartSpec {
  type: ChartType
  /** X-axis labels (bar/line/area) or slice labels (pie/donut). */
  categories: string[]
  series: ChartSeries[]
  title?: string
  /** Show the legend. Defaults to true when there is more than one series. */
  showLegend?: boolean
  /** Show numeric value labels on bars/points/slices. */
  showValues?: boolean
  /** Show axes + grid lines (ignored for pie/donut). Defaults to true. */
  showGrid?: boolean
  /** Stack bar/area series instead of grouping them. */
  stacked?: boolean
  /** Palette (hex, no #) used for series that don't set their own color. */
  palette?: string[]
  /** Category (x) axis title, e.g. "Regime". */
  xAxisTitle?: string
  /** Primary value (left y) axis title — PUT UNITS HERE, e.g. "Avg P&L ($M)" or "Return (%)". */
  yAxisTitle?: string
  /** Secondary value (right y) axis title for combo charts — e.g. "Win Rate (%)". */
  y2AxisTitle?: string
}

export interface SlideElement {
  id: string
  type: 'text' | 'rect' | 'chip' | 'bar' | 'image' | 'chart' | 'icon'
  content?: string
  /** Image source (data URL or http URL) for type "image". */
  src?: string
  /** Lucide icon name (PascalCase, e.g. "TrendingUp") for type "icon". */
  icon?: string
  /** Chart definition for type "chart". */
  chart?: ChartSpec
  x: number
  y: number
  w: number
  h: number
  style: ElementStyle
}

/** Optional gradient fill for a slide background. */
export interface SlideGradient {
  /** Gradient kind. Defaults to "linear". */
  type?: 'linear' | 'radial'
  /** Linear gradient angle in degrees (CSS convention). Defaults to 135. */
  angle?: number
  /** Start color (hex, no #). */
  from: string
  /** End color (hex, no #). */
  to: string
  /** Optional middle stop (hex, no #) for a 3-color gradient. */
  via?: string
}

export interface SlideData {
  id: string
  /** Solid background color (hex, no #). Also the fallback when a gradient is set. */
  bg: string
  /** Optional gradient background; when present it renders over `bg`. */
  bgGradient?: SlideGradient
  elements: SlideElement[]
}

export type ChangeOp = 'update' | 'delete' | 'add' | 'reorder'

export interface Change {
  slideId: string
  elementId?: string
  op?: ChangeOp // default "update"; op "delete" without elementId removes the whole slide
  patch?: Partial<SlideElement> & { style?: ElementStyle }
  // For op "add" (element): the full new element to insert onto the slide.
  element?: SlideElement
  // For op "add" (slide): a brand-new slide to insert into the deck (no elementId/element).
  slide?: SlideData
  // Z-order / position. For op "add": insert position in elements[] (0 = back, omit = front/append).
  // For op "reorder": the element's new position in elements[]. For an add-slide: deck position.
  index?: number
  slidePatch?: Partial<SlideData>
}

// ── Discriminated union for Claude responses ──────────────────────────────────

export interface ClarificationOption {
  id: string       // e.g. "A", "B", "C"
  label: string    // e.g. "Make font larger (48→64pt)"
  description?: string // optional extra detail
}

/**
 * A single structured question inside a multi-question clarification. Each one
 * renders as its own block in the chat: option buttons for multiple choice plus
 * an optional free-form answer field.
 */
export interface ClarificationQuestion {
  id: string                       // stable id, e.g. "scope", "data"
  question: string                 // the question text
  options?: ClarificationOption[]  // pickable answers (omit for a pure text answer)
  allowText?: boolean              // also show a free-form answer window
  allowMultiple?: boolean          // let the user pick more than one option
}

export interface PatchResponse {
  type: 'patch'
  changes: Change[]
  summary: string
}

export interface ClarificationResponse {
  type: 'clarification'
  question: string                       // lead-in / summary, or a full free-form answer
  options?: ClarificationOption[]        // legacy single-question quick choices
  questions?: ClarificationQuestion[]    // structured multi-question form (preferred when asking for several inputs)
}

/**
 * Self-escalation: the single-shot model decides the task actually needs the
 * iterative, visual agent loop (e.g. it must SEE the rendered result, spans many
 * slides, or requires repeated verification). The client hands off to the agent.
 */
export interface NeedsAgentResponse {
  type: 'needs_agent'
  reason: string
}

export type ClaudeResponse = PatchResponse | ClarificationResponse | NeedsAgentResponse

// ── Conversation message ──────────────────────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant'
  // raw content string — for assistant messages this is the stringified ClaudeResponse
  content: string
  // optional annotated-slide screenshot (base64 PNG data URL) attached to a user message
  imageDataUrl?: string
  // optional user-uploaded reference images (base64 data URLs) attached to a user message
  imageDataUrls?: string[]
}

// ── Knowledge Memory Architecture ────────────────────────────────────────────
// Based on DeckPilot spec: 13-layer knowledge graph, smart context retrieval

export type KnowledgeLayerType =
  | 'style'         // Layer 4: color palette, fonts, design rules
  | 'terminology'   // Layer 3: key terms, abbreviations, definitions
  | 'stakeholder'   // Layer 5: audience, tone, communication prefs
  | 'workspace'     // Layer 10: recurring patterns, rejected patterns, density prefs
  | 'custom'        // Layer 2: free-form knowledge entries

export interface KnowledgeLayer {
  id: string
  type: KnowledgeLayerType
  name: string
  content: string          // free-text knowledge block sent to Claude
  enabled: boolean
  createdAt: number
  updatedAt: number
  source?: 'manual' | 'template' | 'inferred' | 'designSystem' | 'document'  // how it was created
  branchId?: string | null // knowledge branch this layer belongs to
}

// ── Knowledge Branches ────────────────────────────────────────────────────────
// A branch groups presentations that share the same knowledge layers + design
// system. A new presentation either starts a new branch or joins an existing one.
// Compact knowledge/design layer reference shown on the portfolio/hub view.
export interface KnowledgeLayerSummary {
  id: string
  name: string
  type: KnowledgeLayerType
  enabled: boolean
  source?: KnowledgeLayer['source']
}

export interface KnowledgeBranch {
  id: string
  name: string
  presentationCount: number
  /** Knowledge + design layers shared across the hub (style = design system). */
  knowledgeLayers?: KnowledgeLayerSummary[]
  createdAt: number
  updatedAt: number
}

// Lightweight presentation listing used by the start/portfolio screen.
export interface PresentationSummary {
  id: string
  name: string
  branchId: string | null
  createdAt: string
  updatedAt: string
}

// ── Decision Memory ───────────────────────────────────────────────────────────
// Layer 6: accepted decisions | Layer 7: rejection memory

export type DecisionStatus = 'accepted' | 'rejected' | 'pending'

export interface DecisionRecord {
  id: string
  timestamp: number
  slideIds: string[]          // which slides were in scope
  selectedElementIds: string[]
  instruction: string         // user's original message
  proposedSummary: string     // Claude's one-liner summary
  proposedChanges: Change[]   // the patch Claude proposed
  status: DecisionStatus
  // snapshot of affected slides BEFORE the change (for rollback)
  snapshotBefore?: SlideData[]
  // optional user-supplied reason a proposal was rejected — turns a blunt
  // "never do this again" into scoped, explainable memory
  rejectionReason?: string
}

// ── Version Control ────────────────────────────────────────────────────────────
// Layer 9: Deck Evolution Graph

export interface SlideVersion {
  id: string
  timestamp: number
  label: string | null        // null = auto, string = named milestone
  changeLog: string           // human-readable description of what changed
  slides: SlideData[]         // full deck snapshot
  decisionId: string | null   // linked DecisionRecord (if version came from AI edit)
  slideCount: number
  // which slides changed vs previous version (element IDs)
  changedSlideIds: string[]
  // ── Branching (deck timeline) ──
  // Which branch this snapshot belongs to. Reverting to an earlier message forks a
  // new branch from that point instead of discarding later history.
  branchId?: string
  branchLabel?: string        // denormalized branch name (so reload can rebuild the list)
  parentVersionId?: string | null  // immediate predecessor in the timeline tree
  // Marks the first node of a forked branch (the restored pre-message checkpoint).
  isBranchRoot?: boolean
}

// A named line of deck history. Multiple branches exist once the user reverts to a
// past message and continues editing from there.
export interface VersionBranch {
  id: string
  name: string
  createdAt: number
  forkedFromVersionId: string | null  // version this branch split off from
}
