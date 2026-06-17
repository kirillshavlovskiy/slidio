'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { toPng } from 'html-to-image'
import { Brain, History, Undo2, Download, FileDown, LogOut, Palette, Image as ImageIcon, Home as HomeIcon, BarChart3, Sparkles, Type, Square, Table, Upload, PanelLeftOpen, PanelRightOpen, Pin, Loader2 } from 'lucide-react'
import { IMPORT_ACCEPT } from '@/lib/importDeck'
import SlidePanel from '@/components/SlidePanel'
import ElementInspector from '@/components/ElementInspector'
import SlideCanvas from '@/components/SlideCanvas'
import ResizeHandle from '@/components/ResizeHandle'
import CanvasFloatingToolbar, { AlignMode } from '@/components/CanvasFloatingToolbar'
import CanvasZoomControls from '@/components/CanvasZoomControls'
import AnnotationLayer, { Stroke } from '@/components/AnnotationLayer'
import { useFitScale } from '@/hooks/useFitScale'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '@/lib/slideDimensions'
import ChatPanel, { DisplayMessage } from '@/components/ChatPanel'
import {
  conversationToDisplay,
  DEFAULT_WELCOME,
  normalizeConversationHistory,
} from '@/lib/conversation'
import { savePresentation, saveVersion, persistDecision, setDecisionStatus } from '@/lib/persistence'
import ProposalPreviewModal from '@/components/ProposalPreviewModal'
import IconPicker from '@/components/IconPicker'
import { QUICK_ACTIONS, QuickAction, QuickActionContext } from '@/lib/quickActions'
import TemplateUploader, { TemplateKnowledge } from '@/components/TemplateUploader'
import {
  mergeTemplateList,
  mergeTemplatesKnowledge,
  syncTemplateKnowledgeLayers,
} from '@/lib/templateKnowledge'
import KnowledgePanel from '@/components/KnowledgePanel'
import DesignSystemPanel from '@/components/DesignSystemPanel'
import { DesignTokensProvider } from '@/components/DesignTokensProvider'
import {
  DesignSystem,
  DSFile,
  syncDesignSystemLayers,
  designTokensView,
  storeDesignSystem,
  loadStoredDesignSystem,
  buildFontFaceCss,
} from '@/lib/designSystem'
import {
  type MediaAsset,
  resolveAssetRefs,
  collectAssets,
  mediaManifest,
  buildMediaContext,
  storeMediaLibrary,
  loadMediaLibrary,
  makeAssetId,
  assetNameFromFile,
  unresolvedRefs,
  resolveSrc,
} from '@/lib/mediaLibrary'
import VersionPanel from '@/components/VersionPanel'
import LoginScreen from '@/components/LoginScreen'
import StartScreen from '@/components/StartScreen'
import initialSlides from '@/lib/slides.json'
import {
  SlideData,
  SlideGradient,
  SlideElement,
  Change,
  ClaudeResponse,
  ClarificationOption,
  ClarificationQuestion,
  ConversationMessage,
  KnowledgeLayer,
  KnowledgeBranch,
  PresentationSummary,
  DecisionRecord,
  SlideVersion,
  VersionBranch,
  ElementStyle,
  ChartSpec,
  HubRole,
} from '@/lib/types'
import { buildKnowledgeContext, activeSlideText, defaultKnowledgeLayers, diffSlideIds } from '@/lib/knowledge'
import { summarizeDeckChanges } from '@/lib/versionDiff'
import {
  applyChangesToSlides,
  getDeletedSlideIds,
} from '@/lib/preview'
import {
  changesAddSlides,
  compressAgentIntro,
  effectiveSlideLimit,
  formatPresentationScopeNote,
  formatScopeGateNote,
  isNewDeckBuildRequest,
  parsePresentationScope,
  projectDeckSlideCount,
} from '@/lib/presentationScope'
import { analyzeChanges, formatChangeReport } from '@/lib/changeDiagnostics'
import { installGlobalErrorReporting, reportClientError } from '@/lib/clientLog'
import { formatLayoutIssues, reviewLayoutChange, SLIDE_W_IN, SLIDE_H_IN } from '@/lib/layout'
import { slidesForScope, ScopeMode, RouterScope } from '@/lib/scope'
import { computeSlideSelection } from '@/lib/slideSelection'
import { duplicateSlides, mergeSlides, splitSlide, SlideOpResult } from '@/lib/slideOps'
import { downloadPdfFromImages } from '@/lib/pdfExport'
import { rasterizeIconsInSlides } from '@/lib/iconRaster'

const LEFT_PANEL_MIN = 160
const LEFT_PANEL_MAX = 420
const LEFT_PANEL_DEFAULT = 224
const RIGHT_PANEL_MIN = 260
const RIGHT_PANEL_MAX = 520
const RIGHT_PANEL_DEFAULT = 320
const CANVAS_ZOOM_MIN = 0.25
const CANVAS_ZOOM_MAX = 3
const CANVAS_ZOOM_STEP = 0.1
const HISTORY_LIMIT = 100

// Off-screen agent screenshot scale. SlideCanvas `scale` is a MULTIPLIER on the
// 960×720 base (NOT px-per-inch), so 0.75 → 720×540 px. Anthropic rejects images
// whose longest side exceeds 8000px or whose payload exceeds 10MB, so this MUST
// stay well under those limits (a previous value of 72 produced a 69,120px image
// that 400'd every turn after a render).
const AGENT_RENDER_SCALE = 0.75
/** Full-size capture for PDF export (matches the on-screen slide at 96 px/in). */
const PDF_EXPORT_SCALE = 1
// Enough headroom for multi-slide edits (read all → apply once → a couple of
// verify renders), while the prompt keeps the agent batching to stay efficient.
// Larger builds (e.g. many rows added incrementally) need room to finish in one run.
const AGENT_MAX_STEPS = 20

// Minimal Anthropic message/tool-use shapes used by the client agent loop.
type AgentToolUse = {
  type: 'tool_use'
  id: string
  name: string
  input: {
    slideId?: string
    slideIds?: string[]
    changes?: Change[]
    summary?: string
    intro?: string
    questions?: ClarificationQuestion[]
  }
}
type AgentThinkingBlock =
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
type AgentBlock = { type: 'text'; text?: string } | AgentToolUse | AgentThinkingBlock
type AgentImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}
type AgentToolResult = {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<AgentImageBlock | { type: 'text'; text: string }>
  is_error?: boolean
}
type AgentMessage =
  | { role: 'assistant'; content: AgentBlock[] }
  | { role: 'user'; content: string | AgentToolResult[] }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// ── AI request router ─────────────────────────────────────────────────────────
// The chat UI offers Auto / Single-shot / Agent. In Auto, a small/fast MODEL (not
// keyword heuristics) decides each request's (a) FLOW — one-shot patch vs the
// iterative look→edit→verify agent — and (b) EFFORT level (Anthropic's token-spend
// dial). The single-shot model can still self-escalate to the agent
// (type:"needs_agent") when it realizes it must SEE the result.
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type UiMode = 'auto' | 'single' | 'agent'

// Ask the router model how to handle this request. Falls back to the agent (which
// can handle anything) only if the routing call itself fails.
async function classifyRequest(
  instruction: string,
  ctx: {
    selectedElementCount: number
    selectedSlideCount: number
    totalSlides: number
    hasImages: boolean
  }
): Promise<{ mode: 'single' | 'agent' | 'ask'; effort: Effort; scope: RouterScope }> {
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction, ...ctx }),
    })
    if (res.ok) {
      const data = (await res.json()) as { mode?: string; effort?: string; scope?: string }
      const mode =
        data.mode === 'ask' || data.mode === 'single' || data.mode === 'agent' ? data.mode : null
      const effort = (['low', 'medium', 'high', 'xhigh', 'max'] as Effort[]).includes(
        data.effort as Effort
      )
        ? (data.effort as Effort)
        : 'medium'
      const scope = (['active', 'selected', 'deck', 'ask'] as RouterScope[]).includes(
        data.scope as RouterScope
      )
        ? (data.scope as RouterScope)
        : 'active'
      if (mode) return { mode, effort, scope }
    }
  } catch (err) {
    console.error('[router] request failed, defaulting to agent:', err)
  }
  return { mode: 'agent', effort: 'medium', scope: 'active' }
}

/** Bump effort one level (used when single-shot self-escalates to the agent). */
function bumpEffort(e: Effort): Effort {
  const order: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
  return order[Math.min(order.length - 1, order.indexOf(e) + 1)]
}

/** A background deck import (PPTX/PDF) shown as a pending card in the portfolio. */
type ImportJob = { id: string; name: string; status: 'loading' | 'error'; error?: string }

export default function Home() {
  const { data: session, status } = useSession()

  // ── Slide state ─────────────────────────────────────────────────────────────
  const [slides, setSlides] = useState<SlideData[]>(initialSlides.slides as SlideData[])
  const [activeSlideId, setActiveSlideId] = useState<string>(initialSlides.slides[0].id)
  const [selectedSlideIds, setSelectedSlideIds] = useState<string[]>([
    initialSlides.slides[0].id,
  ])
  const [selectionAnchorId, setSelectionAnchorId] = useState<string>(
    initialSlides.slides[0].id
  )
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([])
  // In-app clipboard for copying elements between slides (Ctrl/Cmd+C / +V / +X).
  const [clipboardElements, setClipboardElements] = useState<SlideElement[]>([])
  const [leftTab, setLeftTab] = useState<'slides' | 'design'>('slides')
  const [editingElementId, setEditingElementId] = useState<string | null>(null)
  // Icon picker target: 'insert' = add a new icon element; an element id = change
  // that element's icon; null = closed.
  const [iconPickerFor, setIconPickerFor] = useState<string | 'insert' | null>(null)
  const [slideHistory, setSlideHistory] = useState<SlideData[][]>([])
  // Always-current deck snapshot source for history, plus a per-action lock so a
  // single user action (e.g. a multi-element batch) becomes ONE undo step.
  const slidesRef = useRef<SlideData[]>([])
  const historyLockRef = useRef(false)
  // Lets callApi hand off to runAgent (defined later) without a forward-ref cycle.
  const runAgentRef = useRef<
    | ((
        instruction: string,
        opts?: { effort?: Effort; skipUserEcho?: boolean; checkpoint?: SlideData[]; historyLength?: number }
      ) => void)
    | null
  >(null)
  // Groups a burst of keyboard nudges into a single undo step.
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Pending patch (awaiting user Apply/Discard) ──────────────────────────────
  const [pendingChanges, setPendingChanges] = useState<Change[] | null>(null)
  const [pendingSummary, setPendingSummary] = useState<string>('')
  // Retained only to reset highlight intent on new proposals; the live highlight
  // toggle now lives inside the preview overlay (ProposalPreviewModal).
  const [, setHighlightDiffOnCanvas] = useState(false)
  // Full-screen proposal preview overlay (opened from the chat proposal widget).
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // ── Conversation state ───────────────────────────────────────────────────────
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([])
  const [display, setDisplay] = useState<DisplayMessage[]>([DEFAULT_WELCOME])
  const [chatDraft, setChatDraft] = useState<{ text: string; nonce: number }>({ text: '', nonce: 0 })
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isRefining, setIsRefining] = useState(false)
  // Agentic tool-loop editor (inspect → edit → render → verify, like Claude in PPT).
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const [captureSlide, setCaptureSlide] = useState<SlideData | null>(null)
  const [captureScale, setCaptureScale] = useState(AGENT_RENDER_SCALE)
  const agentCaptureRef = useRef<HTMLDivElement>(null)
  // Cancellation: a flag the agent loop checks each step, plus the in-flight
  // request's AbortController so a Stop also kills the current network call.
  const agentStopRef = useRef(false)
  const agentAbortRef = useRef<AbortController | null>(null)
  // In-flight single-shot (/api/edit) request, so the composer Stop button can
  // abort a one-shot generation the same way it stops an agent run.
  const singleShotAbortRef = useRef<AbortController | null>(null)
  // Last refine response shown inline in the preview panel (e.g. an AI question).
  const [refineNote, setRefineNote] = useState<string | null>(null)

  // ── Template knowledge ───────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<TemplateKnowledge[]>([])
  const [lastScopeMode, setLastScopeMode] = useState<ScopeMode>('active')

  // ── Knowledge Memory Architecture ────────────────────────────────────────────
  const [knowledgeLayers, setKnowledgeLayers] = useState<KnowledgeLayer[]>(defaultKnowledgeLayers())
  const [showKnowledge, setShowKnowledge] = useState(false)

  // ── Design System (uploaded token/style package the AI follows) ──────────────
  const [dsId] = useState(() => `${Date.now()}`)
  const [dsName, setDsName] = useState('')
  const [dsFiles, setDsFiles] = useState<DSFile[]>([])
  const [showDesignSystem, setShowDesignSystem] = useState(false)
  const [showImageMenu, setShowImageMenu] = useState(false)
  const [designSystem, setDesignSystem] = useState<DesignSystem | null>(null)
  const designSystemRef = useRef<DesignSystem | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importingDeck, setImportingDeck] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const exportingPdfRef = useRef(false)
  // Background deck imports (PPTX/PDF). They run async at the app root so the
  // user can navigate away and return to find the finished deck in the portfolio.
  const [importJobs, setImportJobs] = useState<ImportJob[]>([])
  // Media library: user-uploaded images kept so the AI can reference them by name.
  const [mediaLibrary, setMediaLibrary] = useState<MediaAsset[]>([])
  const designTokens = useMemo(() => designTokensView(designSystem), [designSystem])
  const fontFaceCss = useMemo(() => buildFontFaceCss(designSystem), [designSystem])
  const fontFaceCssRef = useRef('')
  useEffect(() => {
    fontFaceCssRef.current = fontFaceCss
  }, [fontFaceCss])

  // Restore the uploaded design system on load so the panel, token preview and the
  // on-canvas design tools repopulate without re-uploading. (The AI knowledge layer
  // is already restored separately from the knowledge store.)
  // The media library is portfolio-wide; the design system is loaded per branch
  // when a presentation is opened (see openPresentation).
  useEffect(() => {
    let cancelled = false
    loadMediaLibrary().then(lib => {
      if (!cancelled && lib.length) setMediaLibrary(lib)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Version Control ────────────────────────────────────────────────────────────
  const [versions, setVersions] = useState<SlideVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  // Deck-timeline branching: which branch new snapshots land on, plus branch names.
  // The "main" branch always exists; reverting to a past message forks a new one.
  const MAIN_BRANCH_ID = 'main'
  const [currentBranchId, setCurrentBranchId] = useState<string>(MAIN_BRANCH_ID)
  const [branchNames, setBranchNames] = useState<Record<string, string>>({ [MAIN_BRANCH_ID]: 'Main' })
  // The version the deck currently reflects. Usually the branch head, but RESTORING
  // an older version moves this pointer back WITHOUT creating a new snapshot — so the
  // panel can show "viewing v1 while latest is still v2".
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null)
  const currentBranchIdRef = useRef<string>(MAIN_BRANCH_ID)
  useEffect(() => { currentBranchIdRef.current = currentBranchId }, [currentBranchId])
  const branchNamesRef = useRef<Record<string, string>>(branchNames)
  useEffect(() => { branchNamesRef.current = branchNames }, [branchNames])
  const versionsRef = useRef<SlideVersion[]>([])
  useEffect(() => { versionsRef.current = versions }, [versions])
  const currentVersionIdRef = useRef<string | null>(null)
  useEffect(() => { currentVersionIdRef.current = currentVersionId }, [currentVersionId])

  // Branch metadata to stamp onto a newly-created version: which branch it's on,
  // the branch's display name, and its predecessor. The predecessor is the version
  // the deck currently reflects (so an edit made after RESTORING v1 is recorded as
  // built on v1, not on the latest) — falling back to the branch head.
  const makeBranchMeta = useCallback(() => {
    const branchId = currentBranchIdRef.current
    const onBranch = versionsRef.current.filter(v => (v.branchId ?? MAIN_BRANCH_ID) === branchId)
    const head = onBranch.length ? onBranch[onBranch.length - 1].id : null
    return {
      branchId,
      branchLabel: branchNamesRef.current[branchId] ?? 'Main',
      parentVersionId: currentVersionIdRef.current ?? head,
    }
  }, [])

  // ── Manual-edit version capture ───────────────────────────────────────────────
  // AI flows snapshot the deck into the version timeline; direct manual edits
  // (drag, type, recolor, etc.) did not. These refs let a debounced effect commit
  // manual edits as a single, continuously-updated "Manual edits" snapshot that
  // coalesces a burst of tweaks until the next boundary (AI edit / restore /
  // branch / open) closes the session and starts a fresh one.
  const lastCommittedSlidesRef = useRef<string>('') // JSON of the deck the timeline head reflects
  const manualVersionIdRef = useRef<string | null>(null) // open manual snapshot to update in place
  const manualBaselineRef = useRef<SlideData[] | null>(null) // parent deck, for diffing the manual snapshot

  // Mark `committed` as the deck the version timeline already reflects and close
  // any open manual session. Called at every version boundary so the manual-commit
  // effect doesn't re-capture AI/restore/branch changes as "manual edits".
  const closeManualSession = useCallback((committed: SlideData[]) => {
    lastCommittedSlidesRef.current = JSON.stringify(committed)
    manualVersionIdRef.current = null
    manualBaselineRef.current = null
  }, [])

  // ── Decision Memory ────────────────────────────────────────────────────────────
  const [decisions, setDecisions] = useState<DecisionRecord[]>([])
  const [pendingDecisionId, setPendingDecisionId] = useState<string | null>(null)

  // ── Annotation / drawing state ───────────────────────────────────────────────
  const [annotationMode, setAnnotationMode] = useState(false)
  const [annotationColor, setAnnotationColor] = useState('#FB3B5C')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  // Holds a broad instruction whose scope (this slide vs whole deck) we asked the
  // user to disambiguate; cleared when they pick or send something else.
  const [pendingScopeInstruction, setPendingScopeInstruction] = useState<string | null>(null)
  // Holds the original instruction for an agent run that paused on ask_user; when
  // the user answers the structured questions we resume the agent with their answers.
  const [pendingAgentInstruction, setPendingAgentInstruction] = useState<string | null>(null)
  const canvasCaptureRef = useRef<HTMLDivElement>(null)
  const canvasOverlayRef = useRef<HTMLDivElement>(null)
  const canvasViewportRef = useRef<HTMLDivElement>(null)
  const [canvasZoom, setCanvasZoom] = useState(1)

  // ── DB persistence state ─────────────────────────────────────────────────────
  const [presentationId, setPresentationId] = useState<string | null>(null)
  const [currentRole, setCurrentRole] = useState<HubRole | null>(null)
  const canEdit = currentRole !== 'viewer'
  const dbInitialized = useRef(false)

  // ── Portfolio / knowledge branches ───────────────────────────────────────────
  const [branches, setBranches] = useState<KnowledgeBranch[]>([])
  const [presentationSummaries, setPresentationSummaries] = useState<PresentationSummary[]>([])
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)
  const activeBranchIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeBranchIdRef.current = activeBranchId
  }, [activeBranchId])
  const [showStartScreen, setShowStartScreen] = useState(true)
  const [portfolioLoading, setPortfolioLoading] = useState(true)

  // ── Resizable side panels ────────────────────────────────────────────────────
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT)
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT)
  // Collapsed = pinned shut (panel removed from layout). Peek = transient hover
  // preview that floats the collapsed panel over the canvas without reflowing.
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [leftPeek, setLeftPeek] = useState(false)
  const [rightPeek, setRightPeek] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('deckpanel-widths')
      if (!raw) return
      const { left, right, leftCollapsed: lc, rightCollapsed: rc } = JSON.parse(raw) as {
        left?: number
        right?: number
        leftCollapsed?: boolean
        rightCollapsed?: boolean
      }
      if (typeof left === 'number') setLeftPanelWidth(clamp(left, LEFT_PANEL_MIN, LEFT_PANEL_MAX))
      if (typeof right === 'number') setRightPanelWidth(clamp(right, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX))
      if (typeof lc === 'boolean') setLeftCollapsed(lc)
      if (typeof rc === 'boolean') setRightCollapsed(rc)
    } catch {
      // ignore invalid saved widths
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(
      'deckpanel-widths',
      JSON.stringify({
        left: leftPanelWidth,
        right: rightPanelWidth,
        leftCollapsed,
        rightCollapsed,
      })
    )
  }, [leftPanelWidth, rightPanelWidth, leftCollapsed, rightCollapsed])

  const resizeLeftPanel = useCallback((delta: number) => {
    setLeftPanelWidth(w => clamp(w + delta, LEFT_PANEL_MIN, LEFT_PANEL_MAX))
  }, [])

  const resizeRightPanel = useCallback((delta: number) => {
    setRightPanelWidth(w => clamp(w + delta, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX))
  }, [])

  const updateElement = useCallback(
    (
      elementId: string,
      patch: {
        content?: string
        style?: Partial<ElementStyle>
        chart?: ChartSpec
        icon?: string
        x?: number
        y?: number
        w?: number
        h?: number
      }
    ) => {
      setSlides(prev =>
        prev.map(slide => {
          if (slide.id !== activeSlideId) return slide
          return {
            ...slide,
            elements: slide.elements.map(el => {
              if (el.id !== elementId) return el
              return {
                ...el,
                ...(patch.content !== undefined ? { content: patch.content } : {}),
                ...(patch.chart !== undefined ? { chart: patch.chart } : {}),
                ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
                ...(patch.x !== undefined ? { x: patch.x } : {}),
                ...(patch.y !== undefined ? { y: patch.y } : {}),
                ...(patch.w !== undefined ? { w: patch.w } : {}),
                ...(patch.h !== undefined ? { h: patch.h } : {}),
                style: { ...el.style, ...(patch.style || {}) },
              }
            }),
          }
        })
      )
    },
    [activeSlideId]
  )

  // Keep a ref to the latest slides so pushHistory can snapshot without deps.
  useEffect(() => {
    slidesRef.current = slides
  }, [slides])

  // Keep a ref to the latest media library so resolution avoids stale closures,
  // and persist it whenever it changes.
  const mediaLibraryRef = useRef<MediaAsset[]>([])
  useEffect(() => {
    mediaLibraryRef.current = mediaLibrary
    storeMediaLibrary(mediaLibrary)
  }, [mediaLibrary])

  // Gather every referenceable image: design-system logos + uploaded media +
  // images already on slides. Used both to resolve AI refs and to tell the AI
  // what's available.
  const collectAllAssets = useCallback(
    (): MediaAsset[] =>
      collectAssets(
        designSystemRef.current?.tokens.logos ?? [],
        mediaLibraryRef.current,
        slidesRef.current
      ),
    []
  )

  // Repair pass: image elements may have been saved with an unresolved name
  // reference (e.g. "logo:Deel") — for instance when the logo was applied before
  // the logo files were uploaded. Whenever the asset library is available, swap
  // any such reference for the real image so it renders without re-running the AI.
  useEffect(() => {
    const assets = collectAllAssets()
    if (assets.length === 0) return
    let changed = false
    const next = slides.map(s => ({
      ...s,
      elements: s.elements.map(el => {
        if (el.type === 'image' && el.src) {
          const resolved = resolveSrc(el.src, assets)
          if (resolved && resolved !== el.src) {
            changed = true
            return { ...el, src: resolved }
          }
        }
        return el
      }),
    }))
    if (changed) {
      setSlides(next)
      // Auto-resolving image refs isn't a user edit — keep the manual-edit
      // baseline aligned so it isn't committed as a "Manual edits" version.
      if (!manualVersionIdRef.current) lastCommittedSlidesRef.current = JSON.stringify(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, mediaLibrary, designSystem, collectAllAssets])

  // Record the current deck as one undo step. Coalesces all calls that happen
  // within the same action (synchronous batch / same microtask) into a single
  // entry, so e.g. styling 5 selected elements with one click = one undo.
  const pushHistory = useCallback(() => {
    if (historyLockRef.current) return
    historyLockRef.current = true
    setSlideHistory(h => {
      const next = [...h, JSON.parse(JSON.stringify(slidesRef.current)) as SlideData[]]
      return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
    })
    Promise.resolve().then(() => {
      historyLockRef.current = false
    })
  }, [])

  // Element edit that records one undo step (used by toolbar + inline text editor).
  const updateElementWithHistory = useCallback(
    (
      elementId: string,
      patch: { content?: string; style?: Partial<ElementStyle>; chart?: ChartSpec; icon?: string; x?: number; y?: number; w?: number; h?: number }
    ) => {
      pushHistory()
      updateElement(elementId, patch)
    },
    [pushHistory, updateElement]
  )

  useEffect(() => {
    setEditingElementId(null)
  }, [activeSlideId])

  // Surface the design inspector when a single element is selected; fall back to
  // the slide list when the selection is cleared.
  useEffect(() => {
    if (selectedElementIds.length === 1) setLeftTab('design')
    else if (selectedElementIds.length === 0) setLeftTab('slides')
  }, [selectedElementIds])

  // Auto-save presentation state (slides, chat, active slide) after edits
  useEffect(() => {
    if (!presentationId || !initialLoadDone) return
    const timer = setTimeout(() => {
      savePresentation(presentationId, {
        slides,
        conversationHistory,
        activeSlideId,
      }).catch(err => console.error('Failed to save presentation', err))
    }, 400)
    return () => clearTimeout(timer)
  }, [slides, conversationHistory, activeSlideId, presentationId, initialLoadDone])

  // Commit manual edits into the version timeline. Debounced + coalesced: a burst
  // of direct edits becomes one "Manual edits" snapshot that keeps updating until
  // a boundary (AI edit / restore / branch) closes the session.
  useEffect(() => {
    if (!presentationId || !initialLoadDone) return
    if (JSON.stringify(slides) === lastCommittedSlidesRef.current) return
    const timer = setTimeout(() => {
      const cur = slidesRef.current
      const curJson = JSON.stringify(cur)
      if (curJson === lastCommittedSlidesRef.current) return

      // Opening a new manual session: the parent baseline is the deck the timeline
      // head currently reflects.
      if (!manualVersionIdRef.current) {
        manualBaselineRef.current = lastCommittedSlidesRef.current
          ? (JSON.parse(lastCommittedSlidesRef.current) as SlideData[])
          : cur
      }
      const base = manualBaselineRef.current ?? cur
      const changedSlideIds = diffSlideIds(base, cur)
      const diff = summarizeDeckChanges(base, cur)
      const snapshot = JSON.parse(curJson) as SlideData[]

      if (manualVersionIdRef.current) {
        // Update the open manual snapshot in place (same id → DB upsert).
        const id = manualVersionIdRef.current
        const existing = versionsRef.current.find(v => v.id === id)
        if (existing) {
          const updated: SlideVersion = {
            ...existing,
            timestamp: Date.now(),
            changeLog: `Manual edits · ${diff.text}`,
            slides: snapshot,
            slideCount: cur.length,
            changedSlideIds,
          }
          setVersions(prev => prev.map(v => (v.id === id ? updated : v)))
          saveVersion(presentationId, updated).catch(e =>
            console.warn('[persist] manual version update failed', e)
          )
        }
      } else {
        const version: SlideVersion = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          label: null,
          changeLog: `Manual edits · ${diff.text}`,
          slides: snapshot,
          decisionId: null,
          slideCount: cur.length,
          changedSlideIds,
          ...makeBranchMeta(),
        }
        manualVersionIdRef.current = version.id
        setVersions(prev => [...prev, version])
        setCurrentVersionId(version.id)
        saveVersion(presentationId, version).catch(e =>
          console.warn('[persist] manual version save failed', e)
        )
      }
      lastCommittedSlidesRef.current = curJson
    }, 1500)
    return () => clearTimeout(timer)
  }, [slides, presentationId, initialLoadDone, makeBranchMeta])

  // ── Portfolio: load branches + presentation list for the start screen ─────────
  const loadPortfolio = useCallback(async () => {
    setPortfolioLoading(true)
    try {
      const [bRes, pRes] = await Promise.all([
        fetch('/api/branches'),
        fetch('/api/presentations'),
      ])
      if (bRes.ok) setBranches(await bRes.json())
      if (pRes.ok) setPresentationSummaries(await pRes.json())
    } catch (err) {
      console.error('Failed to load portfolio', err)
    } finally {
      setPortfolioLoading(false)
    }
  }, [])

  // Seed a fresh branch with the default knowledge layers (returns DB-backed layers).
  const seedBranchKnowledge = useCallback(async (branchId: string): Promise<KnowledgeLayer[]> => {
    const defaults = defaultKnowledgeLayers()
    for (const layer of defaults) {
      try {
        const res = await fetch('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...layer, branchId }),
        })
        if (res.ok) layer.id = (await res.json()).id
      } catch {
        /* best effort */
      }
    }
    return defaults
  }, [])

  // Open a presentation: load its deck + the knowledge/design-system of its branch.
  const openPresentation = useCallback(
    async (id: string) => {
      try {
        const detailRes = await fetch(`/api/presentations/${id}`)
        if (!detailRes.ok) return
        const detail = await detailRes.json()
        const loadedSlides = detail.slides as SlideData[]
        if (!loadedSlides?.length) return

        const restoredActiveId =
          detail.activeSlideId &&
          loadedSlides.some((s: SlideData) => s.id === detail.activeSlideId)
            ? detail.activeSlideId
            : loadedSlides[0].id

        // Reset transient editor state from any previous deck.
        setPendingChanges(null)
        setPendingSummary('')
        setSelectedElementIds([])
        setEditingElementId(null)
        setStrokes([])
        setSlideHistory([])
        setVersions([])
        setDecisions([])
        // Reset branch state; the version-load below rebuilds it from snapshots.
        setBranchNames({ [MAIN_BRANCH_ID]: 'Main' })
        setCurrentBranchId(MAIN_BRANCH_ID)
        setCurrentVersionId(null)

        setSlides(loadedSlides)
        setActiveSlideId(restoredActiveId)
        setSelectedSlideIds([restoredActiveId])
        setSelectionAnchorId(restoredActiveId)
        setPresentationId(id)
        setCurrentRole((detail.myRole as HubRole) ?? null)
        setActiveBranchId(detail.branchId ?? null)

        const history = normalizeConversationHistory(detail.conversationHistory)
        setConversationHistory(history)
        setDisplay(history.length > 0 ? conversationToDisplay(history) : [DEFAULT_WELCOME])

        if (detail.versions?.length > 0) {
          const loadedVersions: SlideVersion[] = detail.versions.map(
            (v: SlideVersion & { createdAt?: string | number }) => ({
              id: v.id,
              timestamp: v.timestamp ?? new Date(v.createdAt ?? Date.now()).getTime(),
              label: v.label,
              changeLog: v.changeLog,
              slides: v.slides,
              decisionId: v.decisionId,
              slideCount: v.slideCount,
              changedSlideIds: v.changedSlideIds,
              branchId: v.branchId ?? MAIN_BRANCH_ID,
              branchLabel: v.branchLabel ?? undefined,
              parentVersionId: v.parentVersionId ?? null,
              isBranchRoot: v.isBranchRoot ?? false,
            })
          )
          setVersions(loadedVersions)
          // Rebuild branch names from the loaded snapshots, and make the active
          // branch the one carrying the most recent snapshot.
          const names: Record<string, string> = { [MAIN_BRANCH_ID]: 'Main' }
          for (const v of loadedVersions) {
            const bid = v.branchId ?? MAIN_BRANCH_ID
            if (v.branchLabel) names[bid] = v.branchLabel
          }
          setBranchNames(names)
          const latest = loadedVersions[loadedVersions.length - 1]
          setCurrentBranchId(latest?.branchId ?? MAIN_BRANCH_ID)
          setCurrentVersionId(latest?.id ?? null)
        }
        if (detail.decisions?.length > 0) {
          setDecisions(
            detail.decisions.map((d: DecisionRecord) => ({
              id: d.id,
              timestamp: d.timestamp ?? Date.now(),
              instruction: d.instruction,
              proposedSummary: d.proposedSummary,
              proposedChanges: d.proposedChanges,
              status: d.status,
              slideIds: d.slideIds,
              selectedElementIds: d.selectedElementIds,
              snapshotBefore: d.snapshotBefore,
            }))
          )
        }

        // Knowledge for this branch (seed defaults if the branch is empty).
        const branchId: string | null = detail.branchId ?? null
        try {
          const klRes = await fetch(
            `/api/knowledge${branchId ? `?branchId=${branchId}` : ''}`
          )
          if (klRes.ok) {
            const layers: KnowledgeLayer[] = await klRes.json()
            if (layers.length > 0) setKnowledgeLayers(layers)
            else if (branchId) setKnowledgeLayers(await seedBranchKnowledge(branchId))
            else setKnowledgeLayers(defaultKnowledgeLayers())
          }
        } catch {
          /* keep current layers */
        }

        // Design system is stored per branch in IndexedDB.
        const restoredDs = await loadStoredDesignSystem(dsId, branchId)
        if (restoredDs) {
          designSystemRef.current = restoredDs
          setDsName(restoredDs.name)
          setDsFiles(restoredDs.files)
          setDesignSystem(restoredDs)
        } else {
          designSystemRef.current = null
          setDsName('')
          setDsFiles([])
          setDesignSystem(null)
        }

        // Baseline the manual-edit tracker so loading a deck doesn't get captured
        // as a "manual edit" on the first tweak.
        closeManualSession(loadedSlides)

        setShowStartScreen(false)
        setInitialLoadDone(true)
      } catch (err) {
        console.error('Failed to open presentation', err)
      }
    },
    [dsId, seedBranchKnowledge, closeManualSession]
  )

  // Create a presentation, optionally inside a new branch, then open it.
  // When `slides` is provided (e.g. from an imported deck), the new presentation
  // starts from those slides instead of a single blank slide.
  const createPresentation = useCallback(
    async (opts: {
      name: string
      branchId?: string
      newBranchName?: string
      slides?: SlideData[]
      open?: boolean
    }) => {
      try {
        let branchId = opts.branchId
        if (opts.newBranchName) {
          const bRes = await fetch('/api/branches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: opts.newBranchName }),
          })
          if (bRes.ok) {
            branchId = (await bRes.json()).id
            if (branchId) await seedBranchKnowledge(branchId)
          }
        }

        const deckSlides =
          opts.slides && opts.slides.length > 0
            ? opts.slides
            : [{ id: `slide-${Date.now()}`, bg: 'FFFFFF', elements: [] } as SlideData]
        const createRes = await fetch('/api/presentations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: opts.name || 'Untitled Presentation',
            branchId,
            slides: deckSlides,
            conversationHistory: [],
            activeSlideId: deckSlides[0].id,
          }),
        })
        if (!createRes.ok) throw new Error('Failed to save the presentation')
        const { id } = await createRes.json()
        await loadPortfolio()
        // Background imports pass open:false so they don't yank the user out of
        // whatever they're currently viewing.
        if (opts.open !== false) await openPresentation(id)
        return id as string
      } catch (err) {
        console.error('Failed to create presentation', err)
        throw err
      }
    },
    [loadPortfolio, openPresentation, seedBranchKnowledge]
  )

  // Import a .pptx/.pdf file from the start screen into a brand-new presentation.
  const importPresentation = useCallback(
    async (file: File, branchId?: string) => {
      const baseName = file.name.replace(/\.(pptx|pdf|ppt)$/i, '').trim() || 'Imported deck'

      // Avoid silently creating duplicates: if a saved presentation already uses
      // this name, suggest a free "(n)" variant and let the user rename before
      // we run the (potentially slow) import.
      const taken = new Set(presentationSummaries.map(p => p.name.trim().toLowerCase()))
      const suggestUnique = (base: string) => {
        if (!taken.has(base.toLowerCase())) return base
        let n = 2
        while (taken.has(`${base} (${n})`.toLowerCase())) n++
        return `${base} (${n})`
      }
      let deckName = baseName
      while (taken.has(deckName.toLowerCase())) {
        const answer = window.prompt(
          `A presentation named "${deckName}" already exists in your knowledge hub. ` +
            `Enter a different name for the imported deck:`,
          suggestUnique(baseName)
        )
        if (answer === null) return // user cancelled the import
        deckName = answer.trim() || suggestUnique(baseName)
      }

      // Run the import in the background so the user can keep working (open
      // other decks, navigate around) while large PDFs convert/OCR. The result
      // appears in the portfolio when ready.
      const jobId = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setImportJobs(prev => [...prev, { id: jobId, name: deckName, status: 'loading' }])

      void (async () => {
        try {
          const { importDeckFile } = await import('@/lib/importDeck')
          const { slides: imported, warnings } = await importDeckFile(file)
          if (warnings.length > 0) console.warn('Import warnings:', warnings)
          const targetBranchId = branchId ?? branches[0]?.id
          await createPresentation({
            name: deckName,
            branchId: targetBranchId,
            newBranchName: !targetBranchId ? 'Imported decks' : undefined,
            slides: imported,
            open: false,
          })
          setImportJobs(prev => prev.filter(j => j.id !== jobId))
        } catch (err) {
          console.error('Failed to import deck', err)
          setImportJobs(prev =>
            prev.map(j =>
              j.id === jobId
                ? {
                    ...j,
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Failed to import presentation.',
                  }
                : j
            )
          )
        }
      })()
    },
    [branches, createPresentation, presentationSummaries]
  )

  const dismissImportJob = useCallback((id: string) => {
    setImportJobs(prev => prev.filter(j => j.id !== id))
  }, [])

  // Import a .pptx/.pdf file while editing: append its slides to the current deck.
  const appendImportedDeck = useCallback(
    async (file: File) => {
      setImportingDeck(true)
      try {
        const { importDeckFile } = await import('@/lib/importDeck')
        const { slides: imported, warnings } = await importDeckFile(file)
        if (warnings.length > 0) console.warn('Import warnings:', warnings)
        if (imported.length === 0) return
        pushHistory()
        setSlides(prev => [...prev, ...imported])
        setSelectedSlideIds([imported[0].id])
        setActiveSlideId(imported[0].id)
      } catch (err) {
        console.error('Failed to import deck', err)
        alert(err instanceof Error ? err.message : 'Failed to import presentation.')
      } finally {
        setImportingDeck(false)
      }
    },
    [pushHistory]
  )

  // Return to the start screen (refreshing the portfolio list).
  const goHome = useCallback(() => {
    setShowStartScreen(true)
    setPresentationId(null)
    setCurrentRole(null)
    setInitialLoadDone(false)
    void loadPortfolio()
  }, [loadPortfolio])

  // Create a new, empty knowledge branch (hub) from the start screen, seed its
  // default knowledge layers, and refresh the portfolio so it shows up.
  const createBranch = useCallback(
    async (name: string) => {
      try {
        const res = await fetch('/api/branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (!res.ok) throw new Error('Failed to create branch')
        const { id } = await res.json()
        if (id) await seedBranchKnowledge(id)
        await loadPortfolio()
      } catch (err) {
        console.error('Failed to create branch', err)
        throw err
      }
    },
    [loadPortfolio, seedBranchKnowledge]
  )

  const renameBranch = useCallback((id: string, name: string) => {
    setBranches(prev => prev.map(b => (b.id === id ? { ...b, name } : b)))
    fetch('/api/branches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    }).catch(() => {})
  }, [])

  const deleteBranch = useCallback((id: string) => {
    setBranches(prev => prev.filter(b => b.id !== id))
    fetch('/api/branches', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {})
  }, [])

  // Delete a presentation from the portfolio. Optimistically drop it from the
  // list and decrement its hub's deck count; reload on failure to resync.
  const deletePresentation = useCallback(
    async (id: string) => {
      const target = presentationSummaries.find(p => p.id === id)
      setPresentationSummaries(prev => prev.filter(p => p.id !== id))
      if (target?.branchId) {
        setBranches(prev =>
          prev.map(b =>
            b.id === target.branchId
              ? { ...b, presentationCount: Math.max(0, b.presentationCount - 1) }
              : b
          )
        )
      }
      try {
        const res = await fetch(`/api/presentations/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Delete failed')
      } catch (err) {
        console.error('Failed to delete presentation', err)
        void loadPortfolio()
      }
    },
    [presentationSummaries, loadPortfolio]
  )

  // Rename a presentation from the portfolio. Optimistically update the list,
  // then persist via the existing presentations POST (which updates name by id).
  const renamePresentation = useCallback(
    async (id: string, name: string) => {
      const clean = name.trim()
      if (!clean) return
      setPresentationSummaries(prev =>
        prev.map(p => (p.id === id ? { ...p, name: clean } : p))
      )
      try {
        const res = await fetch('/api/presentations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name: clean }),
        })
        if (!res.ok) throw new Error('Rename failed')
      } catch (err) {
        console.error('Failed to rename presentation', err)
        void loadPortfolio()
      }
    },
    [loadPortfolio]
  )

  // Pipe uncaught client errors + unhandled promise rejections to the dev terminal.
  useEffect(() => {
    installGlobalErrorReporting()
  }, [])

  // ── Load the portfolio once the session is ready ──────────────────────────────
  useEffect(() => {
    if (status !== 'authenticated' || dbInitialized.current) return
    dbInitialized.current = true
    void loadPortfolio()
  }, [status, loadPortfolio])

  // NEVER assert here: after an agent/manual edit deletes or replaces the active
  // slide, activeSlideId can momentarily point at a slide that no longer exists.
  // A bare `!` then throws "Cannot read properties of undefined (reading
  // 'elements')" on render → Next does a full reload → the user's just-typed
  // message is lost ("chat disappears"). Fall back to the first slide and let the
  // resync effect below repair activeSlideId.
  const activeSlide = slides.find(s => s.id === activeSlideId) ?? slides[0]
  const selectedElements = (activeSlide?.elements ?? []).filter(el =>
    selectedElementIds.includes(el.id)
  )

  // Self-heal a stale active-slide selection (e.g. after an edit deletes/replaces
  // the slide it pointed at) so the canvas tracks a real slide instead of crashing.
  useEffect(() => {
    if (slides.length > 0 && !slides.some(s => s.id === activeSlideId)) {
      setActiveSlideId(slides[0].id)
    }
  }, [slides, activeSlideId])
  // Proposals are now reviewed in a full-screen overlay (ProposalPreviewModal),
  // so the main canvas always renders the editable deck in a single column.
  const fitScale = useFitScale(canvasViewportRef, {
    mode: 'contain',
    padding: 56,
    columns: 1,
    gap: 0,
  })
  const canvasScale = fitScale * canvasZoom

  useEffect(() => {
    const el = canvasViewportRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setCanvasZoom(z =>
        clamp(
          Number((z + (e.deltaY < 0 ? CANVAS_ZOOM_STEP : -CANVAS_ZOOM_STEP)).toFixed(2)),
          CANVAS_ZOOM_MIN,
          CANVAS_ZOOM_MAX
        )
      )
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pendingChanges])
  const pendingSlideIds = pendingChanges
    ? Array.from(new Set(pendingChanges.map(c => c.slideId)))
    : []
  const pendingDeletedSlideIds = pendingChanges ? getDeletedSlideIds(pendingChanges) : []

  // ── Send a message to Claude ─────────────────────────────────────────────────
  const callApi = useCallback(
    async (
      newHistory: ConversationMessage[],
      annotatedImage?: string | null,
      attachedImages: string[] = [],
      effort: Effort = 'medium',
      answerOnly = false,
      routerScope: RouterScope = 'active'
    ) => {
      setIsLoading(true)
      setPendingChanges(null)

      const lastUserMessage = [...newHistory].reverse().find(m => m.role === 'user')?.content ?? ''
      // Scope is decided by the LLM router (no keyword parsing); we just map its
      // decision onto the concrete slide set.
      const { mode: scopeMode, slides: scopeSlides } = slidesForScope(
        routerScope,
        activeSlideId,
        selectedSlideIds,
        slides
      )
      setLastScopeMode(scopeMode)

      const ac = new AbortController()
      singleShotAbortRef.current = ac
      try {
        const res = await fetch('/api/edit', {
          method: 'POST',
          signal: ac.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: newHistory,
            selectedElementIds,
            selectedSlideIds,
            scopeSlides,
            scopeMode,
            allSlides: slides,
            intent: answerOnly ? 'ask' : 'edit',
            templateKnowledge: mergeTemplatesKnowledge(templates) || null,
            knowledgeContext: buildKnowledgeContext(knowledgeLayers, decisions, activeSlideId, {
              instruction: lastUserMessage,
              slideText: activeSlideText(slides, activeSlideId),
              // Uploaded reference docs are the source of truth — keep a useful
              // chunk (incl. table structure) rather than cutting to one sentence.
              documentCharCap: 16000,
              documentTotalCap: 32000,
            }),
            annotatedImage: annotatedImage || null,
            attachedImages,
            mediaManifest: mediaManifest(collectAllAssets()),
            effort,
          }),
        })

        const data: ClaudeResponse = await res.json()

        // Self-escalation: the single-shot model decided this needs the iterative
        // visual agent. Hand off (the user bubble is already shown, so skip its echo).
        if (data.type === 'needs_agent') {
          console.log('[edit] model self-escalated to agent:', data.reason)
          setDisplay(prev => [
            ...prev,
            {
              role: 'assistant',
              agentStep: {
                kind: 'note',
                label: `Switching to the agent — ${data.reason}`,
              },
            },
          ])
          setIsLoading(false)
          runAgentRef.current?.(lastUserMessage, { effort: bumpEffort(effort), skipUserEcho: true })
          return
        }

        // Swap any image references ("image:/logo:/media:<name>") for real assets.
        if (data.type === 'patch') {
          const assets = collectAllAssets()
          data.changes = resolveAssetRefs(data.changes, assets)
          const missing = unresolvedRefs(data.changes)
          if (missing.length) {
            console.warn(
              `[edit] ${missing.length} image reference(s) could not be resolved: ${missing.join(', ')}. ` +
                `Available assets: ${assets.map(a => a.name).join(', ') || '(none — upload logos/images in the Design System → Logos section)'}`
            )
          }
        }

        console.groupCollapsed(
          `%c[edit] AI response · ${data.type} · scope=${scopeMode}`,
          'color:#60a5fa;font-weight:bold'
        )
        console.log('instruction:', lastUserMessage)
        console.log('http status:', res.status, res.ok ? 'ok' : 'NOT OK')
        console.log('raw response:', data)
        if (data.type === 'patch') {
          const report = analyzeChanges(slides, data.changes)
          console.log('summary:', data.summary)
          console.log(
            `diagnostics — ${report.willApply}/${report.total} will apply (${report.skipped} skipped):`
          )
          console.log(formatChangeReport(report))
          if (report.total > 0 && report.willApply === 0) {
            console.warn(
              '[edit] None of the proposed changes will apply — check notes above for why (unknown ids, unrecognized fields, no-op patch).'
            )
          }
          const applied = applyChangesToSlides(slides, data.changes)
          const { newIssues } = reviewLayoutChange(slides, applied)
          if (newIssues.length > 0) {
            console.warn(
              `[edit] layout review: this change introduces ${newIssues.length} overlap/out-of-bounds issue(s):\n` +
                formatLayoutIssues(newIssues)
            )
          } else {
            console.log('layout review: no new overlaps/out-of-bounds introduced.')
          }
        } else {
          console.log('clarification:', data.question)
        }
        console.groupEnd()

        const assistantMsg: ConversationMessage = {
          role: 'assistant',
          content: JSON.stringify(data),
        }
        setConversationHistory([...newHistory, assistantMsg])
        // A fresh patch supersedes any still-pending proposal (mark it declined),
        // then append the new one as the live (pending) widget.
        setDisplay(prev => [
          ...prev.map(m =>
            m.patchStatus === 'pending' ? { ...m, patchStatus: 'declined' as const } : m
          ),
          {
            role: 'assistant',
            response: data,
            ...(data.type === 'patch' ? { patchStatus: 'pending' as const } : {}),
          },
        ])

        if (data.type === 'patch') {
          setPendingChanges(data.changes)
          setPendingSummary(data.summary)
          setHighlightDiffOnCanvas(false)

          // The preview canvas only renders the active slide. If the change
          // targets a different slide, jump to the first changed slide so the
          // proposed changes are actually visible in the Current/Proposed view.
          const changedSlideIds = Array.from(new Set(data.changes.map(c => c.slideId)))
          if (changedSlideIds.length > 0 && !changedSlideIds.includes(activeSlideId)) {
            const target = changedSlideIds[0]
            setActiveSlideId(target)
            setSelectedSlideIds([target])
            setSelectionAnchorId(target)
          }

          // Stable client-generated id: the same id is used for the DB row and any
          // later status PATCH, so a fast Apply can't race an async id-swap.
          const decisionId = crypto.randomUUID()
          setPendingDecisionId(decisionId)
          const userInstruction = lastUserMessage
          const record: DecisionRecord = {
            id: decisionId,
            timestamp: Date.now(),
            slideIds: scopeSlides.map((s: SlideData) => s.id),
            selectedElementIds,
            instruction: userInstruction,
            proposedSummary: data.summary,
            proposedChanges: data.changes,
            status: 'pending',
            snapshotBefore: JSON.parse(JSON.stringify(slides)),
          }
          setDecisions(prev => [...prev, record])

          // Persist decision (fire-and-forget, but failures are logged, not swallowed).
          if (presentationId) {
            persistDecision(presentationId, record).catch(e =>
              console.warn('[persist] decision create failed', e)
            )
          }
        }
      } catch (err) {
        // A user-triggered Stop aborts the fetch — that's a clean stop, not an error.
        const aborted =
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err as { name?: string })?.name === 'AbortError'
        if (aborted) {
          setDisplay(prev => [
            ...prev,
            { role: 'assistant', agentStep: { kind: 'note', label: 'Stopped.' } },
          ])
        } else {
          console.error('[edit] request failed:', err)
          const errMsg: ClaudeResponse = {
            type: 'clarification',
            question: 'Something went wrong. Please try again.',
          }
          const assistantMsg: ConversationMessage = {
            role: 'assistant',
            content: JSON.stringify(errMsg),
          }
          setConversationHistory([...newHistory, assistantMsg])
          setDisplay(prev => [...prev, { role: 'assistant', response: errMsg }])
        }
      } finally {
        singleShotAbortRef.current = null
        setIsLoading(false)
      }
    },
    [slides, activeSlideId, selectedSlideIds, selectedElementIds, knowledgeLayers, decisions, templates, presentationId, designSystem, collectAllAssets]
  )

  const handleSlideSelect = useCallback(
    (slideId: string, modifiers: { shift: boolean; ctrl: boolean }) => {
      const result = computeSlideSelection(
        slideId,
        slides.map(s => s.id),
        selectedSlideIds,
        selectionAnchorId,
        modifiers
      )
      setSelectedSlideIds(result.selected)
      setSelectionAnchorId(result.anchor)
      setActiveSlideId(result.active)
      setSelectedElementIds([])
    },
    [slides, selectedSlideIds, selectionAnchorId]
  )

  const deleteSelectedSlides = useCallback(() => {
    const idsToDelete = Array.from(new Set(selectedSlideIds))
    if (idsToDelete.length === 0) return
    if (slides.length - idsToDelete.length < 1) {
      window.alert('Keep at least one slide in the deck.')
      return
    }

    const count = idsToDelete.length
    const confirmed = window.confirm(
      `Delete ${count} slide${count !== 1 ? 's' : ''}? This can be undone with Revert.`
    )
    if (!confirmed) return

    pushHistory()
    const newSlides = slides.filter(s => !idsToDelete.includes(s.id))
    setSlides(newSlides)

    const remainingSelected = selectedSlideIds.filter(id => !idsToDelete.includes(id))
    const nextActive =
      remainingSelected[0] ??
      newSlides.find(s => s.id === activeSlideId)?.id ??
      newSlides[0].id

    setActiveSlideId(nextActive)
    setSelectedSlideIds(remainingSelected.length > 0 ? remainingSelected : [nextActive])
    setSelectionAnchorId(nextActive)
    setSelectedElementIds([])
    setEditingElementId(null)
    setPendingChanges(null)
    setPendingSummary('')
    setHighlightDiffOnCanvas(false)

  }, [
    slides,
    selectedSlideIds,
    activeSlideId,
    presentationId,
  ])

  const alignElements = useCallback(
    (mode: AlignMode) => {
      const slide = slides.find(s => s.id === activeSlideId)
      if (!slide) return
      const sel = slide.elements.filter(e => selectedElementIds.includes(e.id))
      if (sel.length < 2) return

      const minX = Math.min(...sel.map(e => e.x))
      const maxX = Math.max(...sel.map(e => e.x + e.w))
      const minY = Math.min(...sel.map(e => e.y))
      const maxY = Math.max(...sel.map(e => e.y + e.h))

      const updates = new Map<string, { x?: number; y?: number }>()
      if (mode === 'left') sel.forEach(e => updates.set(e.id, { x: minX }))
      else if (mode === 'right') sel.forEach(e => updates.set(e.id, { x: maxX - e.w }))
      else if (mode === 'hcenter') {
        const c = (minX + maxX) / 2
        sel.forEach(e => updates.set(e.id, { x: c - e.w / 2 }))
      } else if (mode === 'top') sel.forEach(e => updates.set(e.id, { y: minY }))
      else if (mode === 'bottom') sel.forEach(e => updates.set(e.id, { y: maxY - e.h }))
      else if (mode === 'vmiddle') {
        const c = (minY + maxY) / 2
        sel.forEach(e => updates.set(e.id, { y: c - e.h / 2 }))
      } else if (mode === 'distribute-h' && sel.length >= 3) {
        const sorted = [...sel].sort((a, b) => a.x - b.x)
        const totalW = sorted.reduce((s, e) => s + e.w, 0)
        const gap = (maxX - minX - totalW) / (sorted.length - 1)
        let cursor = minX
        sorted.forEach(e => {
          updates.set(e.id, { x: cursor })
          cursor += e.w + gap
        })
      } else if (mode === 'distribute-v' && sel.length >= 3) {
        const sorted = [...sel].sort((a, b) => a.y - b.y)
        const totalH = sorted.reduce((s, e) => s + e.h, 0)
        const gap = (maxY - minY - totalH) / (sorted.length - 1)
        let cursor = minY
        sorted.forEach(e => {
          updates.set(e.id, { y: cursor })
          cursor += e.h + gap
        })
      }

      if (updates.size === 0) return
      pushHistory()
      setSlides(prev =>
        prev.map(s =>
          s.id !== activeSlideId
            ? s
            : {
                ...s,
                elements: s.elements.map(e => {
                  const u = updates.get(e.id)
                  return u
                    ? {
                        ...e,
                        ...(u.x !== undefined ? { x: u.x } : {}),
                        ...(u.y !== undefined ? { y: u.y } : {}),
                      }
                    : e
                }),
              }
        )
      )
    },
    [slides, activeSlideId, selectedElementIds, pushHistory]
  )

  // Move all selected elements by (dx, dy) inches. Consecutive nudges within a
  // short window collapse into one undo step (like holding arrows in PowerPoint).
  const nudgeSelectedElements = useCallback(
    (dx: number, dy: number) => {
      if (selectedElementIds.length === 0) return
      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current)
      } else {
        pushHistory()
      }
      nudgeTimerRef.current = setTimeout(() => {
        nudgeTimerRef.current = null
      }, 700)

      const clampPos = (v: number, size: number, max: number) =>
        Math.max(0, Math.min(v, Math.max(0, max - size)))

      setSlides(prev =>
        prev.map(s =>
          s.id !== activeSlideId
            ? s
            : {
                ...s,
                elements: s.elements.map(e =>
                  selectedElementIds.includes(e.id)
                    ? {
                        ...e,
                        x: clampPos(e.x + dx, e.w, SLIDE_W_IN),
                        y: clampPos(e.y + dy, e.h, SLIDE_H_IN),
                      }
                    : e
                ),
              }
        )
      )
    },
    [selectedElementIds, activeSlideId, pushHistory]
  )

  const deleteSelectedElements = useCallback(() => {
    if (selectedElementIds.length === 0) return
    pushHistory()
    setSlides(prev =>
      prev.map(s =>
        s.id === activeSlideId
          ? { ...s, elements: s.elements.filter(e => !selectedElementIds.includes(e.id)) }
          : s
      )
    )
    setSelectedElementIds([])
    setEditingElementId(null)
  }, [selectedElementIds, activeSlideId, pushHistory])

  // ── Copy / paste elements across slides ───────────────────────────────────────
  // Copy the selected element(s) from the active slide into the in-app clipboard.
  const copySelectedElements = useCallback(() => {
    if (selectedElementIds.length === 0) return
    const src = slides.find(s => s.id === activeSlideId)
    if (!src) return
    const picked = src.elements.filter(e => selectedElementIds.includes(e.id))
    if (picked.length === 0) return
    setClipboardElements(JSON.parse(JSON.stringify(picked)) as SlideElement[])
  }, [slides, activeSlideId, selectedElementIds])

  // Paste clipboard element(s) at the SAME position onto the target slides: every
  // slide selected in the sidebar (so you can paste to many at once), or the
  // active slide when only one is selected. New IDs are generated per slide.
  const pasteElements = useCallback(() => {
    if (clipboardElements.length === 0) return
    const targetIds = selectedSlideIds.length > 0 ? selectedSlideIds : [activeSlideId]
    pushHistory()
    const baseId = (id: string) => id.replace(/-c[a-z0-9]{4,}$/i, '')
    const freshId = (id: string, taken: Set<string>) => {
      let next: string
      do {
        next = `${baseId(id)}-c${Math.random().toString(36).slice(2, 6)}`
      } while (taken.has(next))
      taken.add(next)
      return next
    }
    let pastedOnActive: string[] = []
    setSlides(prev =>
      prev.map(s => {
        if (!targetIds.includes(s.id)) return s
        const taken = new Set(s.elements.map(e => e.id))
        const pasted = clipboardElements.map(el => {
          const clone = JSON.parse(JSON.stringify(el)) as SlideElement
          clone.id = freshId(el.id, taken)
          return clone
        })
        if (s.id === activeSlideId) pastedOnActive = pasted.map(p => p.id)
        return { ...s, elements: [...s.elements, ...pasted] }
      })
    )
    // Select the freshly pasted elements if they landed on the visible slide.
    if (pastedOnActive.length > 0) {
      setSelectedElementIds(pastedOnActive)
      setEditingElementId(null)
    }
  }, [clipboardElements, selectedSlideIds, activeSlideId, pushHistory])

  const cutSelectedElements = useCallback(() => {
    copySelectedElements()
    deleteSelectedElements()
  }, [copySelectedElements, deleteSelectedElements])

  // Insert an image element (centered, fit to a sensible size) onto the active slide.
  const addImageElement = useCallback(
    (src: string, naturalRatio?: number) => {
      pushHistory()
      const maxW = 3
      const ratio = naturalRatio && naturalRatio > 0 ? naturalRatio : 16 / 9
      const w = maxW
      const h = Math.min(SLIDE_H_IN - 1, w / ratio)
      const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const newEl: SlideElement = {
        id,
        type: 'image',
        src,
        content: 'image',
        x: (SLIDE_W_IN - w) / 2,
        y: (SLIDE_H_IN - h) / 2,
        w,
        h,
        style: { objectFit: 'contain' },
      }
      setSlides(prev =>
        prev.map(s => (s.id === activeSlideId ? { ...s, elements: [...s.elements, newEl] } : s))
      )
      setSelectedElementIds([id])
      setEditingElementId(null)
      setLeftTab('design')
    },
    [activeSlideId, pushHistory]
  )

  // Insert a chart element (defaults to a sample bar chart) onto the active slide.
  const addChartElement = useCallback(
    (chart?: ChartSpec) => {
      pushHistory()
      const w = 5
      const h = 3.2
      const id = `chart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const spec: ChartSpec = chart ?? {
        type: 'bar',
        title: 'Metric overview',
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [{ name: 'Value', values: [12, 19, 15, 27] }],
        showGrid: true,
      }
      const newEl: SlideElement = {
        id,
        type: 'chart',
        chart: spec,
        content: spec.title || 'chart',
        x: (SLIDE_W_IN - w) / 2,
        y: (SLIDE_H_IN - h) / 2,
        w,
        h,
        style: {},
      }
      setSlides(prev =>
        prev.map(s => (s.id === activeSlideId ? { ...s, elements: [...s.elements, newEl] } : s))
      )
      setSelectedElementIds([id])
      setEditingElementId(null)
      setLeftTab('design')
    },
    [activeSlideId, pushHistory]
  )

  const addIconElement = useCallback(
    (iconName?: string) => {
      pushHistory()
      const size = 1
      const id = `icon-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const newEl: SlideElement = {
        id,
        type: 'icon',
        icon: iconName || 'Star',
        x: (SLIDE_W_IN - size) / 2,
        y: (SLIDE_H_IN - size) / 2,
        w: size,
        h: size,
        style: { color: '60a5fa', iconStrokeWidth: 2 },
      }
      setSlides(prev =>
        prev.map(s => (s.id === activeSlideId ? { ...s, elements: [...s.elements, newEl] } : s))
      )
      setSelectedElementIds([id])
      setEditingElementId(null)
      setLeftTab('design')
    },
    [activeSlideId, pushHistory]
  )

  // Insert an empty editable text block onto the active slide (enters edit mode).
  const addTextElement = useCallback(() => {
    pushHistory()
    const w = 3.5
    const h = 0.7
    const id = `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const newEl: SlideElement = {
      id,
      type: 'text',
      content: 'New text',
      x: (SLIDE_W_IN - w) / 2,
      y: (SLIDE_H_IN - h) / 2,
      w,
      h,
      style: { fontSize: 18, color: 'E2E8F0', align: 'left', valign: 'top' },
    }
    setSlides(prev =>
      prev.map(s => (s.id === activeSlideId ? { ...s, elements: [...s.elements, newEl] } : s))
    )
    setSelectedElementIds([id])
    setEditingElementId(id)
    setLeftTab('design')
  }, [activeSlideId, pushHistory])

  // Insert a plain filled rectangle (shape) onto the active slide.
  const addShapeElement = useCallback(() => {
    pushHistory()
    const w = 2.2
    const h = 1.4
    const id = `rect-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const newEl: SlideElement = {
      id,
      type: 'rect',
      content: '',
      x: (SLIDE_W_IN - w) / 2,
      y: (SLIDE_H_IN - h) / 2,
      w,
      h,
      style: { bg: '1E3A5F', borderRadius: 4 },
    }
    setSlides(prev =>
      prev.map(s => (s.id === activeSlideId ? { ...s, elements: [...s.elements, newEl] } : s))
    )
    setSelectedElementIds([id])
    setEditingElementId(null)
    setLeftTab('design')
  }, [activeSlideId, pushHistory])

  // There's no native table element, so a "table" is built from primitives: one
  // bordered rect per cell + a text element on top. Header row is tinted/bold.
  const addTableElement = useCallback((rows = 3, cols = 3) => {
    pushHistory()
    const totalW = 6
    const ch = 0.55
    const totalH = rows * ch
    const cw = totalW / cols
    const x0 = (SLIDE_W_IN - totalW) / 2
    const y0 = (SLIDE_H_IN - totalH) / 2
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
    const els: SlideElement[] = []
    const ids: string[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isHeader = r === 0
        const cellId = `tbl-${stamp}-r${r}c${c}`
        els.push({
          id: `${cellId}-bg`,
          type: 'rect',
          content: '',
          x: x0 + c * cw,
          y: y0 + r * ch,
          w: cw,
          h: ch,
          style: {
            bg: isHeader ? '1E3A5F' : '0F2236',
            borderWidth: 1,
            borderColor: '2A4A6F',
            borderStyle: 'solid',
          },
        })
        els.push({
          id: `${cellId}-txt`,
          type: 'text',
          content: isHeader ? `Header ${c + 1}` : 'Cell',
          x: x0 + c * cw,
          y: y0 + r * ch,
          w: cw,
          h: ch,
          style: {
            fontSize: 12,
            color: isHeader ? 'FFFFFF' : 'CBD5E1',
            bold: isHeader,
            align: 'left',
            valign: 'middle',
            padLeft: 0.08,
            padRight: 0.08,
          },
        })
        ids.push(`${cellId}-bg`, `${cellId}-txt`)
      }
    }
    setSlides(prev =>
      prev.map(s => (s.id === activeSlideId ? { ...s, elements: [...s.elements, ...els] } : s))
    )
    setSelectedElementIds(ids)
    setEditingElementId(null)
    setLeftTab('design')
  }, [activeSlideId, pushHistory])

  // Measure an image src's aspect ratio, then insert it onto the active slide.
  const insertImageSrc = useCallback(
    (src: string) => {
      if (!src) return
      const probe = new window.Image()
      probe.onload = () => addImageElement(src, probe.naturalWidth / probe.naturalHeight)
      probe.onerror = () => addImageElement(src)
      probe.src = src
    },
    [addImageElement]
  )

  // Read an image file, register it in the media library (so it can be referenced
  // by name later), then insert it onto the slide.
  const handleImageFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = () => {
        const src = String(reader.result ?? '')
        if (!src) return
        setMediaLibrary(prev =>
          prev.some(a => a.src === src)
            ? prev
            : [
                ...prev,
                { id: makeAssetId(), name: assetNameFromFile(file.name, prev), src, kind: 'image' },
              ]
        )
        insertImageSrc(src)
      }
      reader.readAsDataURL(file)
    },
    [insertImageSrc]
  )

  const reorderSlides = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex === toIndex ||
        fromIndex >= slidesRef.current.length ||
        toIndex >= slidesRef.current.length
      ) {
        return
      }
      pushHistory()
      setSlides(prev => {
        const next = [...prev]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        return next
      })
    },
    [pushHistory]
  )

  const applySlideOp = useCallback((res: SlideOpResult) => {
    if (!res.changed) return
    pushHistory()
    setSlides(res.slides)
    setActiveSlideId(res.activeSlideId)
    setSelectedSlideIds(res.selectedSlideIds)
    setSelectionAnchorId(res.activeSlideId)
    setSelectedElementIds([])
    setEditingElementId(null)
    setPendingChanges(null)
    setPendingSummary('')
    setHighlightDiffOnCanvas(false)
  }, [slides])

  const duplicateSelectedSlides = useCallback(() => {
    if (selectedSlideIds.length === 0) return
    applySlideOp(duplicateSlides(slides, selectedSlideIds))
  }, [slides, selectedSlideIds, applySlideOp])

  const splitActiveSlide = useCallback(() => {
    applySlideOp(splitSlide(slides, activeSlideId))
  }, [slides, activeSlideId, applySlideOp])

  // Insert a new blank slide. When `afterId` is given it lands right after that
  // slide (used by the toolbar's "add" tool, relative to the active slide);
  // otherwise it's appended to the end (the slide-panel "+" button). The new
  // slide inherits the reference slide's background so it matches the deck.
  const addSlide = useCallback(
    (afterId?: string) => {
      pushHistory()
      const newSlide: SlideData = {
        id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        bg: 'FFFFFF',
        elements: [],
      }
      setSlides(prev => {
        const refId = afterId ?? activeSlideId
        const refSlide = prev.find(s => s.id === refId)
        if (refSlide) {
          newSlide.bg = refSlide.bg
          if (refSlide.bgGradient) newSlide.bgGradient = refSlide.bgGradient
        }
        const idx = afterId ? prev.findIndex(s => s.id === afterId) : -1
        const insertAt = idx >= 0 ? idx + 1 : prev.length
        return [...prev.slice(0, insertAt), newSlide, ...prev.slice(insertAt)]
      })
      setActiveSlideId(newSlide.id)
      setSelectedSlideIds([newSlide.id])
      setSelectionAnchorId(newSlide.id)
      setSelectedElementIds([])
      setEditingElementId(null)
    },
    [activeSlideId, pushHistory]
  )

  const mergeSelectedSlides = useCallback(() => {
    if (selectedSlideIds.length < 2) return
    applySlideOp(mergeSlides(slides, selectedSlideIds))
  }, [slides, selectedSlideIds, applySlideOp])

  // Change the background color of every selected slide (records one undo step).
  // Picking a solid color also clears any gradient on those slides. When nothing
  // is multi-selected this falls back to just the active slide.
  const updateSlideBg = useCallback(
    (hex: string) => {
      const clean = hex.replace('#', '').toUpperCase()
      const targets = new Set(selectedSlideIds.length > 0 ? selectedSlideIds : [activeSlideId])
      pushHistory()
      setSlides(prev =>
        prev.map(slide =>
          targets.has(slide.id) ? { ...slide, bg: clean, bgGradient: undefined } : slide
        )
      )
    },
    [selectedSlideIds, activeSlideId, pushHistory]
  )

  // Set or clear the gradient background on every selected slide. Passing null
  // reverts to the solid `bg`. When set, `bg` is synced to the gradient's start
  // color so exports (PPTX/PDF) have a sensible solid fallback.
  const updateSlideGradient = useCallback(
    (gradient: SlideGradient | null) => {
      const targets = new Set(selectedSlideIds.length > 0 ? selectedSlideIds : [activeSlideId])
      pushHistory()
      setSlides(prev =>
        prev.map(slide => {
          if (!targets.has(slide.id)) return slide
          if (!gradient) return { ...slide, bgGradient: undefined }
          return {
            ...slide,
            bg: (gradient.from || slide.bg).replace('#', '').toUpperCase(),
            bgGradient: gradient,
          }
        })
      )
    },
    [selectedSlideIds, activeSlideId, pushHistory]
  )

  // Select every slide in the deck (keeps the current active slide as the anchor
  // so background/quick-action targeting stays intuitive).
  const selectAllSlides = useCallback(() => {
    const allIds = slides.map(s => s.id)
    if (allIds.length === 0) return
    setSelectedSlideIds(allIds)
    setSelectionAnchorId(activeSlideId && allIds.includes(activeSlideId) ? activeSlideId : allIds[0])
    setSelectedElementIds([])
  }, [slides, activeSlideId])

  // Run a one-click "quick action" (split/merge/tidy…) straight through the agent.
  // Bypasses the router (we already know it's a tool-using edit) and carries a
  // Cursor-style checkpoint so the action can be reverted/edited like any message.
  const runQuickAction = useCallback(
    (action: QuickAction) => {
      if (isLoading || isAgentRunning || !canEdit) return
      const ctx: QuickActionContext = {
        slides,
        activeSlideId,
        activeSlideIndex: slides.findIndex(s => s.id === activeSlideId),
        selectedSlideIds,
        selectedElementIds,
      }
      if (!action.isAvailable(ctx)) return
      const instruction = action.buildInstruction(ctx)
      const checkpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
      const historyLength = conversationHistory.length
      setConversationHistory(prev => [...prev, { role: 'user', content: instruction }])
      runAgentRef.current?.(instruction, {
        effort: action.effort ?? 'medium',
        checkpoint,
        historyLength,
      })
    },
    [
      isLoading,
      isAgentRunning,
      slides,
      activeSlideId,
      selectedSlideIds,
      selectedElementIds,
      conversationHistory,
      canEdit,
    ]
  )

  const handleSend = useCallback(
    async (text: string, images: string[] = [], uiMode: UiMode = 'auto') => {
     if (!canEdit) {
       setDisplay(prev => [
         ...prev,
         {
           role: 'assistant',
           response: {
             type: 'clarification',
             question:
               'You have view-only access to this hub. Ask an owner to make you an editor to make changes.',
           },
         },
       ])
       return
     }
     try {
      // A fresh free-form message supersedes any unanswered agent clarification.
      setPendingAgentInstruction(null)
      // If the user drew annotations, capture the slide + strokes as a PNG to attach.
      // pixelRatio 1 keeps the base64 small (960×720 is ample for vision); a failed
      // capture must NOT silently drop the drawing — we tell the user and keep the
      // strokes so they can retry.
      let annotatedImage: string | null = null
      let annotationCaptureFailed = false
      if (strokes.length > 0 && canvasCaptureRef.current) {
        try {
          annotatedImage = await toPng(canvasCaptureRef.current, {
            pixelRatio: 1,
            cacheBust: true,
          })
        } catch (err) {
          console.error('Annotation capture failed', err)
          annotationCaptureFailed = true
        }
      }
      if (annotationCaptureFailed) {
        setDisplay(prev => [
          ...prev,
          {
            role: 'assistant',
            response: {
              type: 'clarification',
              question:
                "I couldn't capture your annotations, so I'm sending the message as text only. Your drawing is still on the slide — try again if you need it included.",
            },
          },
        ])
      }

      // ── Route: a fast model decides flow (single-shot vs agent) + effort ──
      // Briefly flag loading so the routing model call (≈1s) doesn't look frozen;
      // each downstream branch shows the user bubble + manages its own loading.
      setIsLoading(true)
      const cls = await classifyRequest(text, {
        selectedElementCount: selectedElementIds.length,
        selectedSlideCount: selectedSlideIds.length,
        totalSlides: slides.length,
        hasImages: images.length > 0,
      })
      setIsLoading(false)
      // A pure question/analysis request is answer-only — it must NEVER edit the
      // deck, regardless of the chosen UI mode (Auto/Single/Agent). Detection only
      // triggers when there's no edit verb, so real edits are unaffected.
      const isAsk = cls.mode === 'ask'

      // ── Scope disambiguation ──
      // The LLM router flags genuinely ambiguous scope (broad change on a
      // multi-slide deck with no selection) as scope:"ask" — we then confirm
      // whether to touch just this slide or the whole deck. Skipped when the user
      // chose a mode explicitly, attached pixels, or it's a question.
      if (
        uiMode === 'auto' &&
        !isAsk &&
        !annotatedImage &&
        images.length === 0 &&
        cls.scope === 'ask'
      ) {
        setPendingScopeInstruction(text)
        setDisplay(prev => [
          ...prev,
          { role: 'user', text },
          {
            role: 'assistant',
            response: {
              type: 'clarification',
              question: 'Should I apply this to just the current slide, or the whole presentation?',
              options: [
                { id: 'scope-active', label: 'Just this slide' },
                { id: 'scope-deck', label: 'The whole presentation' },
              ],
            },
          },
        ])
        return
      }

      let route: 'single' | 'agent' = isAsk
        ? 'single'
        : uiMode === 'auto'
          ? (cls.mode as 'single' | 'agent')
          : uiMode
      // Keep the classifier's effort as-is: low (thinking disabled) is the right,
      // fast setting for mechanical agent edits and no longer gets bumped up.
      const effort: Effort = cls.effort
      // The agent loop can't see user-attached reference images / annotations, but
      // the single-shot endpoint passes them to the model — so force single-shot
      // whenever the user supplied pixels to look at. Tell the user when this
      // overrides a would-be multi-slide agent run so the scope limit isn't silent.
      if (images.length > 0 || annotatedImage) {
        if (cls.mode === 'agent' && !isAsk) {
          setDisplay(prev => [
            ...prev,
            {
              role: 'assistant',
              response: {
                type: 'clarification',
                question:
                  'With an attached image/annotation I focus on the active slide (the multi-slide agent can’t see images). For deck-wide changes, resend without an attachment.',
              },
            },
          ])
        }
        route = 'single'
      }

      console.log(
        `[router] "${text.slice(0, 60)}" → ${uiMode === 'auto' ? 'auto' : 'manual'}:${route}${
          isAsk ? ' (answer-only)' : ''
        } · effort=${effort}`
      )

      if (route === 'agent') {
        // Snapshot BEFORE recording the turn so the agent's user bubble can carry a
        // Cursor-style checkpoint (edit/revert to this exact point) just like single-shot.
        const agentCheckpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
        const agentHistoryLength = conversationHistory.length
        // Record the user turn in history so later turns (single-shot OR agent)
        // can see it — otherwise agent instructions vanish from the thread and
        // follow-ups like "do that across all slides" lose their referent.
        setConversationHistory(prev => [...prev, { role: 'user', content: text }])
        runAgentRef.current?.(text, {
          effort,
          checkpoint: agentCheckpoint,
          historyLength: agentHistoryLength,
        })
        return
      }

      const userMsg: ConversationMessage = {
        role: 'user',
        content: text,
        ...(annotatedImage ? { imageDataUrl: annotatedImage } : {}),
        ...(images.length > 0 ? { imageDataUrls: images } : {}),
      }
      const newHistory = [...conversationHistory, userMsg]
      const checkpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
      setDisplay(prev => [
        ...prev,
        {
          role: 'user',
          text,
          ...(annotatedImage ? { imageUrl: annotatedImage } : {}),
          ...(images.length > 0 ? { imageUrls: images } : {}),
          checkpoint,
          historyLength: conversationHistory.length,
        },
      ])
      setConversationHistory(newHistory)
      callApi(newHistory, annotatedImage, images, effort, isAsk, cls.scope)

      // Clear annotations after sending so the next message starts clean.
      if (annotatedImage) {
        setStrokes([])
        setAnnotationMode(false)
      }
     } catch (err) {
       // A failure here used to silently vanish (and take the user's message with
       // it). Now: log loudly to the terminal, restore the text to the input so it
       // ISN'T lost, and tell the user what happened.
       setIsLoading(false)
       reportClientError('handleSend', err, { text: text.slice(0, 200), uiMode })
       setChatDraft({ text, nonce: Date.now() })
       setDisplay(prev => [
         ...prev,
         {
           role: 'assistant',
           response: {
             type: 'clarification',
             question:
               'Something failed while sending your message (the error was logged to the terminal). ' +
               "I put your text back in the box so it isn't lost — try again.",
           },
         },
       ])
     }
    },
    [conversationHistory, callApi, strokes, slides, selectedElementIds, selectedSlideIds, isAgentRunning, canEdit]
  )

  // ── Agentic editor: render one slide off-screen to a PNG so the model can see it ──
  const renderSlideToPng = useCallback(async (slide: SlideData): Promise<string | null> => {
    setCaptureScale(AGENT_RENDER_SCALE)
    setCaptureSlide(slide)
    // Wait for the off-screen canvas to mount and paint before snapshotting.
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    await new Promise<void>(resolve => setTimeout(resolve, 90))
    const node = agentCaptureRef.current
    if (!node) return null
    try {
      const dataUrl = await toPng(node, {
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: '#0D1B2A',
        // Inline the design-system @font-face rules so the agent's verification
        // screenshot actually renders in the uploaded fonts.
        fontEmbedCSS: fontFaceCssRef.current || undefined,
      })
      // Defensive guard: the Anthropic API rejects images whose base64 payload
      // exceeds 10MB. Rather than hard-failing the whole turn (400 → "model call
      // failed"), drop an oversized screenshot so the loop degrades gracefully.
      const base64Len = dataUrl.length - (dataUrl.indexOf(',') + 1)
      const approxBytes = base64Len * 0.75
      if (approxBytes > 8_000_000) {
        console.warn(`[agent] render too large (~${Math.round(approxBytes / 1e6)}MB) — skipping image`)
        return null
      }
      return dataUrl
    } catch (err) {
      console.error('[agent] render failed', err)
      return null
    }
  }, [])

  // Snapshot an agent run as a version + accepted decision so autonomous edits get
  // the same audit trail / rollback as single-shot edits. Called once per run with
  // the before/after decks; a no-op when nothing actually changed.
  const recordAgentRun = useCallback(
    (
      before: SlideData[],
      after: SlideData[],
      instruction: string,
      summary: string,
      skippedNote = ''
    ) => {
      const changedSlideIds = diffSlideIds(before, after)
      if (changedSlideIds.length === 0) return

      const decisionId = crypto.randomUUID()
      const decision: DecisionRecord = {
        id: decisionId,
        timestamp: Date.now(),
        slideIds: changedSlideIds,
        selectedElementIds: [],
        instruction,
        proposedSummary: summary || 'Agent edit',
        proposedChanges: [],
        // The agent auto-applies, so the user implicitly accepted by letting it run.
        status: 'accepted',
        snapshotBefore: JSON.parse(JSON.stringify(before)),
      }
      setDecisions(prev => [...prev, decision])

      const diff = summarizeDeckChanges(before, after)
      const version: SlideVersion = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        label: null,
        changeLog: `Agent: ${summary || instruction}`.slice(0, 160) + ` · ${diff.text}` + skippedNote,
        slides: JSON.parse(JSON.stringify(after)),
        decisionId,
        slideCount: after.length,
        changedSlideIds,
        ...makeBranchMeta(),
      }
      setVersions(prev => [...prev, version])
      setCurrentVersionId(version.id)
      closeManualSession(after)

      if (presentationId) {
        persistDecision(presentationId, decision).catch(e =>
          console.warn('[persist] agent decision failed', e)
        )
        saveVersion(presentationId, version).catch(e =>
          console.warn('[persist] agent version failed', e)
        )
      }
    },
    [presentationId, makeBranchMeta, closeManualSession]
  )

  // ── Agentic editor loop: inspect → edit → render → verify, like Claude in PPT ────
  const runAgent = useCallback(
    async (
      instruction: string,
      opts?: { effort?: Effort; skipUserEcho?: boolean; checkpoint?: SlideData[]; historyLength?: number }
    ) => {
      // Re-entrancy guard: only block on the agent's OWN in-flight flag. Do NOT
      // gate on isLoading — handleSend briefly sets isLoading(true) while the
      // router classifies, and reading that (stale, via the ref closure) here made
      // every agent-routed message silently bail: the bubble never rendered and
      // nothing hit the server. isLoading is the single-shot/router indicator.
      if (isAgentRunning || !instruction.trim()) return
      if (!canEdit) return
      const effort: Effort = opts?.effort ?? 'medium'
      agentStopRef.current = false // reset cancellation flag for this run
      setIsAgentRunning(true)
      setPendingChanges(null)
      pushHistory()

      // Snapshot the deck before the run so we can version the net change on finish,
      // and track the latest apply summary / skipped count for the audit entry.
      const beforeRun = JSON.parse(JSON.stringify(slidesRef.current)) as SlideData[]
      let runSummary = ''
      let totalSkipped = 0

      // When callApi self-escalates, the user's message bubble is already shown.
      // Otherwise echo it WITH a checkpoint so it gets the same edit/revert button
      // as single-shot messages (Cursor-style: edit a past message → rewind here).
      if (!opts?.skipUserEcho) {
        setDisplay(prev => [
          ...prev,
          {
            role: 'user',
            text: instruction,
            ...(opts?.checkpoint ? { checkpoint: opts.checkpoint } : {}),
            ...(typeof opts?.historyLength === 'number' ? { historyLength: opts.historyLength } : {}),
          },
        ])
      }

      const deckSlides = slidesRef.current
      const selectedSet = new Set(selectedSlideIds)
      const slideIndex = deckSlides
        .map((s, i) => {
          const title =
            s.elements.find(e => e.type === 'text' && e.content?.trim())?.content?.slice(0, 40) ?? ''
          const sel = selectedSet.has(s.id) ? ' · ★SELECTED' : ''
          return `${i + 1}. ${s.id} · ${s.elements.length} elements${title ? ` · "${title}"` : ''}${sel}`
        })
        .join('\n')

      const activeIdx = deckSlides.findIndex(s => s.id === activeSlideId)
      const describeId = (id: string) => {
        const i = deckSlides.findIndex(s => s.id === id)
        return i >= 0 ? `slide ${i + 1} (${id})` : id
      }
      // Ground "these / selected / slide N" references: the model only ever sees
      // slide IDs in tool calls, but the user thinks in 1-based positions and in
      // terms of the current multi-selection.
      const selectionContext =
        selectedSlideIds.length > 0
          ? `The user currently has ${selectedSlideIds.length} slide(s) MULTI-SELECTED: ` +
            `${selectedSlideIds.map(describeId).join(', ')}.\n` +
            `If the instruction refers to "these/those slides", "the selected slides", "this slide", ` +
            `or otherwise omits explicit slide numbers, target EXACTLY these slide IDs — nothing else.\n`
          : `Active slide: ${describeId(activeSlideId)} (no multi-selection).\n`

      const knowledgeContext = buildKnowledgeContext(knowledgeLayers, decisions, activeSlideId, {
        instruction,
        slideText: activeSlideText(slidesRef.current, activeSlideId),
        // The agent builds decks FROM the uploaded source docs, so feed essentially
        // the whole document (tables/structure included) — a business plan can run
        // 100k+ chars and the agent needs all sections, not just the first half.
        // (Stored text is already capped at 200k in parseDocumentToText.)
        documentCharCap: 200000,
        documentTotalCap: 240000,
      })
      const templateKnowledge = mergeTemplatesKnowledge(templates)
      const mediaCtx = buildMediaContext(mediaManifest(collectAllAssets()))

      // Recent conversation so the agent can resolve follow-ups like "do that for
      // the whole deck" / "I asked you to…" — it previously saw ONLY the current
      // instruction and had to ask the user to repeat themselves.
      const recentTranscript = conversationHistory
        .slice(-8)
        .map(m => {
          if (m.role === 'user') return `User: ${m.content}`
          try {
            const r = JSON.parse(m.content)
            if (r?.type === 'patch') return `Assistant (proposed/applied): ${r.summary ?? ''}`
            if (r?.type === 'clarification') return `Assistant: ${r.question ?? ''}`
            if (r?.type === 'needs_agent') return `Assistant (handed to agent): ${r.reason ?? ''}`
            return ''
          } catch {
            return `Assistant: ${m.content}`
          }
        })
        .filter(Boolean)
        .join('\n')

      const intro =
        `User instruction: "${instruction}"\n\n` +
        (recentTranscript
          ? `RECENT CONVERSATION (context for follow-ups — if the current instruction refers to an ` +
            `earlier request like "I asked you to…", "do that across all slides", "the whole deck", ` +
            `resolve what "that" means from here and carry out the ORIGINAL intent across the requested scope):\n` +
            `${recentTranscript}\n\n`
          : '') +
        `Deck overview (NUMBER. id — the leading number is the slide's 1-based position):\n${slideIndex}\n\n` +
        `${selectionContext}` +
        `Active slide: ${describeId(activeSlideId)}${activeIdx >= 0 ? '' : ''}. ` +
        `Selected elements: ${selectedElementIds.join(', ') || 'none'}.\n` +
        `IMPORTANT: When the user says "slide N", N is the 1-based position above — map it to the ` +
        `matching slide ID before calling any tool. Never assume the ID's own number equals its position.\n` +
        (knowledgeContext
          ? `\nFollow this knowledge & design system as the source of truth:\n${knowledgeContext}\n`
          : '') +
        (mediaCtx ? `\n${mediaCtx}\n` : '') +
        (templateKnowledge ? `\nReference template styling:\n${templateKnowledge}\n` : '') +
        (isNewDeckBuildRequest(instruction) && !parsePresentationScope(instruction)
          ? `\n${formatScopeGateNote()}\n`
          : '') +
        ((() => {
          const scope = parsePresentationScope(instruction)
          return scope ? `\n${formatPresentationScopeNote(scope)}\n` : ''
        })()) +
        `\nIf the instruction covers MULTIPLE slides (e.g. "all slides", "slides 2–5", the selection, ` +
        `the whole deck), read them all with get_slides (omit slideIds for the whole deck), then apply ONE ` +
        `combined apply_changes covering every target slide, render 1–2 to verify, then finish. ` +
        `For a single slide use get_slide → apply_changes → verify → finish.`

      const messages: AgentMessage[] = [{ role: 'user', content: intro }]

      const deckBuild = isNewDeckBuildRequest(instruction)
      let presentationScope = parsePresentationScope(instruction)
      let scopeConfirmed = !!presentationScope
      let introCompressed = false

      const addStep = (step: NonNullable<DisplayMessage['agentStep']>) =>
        setDisplay(prev => [...prev, { role: 'assistant', agentStep: step }])

      // Bounded "act, don't hang" recovery: if a turn returns no tool call we
      // nudge the model to act instead of silently stopping.
      let nudges = 0
      const MAX_NUDGES = 2

      // ── Phase 5 guards: verification, cost ceiling, oscillation ──
      let appliedAny = false          // any apply_changes ran this run
      let verifiedSinceApply = false  // a render happened after the latest apply
      let verifyNudges = 0            // times we've forced a verify before finish
      const MAX_VERIFY_NUDGES = 1
      let applyCount = 0
      const MAX_APPLIES = 8           // hard ceiling on edits per run (cost guard)
      const applySignatures: string[] = []
      let stopFlag: string | null = null  // set to abort the loop after this turn
      let hitStepLimit = false        // ran out of steps before calling finish

      try {
        for (let step = 0; step < AGENT_MAX_STEPS; step++) {
          // Cancellation check at the top of each step (covers a Stop pressed
          // between turns, before the next request goes out).
          if (agentStopRef.current) {
            addStep({ kind: 'note', label: 'Stopped by user. Changes so far are kept.' })
            break
          }
          const ac = new AbortController()
          agentAbortRef.current = ac
          const res = await fetch('/api/edit/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages, effort }),
            signal: ac.signal,
          })
          if (!res.ok) {
            let msg = `Agent request failed (HTTP ${res.status})`
            try {
              const errData = await res.json()
              if (errData?.error) msg = errData.error
            } catch {
              /* non-JSON error body — keep the generic message */
            }
            addStep({ kind: 'error', label: msg })
            break
          }
          const data = await res.json()
          const content = (data.content ?? []) as AgentBlock[]
          const stopReason = data.stop_reason as string | undefined
          messages.push({ role: 'assistant', content })

          const toolResults: AgentToolResult[] = []
          let finished = false
          // Set when the agent calls ask_user: we render structured questions and
          // pause the run until the user answers (which resumes a fresh agent turn).
          let askPayload: { intro?: string; questions: ClarificationQuestion[] } | null = null

          for (const block of content) {
            if (block.type === 'thinking') {
              if (block.thinking?.trim()) addStep({ kind: 'thinking', label: block.thinking.trim() })
              continue
            }
            if (block.type === 'redacted_thinking') continue
            if (block.type === 'text') {
              if (block.text?.trim()) addStep({ kind: 'note', label: block.text.trim() })
              continue
            }
            if (block.type !== 'tool_use') continue

            const { id, name, input } = block
            if (name === 'finish') {
              // Verification gate: don't let the agent declare done after editing
              // without ever rendering an edited slide to confirm the result.
              if (appliedAny && !verifiedSinceApply && verifyNudges < MAX_VERIFY_NUDGES) {
                verifyNudges++
                addStep({
                  kind: 'note',
                  label: 'Applied edits but no verification render yet — asking the agent to render before finishing.',
                })
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    'Do NOT finish yet: you applied changes but have not rendered any edited slide to confirm the result. Call render_slide on one changed slide, verify it looks right, then finish.',
                })
              } else {
                finished = true
                if (input?.summary) runSummary = input.summary
                addStep({ kind: 'done', label: input?.summary || 'Done.' })
              }
            } else if (name === 'ask_user') {
              // Pause the loop and surface structured questions to the user. We end
              // this run (changes so far are kept) and resume once they answer.
              const questions = Array.isArray(input?.questions) ? input!.questions! : []
              if (questions.length > 0) {
                askPayload = { intro: input?.intro, questions }
                addStep({ kind: 'done', label: 'Paused — waiting for your answers.' })
              } else {
                // Malformed call with no questions: nudge it to either act or ask properly.
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    'ask_user needs a non-empty questions[] array. Either ask with real questions, or just build the deck from the context.',
                  is_error: true,
                })
              }
            } else if (name === 'get_slide') {
              const slide = slidesRef.current.find(s => s.id === input?.slideId)
              addStep({ kind: 'read', label: `Inspected ${input?.slideId}` })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: slide
                  ? JSON.stringify({ id: slide.id, bg: slide.bg, elements: slide.elements })
                  : `Slide ${input?.slideId} not found. Available: ${slidesRef.current
                      .map(s => s.id)
                      .join(', ')}`,
                ...(slide ? {} : { is_error: true }),
              })
            } else if (name === 'get_slides') {
              const requested = Array.isArray(input?.slideIds) ? (input!.slideIds as string[]) : null
              const picked = requested
                ? slidesRef.current.filter(s => requested.includes(s.id))
                : slidesRef.current
              addStep({
                kind: 'read',
                label: requested
                  ? `Inspected ${picked.length} slide(s): ${picked.map(s => s.id).join(', ')}`
                  : `Inspected all ${picked.length} slides`,
              })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: JSON.stringify(
                  picked.map(s => ({ id: s.id, bg: s.bg, elements: s.elements }))
                ),
              })
            } else if (name === 'render_slide') {
              const slide = slidesRef.current.find(s => s.id === input?.slideId)
              const png = slide ? await renderSlideToPng(slide) : null
              // A render after an edit counts as verification (satisfies the gate).
              if (appliedAny) verifiedSinceApply = true
              addStep({ kind: 'render', label: `Rendered ${input?.slideId}`, image: png ?? undefined })
              if (png) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content: [
                    {
                      type: 'image',
                      source: { type: 'base64', media_type: 'image/png', data: png.split(',')[1] },
                    },
                    { type: 'text', text: `Current rendering of ${input?.slideId}.` },
                  ],
                })
              } else {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content: `Could not render ${input?.slideId}.`,
                  is_error: true,
                })
              }
            } else if (name === 'apply_changes') {
              // A max_tokens cutoff truncates the tool-call JSON, so `changes`
              // arrives empty/partial and nothing can be applied. Detect that and
              // tell the model to resend in smaller batches instead of looping.
              const rawChanges = input?.changes
              if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
                const cutOff = stopReason === 'max_tokens'
                addStep({
                  kind: 'note',
                  label: cutOff
                    ? 'apply_changes was cut off (too large) — asking the agent to send smaller batches.'
                    : 'apply_changes had no changes — asking the agent to provide them.',
                })
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content: cutOff
                    ? 'Your apply_changes was too large and got cut off before completing, so NOTHING was applied. Resend it in SMALLER batches: add at most 1–2 slides (with their elements) per apply_changes call, then continue in the next turn.'
                    : 'apply_changes contained no changes. Provide a non-empty changes[] array.',
                  is_error: true,
                })
                continue
              }
              const changes = resolveAssetRefs(
                rawChanges as Change[],
                collectAllAssets()
              )

              if (deckBuild && changesAddSlides(changes) && !scopeConfirmed) {
                addStep({
                  kind: 'note',
                  label: 'Blocked slide creation — choose Light / Medium / In-depth first.',
                })
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    'You must call ask_user FIRST with question id "presentation_depth" (Light ≤5 / Medium ≤10 / In-depth ≤15 slides) before adding slides. Nothing was applied.',
                  is_error: true,
                })
                continue
              }

              const slideLimit = effectiveSlideLimit(presentationScope)
              const projected = projectDeckSlideCount(slidesRef.current, changes)
              if (projected > slideLimit) {
                addStep({
                  kind: 'note',
                  label: `Blocked — would exceed the ${slideLimit}-slide limit (${projected} total).`,
                })
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    `This patch would bring the deck to ${projected} slides, exceeding the limit of ${slideLimit}` +
                    (presentationScope ? ` (${presentationScope} scope)` : '') +
                    `. Nothing was applied. Add at most ${Math.max(0, slideLimit - slidesRef.current.length)} more slide(s), or finish.`,
                  is_error: true,
                })
                continue
              }

              // Cost ceiling + oscillation guard: count edits and detect an
              // identical patch being re-applied (a sign the agent is looping).
              applyCount++
              const signature = JSON.stringify(changes)
              const repeats = applySignatures.filter(s => s === signature).length
              applySignatures.push(signature)
              appliedAny = true
              verifiedSinceApply = false
              if (repeats >= 1) {
                stopFlag =
                  'Stopped: the agent re-applied an identical edit (likely looping). Changes so far are kept.'
              } else if (applyCount > MAX_APPLIES) {
                stopFlag = `Stopped: reached the ${MAX_APPLIES}-edit ceiling for one run. Changes so far are kept.`
              }
              const report = analyzeChanges(slidesRef.current, changes)
              const before = slidesRef.current
              const next = applyChangesToSlides(before, changes)
              slidesRef.current = next
              setSlides(next)
              // Programmatic geometry check (mirrors a designer measuring for
              // overflow): surface only the issues THIS edit introduced so the
              // model can self-correct without re-rendering every slide.
              const { newIssues } = reviewLayoutChange(before, next)
              const sum = input?.summary || `${report.willApply} change(s)`
              runSummary = sum
              totalSkipped += report.skipped
              addStep({
                kind: 'apply',
                label: `Applied ${report.willApply}/${report.total}: ${sum}${
                  newIssues.length ? ` · ${newIssues.length} layout issue(s)` : ''
                }`,
              })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: `Applied ${report.willApply} of ${report.total} change(s)${
                  report.skipped
                    ? ` (${report.skipped} skipped — verify those element ids actually exist on the slide)`
                    : ''
                }.${
                  newIssues.length
                    ? `\n\nLAYOUT CHECK — this edit introduced ${newIssues.length} geometry issue(s) (slide is 10×7.5in); fix them before finishing:\n${formatLayoutIssues(
                        newIssues
                      )}`
                    : '\n\nLAYOUT CHECK — no new overflow/overlap detected.'
                } Re-render the slide to verify the result visually.`,
              })
            } else {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: `Unknown tool: ${name}`,
                is_error: true,
              })
            }
          }

          if (finished) break

          // Agent asked the user structured questions → render them and pause the
          // run. The user's answers resume a fresh agent turn (handleSubmitAnswers).
          if (askPayload) {
            const payload = askPayload
            setDisplay(prev => [
              ...prev,
              {
                role: 'assistant',
                response: {
                  type: 'clarification',
                  question: payload.intro ?? '',
                  questions: payload.questions,
                },
              },
            ])
            setPendingAgentInstruction(instruction)
            // Record what was asked so the resumed run has continuity.
            const asked = payload.questions.map(q => q.question).filter(Boolean).join(' | ')
            runSummary =
              `[asked the user]${payload.intro ? ` ${payload.intro}` : ''}${asked ? ` — ${asked}` : ''}`.trim()
            break
          }

          // Cost/oscillation abort — surface why and stop (changes already applied).
          if (stopFlag) {
            addStep({ kind: 'error', label: stopFlag })
            break
          }

          // No actionable tool call this turn — the model either ran out of token
          // budget mid-thought (stop_reason "max_tokens") or narrated without
          // acting. Instead of hanging silently, tell the user and nudge it to act.
          if (toolResults.length === 0) {
            if (nudges < MAX_NUDGES) {
              nudges++
              const why =
                stopReason === 'max_tokens'
                  ? 'hit its token budget before acting'
                  : 'replied without calling a tool'
              addStep({ kind: 'note', label: `Agent ${why} — nudging it to continue…` })
              // Drop this turn's thinking blocks (only required alongside a
              // tool_use, which this turn lacks) so an incomplete/unsigned
              // thinking block from a max_tokens cutoff can't break the next call.
              const textOnly = content
                .filter((b): b is Extract<AgentBlock, { type: 'text' }> => b.type === 'text' && !!b.text?.trim())
                .map(b => ({ type: 'text' as const, text: b.text as string }))
              messages[messages.length - 1] = {
                role: 'assistant',
                content: textOnly.length ? textOnly : [{ type: 'text', text: '(continuing)' }],
              }
              messages.push({
                role: 'user',
                content:
                  'You did not call a tool. Do NOT explain or plan in prose — call the next tool NOW ' +
                  '(get_slides, apply_changes, render_slide, or finish) and keep any text to one short sentence.',
              })
              continue
            }
            addStep({
              kind: 'error',
              label:
                'Agent stopped without finishing (no tool call). Any changes so far are applied — try resending with a more specific, smaller-scope instruction.',
            })
            break
          }

          messages.push({ role: 'user', content: toolResults })

          // Drop heavy knowledge/template/media from the intro after step 1 — they
          // were available on the first turn and must not be re-sent every step.
          if (!introCompressed && step === 0) {
            introCompressed = true
            const parsedScope = parsePresentationScope(instruction)
            if (parsedScope) presentationScope = parsedScope
            const first = messages[0]
            if (first?.role === 'user' && typeof first.content === 'string') {
              messages[0] = {
                role: 'user',
                content: compressAgentIntro(first.content, instruction, {
                  scopeNote: presentationScope
                    ? formatPresentationScopeNote(presentationScope)
                    : undefined,
                }),
              }
            }
          }

          if (step === AGENT_MAX_STEPS - 1) {
            hitStepLimit = true
            addStep({
              kind: 'error',
              label: `Reached the ${AGENT_MAX_STEPS}-step limit before finishing — changes so far are applied. Say "continue" to finish the rest.`,
            })
          }
        }
      } catch (err) {
        // A user-triggered abort surfaces here as an AbortError — that's expected,
        // not a failure. Report it as a clean stop; anything else is a real error.
        const aborted =
          agentStopRef.current ||
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err as { name?: string })?.name === 'AbortError'
        if (aborted) {
          addStep({ kind: 'note', label: 'Stopped by user. Changes so far are kept.' })
        } else {
          console.error('[agent] loop error', err)
          addStep({ kind: 'error', label: 'Agent loop error — see console for details.' })
        }
      } finally {
        agentAbortRef.current = null
        agentStopRef.current = false
        setCaptureSlide(null)
        setIsAgentRunning(false)
        // Version + audit the net change, even on partial completion / error so a
        // half-finished run is still rollback-able. No-op when nothing changed.
        recordAgentRun(
          beforeRun,
          slidesRef.current,
          instruction,
          runSummary,
          totalSkipped ? ` (${totalSkipped} change(s) skipped)` : ''
        )
        // Reconcile React state with the ref source-of-truth in case any path
        // updated one without the other during the loop.
        setSlides(slidesRef.current)
        // Record the agent's outcome in history so future turns have continuity
        // (the transcript builder surfaces this to the next agent run). When the run
        // was cut off at the step limit, flag it as INCOMPLETE so a later "continue"
        // re-reads the slide and finishes the remaining work instead of starting over.
        const outcome = hitStepLimit
          ? `[INCOMPLETE — stopped at the ${AGENT_MAX_STEPS}-step limit before finishing.${
              runSummary ? ` Applied so far: ${runSummary}.` : ''
            } Remaining work on the original request is NOT done yet. If the user says "continue", re-read the target slide(s) with get_slide, see what is already there, and finish ONLY the outstanding parts.]`
          : runSummary
        if (outcome) {
          setConversationHistory(prev => [
            ...prev,
            { role: 'assistant', content: JSON.stringify({ type: 'clarification', question: outcome }) },
          ])
        }
      }
    },
    [
      isAgentRunning,
      isLoading,
      pushHistory,
      activeSlideId,
      selectedElementIds,
      selectedSlideIds,
      renderSlideToPng,
      knowledgeLayers,
      decisions,
      templates,
      designSystem,
      collectAllAssets,
      recordAgentRun,
      conversationHistory,
      canEdit,
    ]
  )

  // Expose runAgent through a ref so callApi can self-escalate without a forward cycle.
  useEffect(() => {
    runAgentRef.current = runAgent
  }, [runAgent])

  // Cancel an in-flight agent run: set the loop's stop flag AND abort the current
  // network request so it stops promptly (between or during a turn).
  const stopAgent = useCallback(() => {
    if (!isAgentRunning) return
    agentStopRef.current = true
    agentAbortRef.current?.abort()
  }, [isAgentRunning])

  // Stop whatever is generating right now — the agent loop OR a single-shot
  // request — so the composer's Stop button works regardless of the active flow.
  const stopProcessing = useCallback(() => {
    if (isAgentRunning) {
      agentStopRef.current = true
      agentAbortRef.current?.abort()
    }
    singleShotAbortRef.current?.abort()
  }, [isAgentRunning])

  // Programmatic stop hook for testing / power users (e.g. preview console):
  // window.__stopAgent(). Harmless in prod; just a manual escape hatch.
  useEffect(() => {
    ;(window as unknown as { __stopAgent?: () => void }).__stopAgent = stopAgent
    return () => {
      delete (window as unknown as { __stopAgent?: () => void }).__stopAgent
    }
  }, [stopAgent])

  // Revert to the state BEFORE a message, FORKING a new branch from that point.
  // The prior timeline is preserved (its versions stay under their original branch);
  // a new branch starts at the restored checkpoint so the work splits into two.
  const revertToMessage = useCallback(
    (displayIndex: number) => {
      const target = display[displayIndex]
      if (!target?.checkpoint) return
      const confirmed = window.confirm(
        'Revert to before this message and start a NEW BRANCH from here?\n\n' +
          'Your current timeline is kept as a branch in Version Control; new edits continue on a fresh branch.'
      )
      if (!confirmed) return

      const checkpoint = JSON.parse(JSON.stringify(target.checkpoint)) as SlideData[]

      // Snapshot current state for one-step undo, then restore the pre-message deck.
      pushHistory()
      setSlides(checkpoint)

      // Create the new branch and seed it with a root version (the checkpoint) so
      // Version Control shows it as a distinct line starting at the fork point.
      const newBranchId = crypto.randomUUID()
      const existingCount = Object.keys(branchNamesRef.current).length
      const newBranchName = `Branch ${existingCount}`
      const forkedFrom = makeBranchMeta().parentVersionId // latest version on the OLD branch
      setBranchNames(prev => ({ ...prev, [newBranchId]: newBranchName }))

      const rootVersion: SlideVersion = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        label: null,
        changeLog: `Branched from “${(target.text ?? 'message').slice(0, 60)}”`,
        slides: checkpoint,
        decisionId: null,
        slideCount: checkpoint.length,
        changedSlideIds: [],
        branchId: newBranchId,
        branchLabel: newBranchName,
        parentVersionId: forkedFrom,
        isBranchRoot: true,
      }
      setVersions(prev => [...prev, rootVersion])
      setCurrentVersionId(rootVersion.id)
      setCurrentBranchId(newBranchId)
      closeManualSession(checkpoint)
      if (presentationId) {
        saveVersion(presentationId, rootVersion).catch(e =>
          console.warn('[persist] branch root failed', e)
        )
      }

      // Fork the chat too: rewind to before this message so the next instruction
      // builds the new branch. (The old branch's snapshots remain in Version Control.)
      setDisplay(prev => prev.slice(0, displayIndex))
      if (typeof target.historyLength === 'number') {
        setConversationHistory(prev => prev.slice(0, target.historyLength))
      }

      setPendingChanges(null)
      setPendingSummary('')
      setPendingDecisionId(null)
      setHighlightDiffOnCanvas(false)
      setEditingElementId(null)
      setSelectedElementIds([])

      // Load the message text back into the input for editing/resubmitting.
      setChatDraft({ text: target.text ?? '', nonce: Date.now() })
    },
    [display, slides, presentationId, makeBranchMeta, closeManualSession]
  )

  // Switch the active branch: restore the deck to that branch's latest snapshot and
  // make subsequent edits land on it. (Chat history is left as-is.)
  const switchBranch = useCallback(
    (branchId: string) => {
      const onBranch = versions.filter(v => (v.branchId ?? MAIN_BRANCH_ID) === branchId)
      if (onBranch.length === 0) return
      const latest = onBranch[onBranch.length - 1]
      pushHistory()
      const branchSlides = JSON.parse(JSON.stringify(latest.slides)) as SlideData[]
      setSlides(branchSlides)
      setCurrentBranchId(branchId)
      setCurrentVersionId(latest.id)
      closeManualSession(branchSlides)
      setPendingChanges(null)
      setPendingSummary('')
      setEditingElementId(null)
      setSelectedElementIds([])
      const nextActive =
        latest.slides.find(s => s.id === activeSlideId)?.id ?? latest.slides[0]?.id
      if (nextActive) {
        setActiveSlideId(nextActive)
        setSelectedSlideIds([nextActive])
        setSelectionAnchorId(nextActive)
      }
    },
    [versions, activeSlideId, pushHistory, closeManualSession]
  )

  // Distinct branches present in the version timeline (Main always first).
  const versionBranches = useMemo<VersionBranch[]>(() => {
    const map = new Map<string, VersionBranch>()
    map.set(MAIN_BRANCH_ID, {
      id: MAIN_BRANCH_ID,
      name: branchNames[MAIN_BRANCH_ID] ?? 'Main',
      createdAt: 0,
      forkedFromVersionId: null,
    })
    for (const v of versions) {
      const id = v.branchId ?? MAIN_BRANCH_ID
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: v.branchLabel ?? branchNames[id] ?? 'Branch',
          createdAt: v.timestamp,
          forkedFromVersionId: v.isBranchRoot ? v.parentVersionId ?? null : null,
        })
      }
    }
    return Array.from(map.values())
  }, [versions, branchNames])

  const handlePickOption = useCallback(
    (option: ClarificationOption) => {
      // Scope disambiguation answer → re-issue the original instruction with an
      // explicit scope suffix (which the classifier/scope resolver then honor).
      if (pendingScopeInstruction && (option.id === 'scope-active' || option.id === 'scope-deck')) {
        const instr = pendingScopeInstruction
        setPendingScopeInstruction(null)
        const scoped =
          option.id === 'scope-deck'
            ? `${instr} — apply this across the whole presentation (every slide).`
            : `${instr} — only on the current slide.`
        handleSend(scoped)
        return
      }
      const text = `Option ${option.id}: ${option.label}`
      handleSend(text)
    },
    [handleSend, pendingScopeInstruction]
  )

  // Answers to a structured clarification. If the agent paused on ask_user, resume
  // it with the answers; otherwise (single-shot clarification) send them normally.
  const handleSubmitAnswers = useCallback(
    (text: string) => {
      if (pendingAgentInstruction) {
        const orig = pendingAgentInstruction
        setPendingAgentInstruction(null)
        setDisplay(prev => [...prev, { role: 'user', text }])
        const scope = parsePresentationScope(text)
        const scopeHint = scope ? `\n${formatPresentationScopeNote(scope)}\n` : ''
        runAgentRef.current?.(
          `${orig}\n\n[Earlier you paused to ask me clarifying questions. My answers:]\n${text}${scopeHint}\n\nNow proceed and build exactly that — do not ask again.`,
          { skipUserEcho: true }
        )
        return
      }
      handleSend(text)
    },
    [handleSend, pendingAgentInstruction]
  )

  // ── Apply patch to slides ────────────────────────────────────────────────────
  const applyChanges = useCallback(() => {
    if (!pendingChanges) return
    if (!canEdit) return
    const newSlides = applyChangesToSlides(slides, pendingChanges)
    const changedIds = diffSlideIds(slides, newSlides)

    console.groupCollapsed(
      `%c[edit] applied changes · ${changedIds.length} slide(s) changed`,
      'color:#4ade80;font-weight:bold'
    )
    console.log('proposed changes:', pendingChanges)
    console.log('slides actually changed:', changedIds)
    if (pendingChanges.length > 0 && changedIds.length === 0) {
      console.warn(
        '[edit] Apply produced NO change to any slide — the patch parsed but had no effect (e.g. unknown ids or unrecognized fields).'
      )
    }
    console.groupEnd()

    const versionId = crypto.randomUUID()
    const diff = summarizeDeckChanges(slides, newSlides)
    const version: SlideVersion = {
      id: versionId,
      timestamp: Date.now(),
      label: null,
      changeLog: `${pendingSummary || 'Changes applied'} · ${diff.text}`,
      slides: JSON.parse(JSON.stringify(newSlides)),
      decisionId: pendingDecisionId,
      slideCount: newSlides.length,
      changedSlideIds: changedIds,
      ...makeBranchMeta(),
    }
    setVersions(prev => [...prev, version])
    setCurrentVersionId(version.id)

    if (pendingDecisionId) {
      setDecisions(prev => prev.map(d =>
        d.id === pendingDecisionId ? { ...d, status: 'accepted' } : d
      ))
      // Stable id → PATCH always targets the right row.
      setDecisionStatus(pendingDecisionId, 'accepted').catch(e =>
        console.warn('[persist] decision accept failed', e)
      )
      setPendingDecisionId(null)
    }

    pushHistory()
    setSlides(newSlides)
    closeManualSession(newSlides)

    if (!newSlides.some(s => s.id === activeSlideId)) {
      const nextActive = newSlides[0]?.id
      if (nextActive) {
        setActiveSlideId(nextActive)
        setSelectedSlideIds([nextActive])
        setSelectionAnchorId(nextActive)
      }
    } else {
      setSelectedSlideIds(prev => prev.filter(id => newSlides.some(s => s.id === id)))
    }

    setPendingChanges(null)
    setPendingSummary('')
    setRefineNote(null)
    setHighlightDiffOnCanvas(false)
    setIsPreviewOpen(false)
    setSelectedElementIds([])
    setEditingElementId(null)

    if (presentationId) {
      // Stable client id is sent through; no post-hoc id swap needed.
      saveVersion(presentationId, version).catch(e =>
        console.warn('[persist] version save failed', e)
      )
    }

    const doneResponse: ClaudeResponse = {
      type: 'clarification',
      question: 'Done ✓  What would you like to change next?',
    }
    const confirmMsg: ConversationMessage = { role: 'user', content: 'Changes applied.' }
    const assistantMsg: ConversationMessage = {
      role: 'assistant',
      content: JSON.stringify(doneResponse),
    }
    setConversationHistory(h => [...h, confirmMsg, assistantMsg])
    setDisplay(prev => [
      ...prev.map(m =>
        m.patchStatus === 'pending' ? { ...m, patchStatus: 'approved' as const } : m
      ),
      { role: 'user', text: confirmMsg.content },
      { role: 'assistant', response: doneResponse },
    ])
  }, [pendingChanges, pendingSummary, pendingDecisionId, slides, presentationId, activeSlideId, makeBranchMeta, closeManualSession, canEdit])

  // ── Discard patch ─────────────────────────────────────────────────────────────
  const discardChanges = useCallback((reason?: string) => {
    // Guard: this is sometimes wired directly to an onClick, which would pass a
    // MouseEvent as `reason`. Only treat genuine strings as a rejection reason.
    const rejectionReason = typeof reason === 'string' ? reason.trim() || undefined : undefined
    setPendingChanges(null)
    setPendingSummary('')
    setRefineNote(null)
    setHighlightDiffOnCanvas(false)
    setIsPreviewOpen(false)
    setDisplay(prev =>
      prev.map(m => (m.patchStatus === 'pending' ? { ...m, patchStatus: 'declined' as const } : m))
    )
    if (pendingDecisionId) {
      setDecisions(prev => prev.map(d =>
        d.id === pendingDecisionId ? { ...d, status: 'rejected', rejectionReason } : d
      ))
      // Persist status + reason together so the memory is scoped, not a blanket ban.
      setDecisionStatus(pendingDecisionId, 'rejected', rejectionReason ?? '').catch(e =>
        console.warn('[persist] decision reject failed', e)
      )
      setPendingDecisionId(null)
    }
  }, [pendingDecisionId])

  // ── Undo last action (incremental, step-by-step like PowerPoint) ──────────────
  const revert = useCallback(() => {
    if (slideHistory.length === 0) return
    const prev = slideHistory[slideHistory.length - 1]
    setSlides(JSON.parse(JSON.stringify(prev)) as SlideData[])
    setSlideHistory(h => h.slice(0, -1))
    setPendingChanges(null)
    setPendingSummary('')
    setEditingElementId(null)
  }, [slideHistory])

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Delete/Backspace = delete selected
  // elements. Both ignored while typing in a field or editing element text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        if (inField) return
        e.preventDefault()
        revert()
        return
      }

      // Copy / cut / paste elements across slides (PowerPoint-style).
      if ((e.ctrlKey || e.metaKey) && !inField && !editingElementId) {
        const k = e.key.toLowerCase()
        if (k === 'c' && selectedElementIds.length > 0) {
          e.preventDefault()
          copySelectedElements()
          return
        }
        if (k === 'x' && selectedElementIds.length > 0 && !pendingChanges) {
          e.preventDefault()
          cutSelectedElements()
          return
        }
        if (k === 'v' && clipboardElements.length > 0 && !pendingChanges) {
          e.preventDefault()
          pasteElements()
          return
        }
      }

      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !inField &&
        !editingElementId &&
        selectedElementIds.length > 0 &&
        !pendingChanges
      ) {
        e.preventDefault()
        deleteSelectedElements()
        return
      }

      // Arrow keys nudge selected element(s). Shift = larger, Ctrl/Cmd = 1px.
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      if (
        arrows[e.key] &&
        !inField &&
        !editingElementId &&
        selectedElementIds.length > 0 &&
        !pendingChanges
      ) {
        e.preventDefault()
        // Match PowerPoint: Ctrl/Cmd (or Alt) + Arrow = exactly 1px fine nudge.
        // 96px = 1 inch on the canvas, so 1/96in == 1 device-independent px.
        const fine = e.ctrlKey || e.metaKey || e.altKey
        const step = e.shiftKey ? 0.5 : fine ? 1 / 96 : 0.1
        const [sx, sy] = arrows[e.key]
        nudgeSelectedElements(sx * step, sy * step)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    revert,
    deleteSelectedElements,
    nudgeSelectedElements,
    copySelectedElements,
    cutSelectedElements,
    pasteElements,
    clipboardElements,
    editingElementId,
    selectedElementIds,
    pendingChanges,
  ])

  // ── Refine the pending proposal in place (preview-only follow-up) ─────────────
  const refineProposal = useCallback(
    async (text: string) => {
      if (!pendingChanges || isRefining) return
      setIsRefining(true)
      setRefineNote(null)
      try {
        const changedIds = Array.from(new Set(pendingChanges.map(c => c.slideId)))
        const baseSlides = slides.filter(s => changedIds.includes(s.id))
        const proposed = applyChangesToSlides(slides, pendingChanges).filter(s =>
          changedIds.includes(s.id)
        )
        const refineScopeMode: ScopeMode = baseSlides.length > 1 ? 'multi' : 'active'

        const refineInstruction = `REFINE THE PENDING PROPOSAL (shown in the preview, NOT yet applied).

CURRENT PENDING PROPOSAL SUMMARY: ${pendingSummary}

PROPOSED RESULT (what the user currently sees in the preview, i.e. the slide data AFTER the pending changes):
${JSON.stringify(proposed, null, 2)}

USER ADJUSTMENT TO THE PROPOSAL: ${text}

Return ONE complete "patch" (changes relative to the ORIGINAL slide data provided in scope) that reproduces the PROPOSED RESULT above WITH this adjustment incorporated. Re-state every element the proposal touches PLUS the adjustment so the patch is complete and self-contained. Keep element IDs stable. Do not introduce unrelated changes.`

        const requestHistory: ConversationMessage[] = [
          ...conversationHistory,
          { role: 'user', content: refineInstruction },
        ]
        const cleanText = `Adjust preview: ${text}`
        setDisplay(prev => [...prev, { role: 'user', text: cleanText }])

        const res = await fetch('/api/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: requestHistory,
            selectedElementIds,
            selectedSlideIds,
            scopeSlides: baseSlides,
            scopeMode: refineScopeMode,
            allSlides: slides,
            templateKnowledge: mergeTemplatesKnowledge(templates) || null,
            knowledgeContext: buildKnowledgeContext(knowledgeLayers, decisions, activeSlideId, {
              instruction: text,
              slideText: activeSlideText(slides, activeSlideId),
            }),
            annotatedImage: null,
            attachedImages: [],
            mediaManifest: mediaManifest(collectAllAssets()),
          }),
        })

        if (!res.ok) {
          console.error('[refine] /api/edit failed with HTTP', res.status)
          const errResp: ClaudeResponse = {
            type: 'clarification',
            question: `Refine request failed (HTTP ${res.status}). Please try again.`,
          }
          setConversationHistory(prev => [
            ...prev,
            { role: 'user', content: cleanText },
            { role: 'assistant', content: JSON.stringify(errResp) },
          ])
          setDisplay(prev => [...prev, { role: 'assistant', response: errResp }])
          return
        }

        const data: ClaudeResponse = await res.json()

        if (data.type === 'patch') {
          data.changes = resolveAssetRefs(data.changes, collectAllAssets())
        }

        console.groupCollapsed(
          `%c[refine] response · ${data.type} · http ${res.status}`,
          'color:#4ade80;font-weight:bold'
        )
        console.log('adjustment:', text)
        console.log('proposed base sent to AI:', proposed)
        console.log('raw response:', data)
        if (data.type === 'patch') {
          const report = analyzeChanges(slides, data.changes)
          console.log(
            `diagnostics — ${report.willApply}/${report.total} will apply (${report.skipped} skipped):`
          )
          console.log(formatChangeReport(report))
          if (report.total > 0 && report.willApply === 0) {
            console.warn('[refine] refined patch will NOT apply — check notes above.')
          }
        } else {
          console.log('clarification:', data.type === 'clarification' ? data.question : data.reason)
        }
        console.groupEnd()

        // Persist a clean (non-verbose) record of the turn.
        setConversationHistory(prev => [
          ...prev,
          { role: 'user', content: cleanText },
          { role: 'assistant', content: JSON.stringify(data) },
        ])
        // Refine updates the live proposal in place — the existing chat widget and
        // preview overlay read pendingChanges/pendingSummary, so no new bubble.

        if (data.type === 'patch') {
          setPendingChanges(data.changes)
          setPendingSummary(data.summary)
          setHighlightDiffOnCanvas(false)
          if (pendingDecisionId) {
            setDecisions(prev =>
              prev.map(d =>
                d.id === pendingDecisionId
                  ? { ...d, proposedChanges: data.changes, proposedSummary: data.summary }
                  : d
              )
            )
          }
          const ids = Array.from(new Set(data.changes.map(c => c.slideId)))
          if (ids.length > 0 && !ids.includes(activeSlideId)) {
            setActiveSlideId(ids[0])
            setSelectedSlideIds([ids[0]])
            setSelectionAnchorId(ids[0])
          }
          setRefineNote('✓ Preview updated with your adjustment.')
        } else {
          // Clarification — surface the question right in the preview panel.
          setRefineNote(data.type === 'clarification' ? data.question : data.reason)
        }
      } catch (err) {
        console.error('[refine] failed', err)
        setRefineNote('Refine failed — please try again.')
      } finally {
        setIsRefining(false)
      }
    },
    [
      pendingChanges,
      pendingSummary,
      pendingDecisionId,
      isRefining,
      slides,
      conversationHistory,
      selectedElementIds,
      selectedSlideIds,
      templates,
      knowledgeLayers,
      decisions,
      activeSlideId,
      designSystem,
      collectAllAssets,
    ]
  )

  // ── Restore a version (move the CURRENT pointer, no new snapshot) ─────────────
  // Restoring does NOT create a new version. It rolls the deck back to the chosen
  // snapshot and marks it as "current" — the latest version stays the latest. The
  // panel shows an amber "viewing v1 · latest is v2" remark. One-step undo (Revert
  // button) still works because we push the prior deck onto the local history.
  const restoreVersion = useCallback((v: SlideVersion) => {
    const restoredSlides = JSON.parse(JSON.stringify(v.slides)) as SlideData[]
    pushHistory()
    setSlides(restoredSlides)
    setCurrentVersionId(v.id)
    setCurrentBranchId(v.branchId ?? MAIN_BRANCH_ID)
    closeManualSession(restoredSlides)
    setPendingChanges(null)
    setPendingSummary('')
    setEditingElementId(null)
    setSelectedElementIds([])

    const nextActive =
      restoredSlides.find(s => s.id === activeSlideId)?.id ?? restoredSlides[0]?.id
    if (nextActive) {
      setActiveSlideId(nextActive)
      setSelectedSlideIds([nextActive])
      setSelectionAnchorId(nextActive)
    }
  }, [activeSlideId, pushHistory, closeManualSession])

  // ── Restore single slide from a version ───────────────────────────────────────
  const restoreSlide = useCallback((slideId: string, fromVersion: SlideVersion) => {
    const slideSnapshot = fromVersion.slides.find(s => s.id === slideId)
    if (!slideSnapshot) return
    setSlides(prev => prev.map(s => s.id === slideId ? JSON.parse(JSON.stringify(slideSnapshot)) : s))
    setPendingChanges(null)
  }, [])

  // ── Name a version milestone ──────────────────────────────────────────────────
  const nameVersion = useCallback((id: string, label: string) => {
    setVersions(prev => prev.map(v => v.id === id ? { ...v, label: label.trim() || null } : v))
    // Persist label
    fetch('/api/versions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, label: label.trim() || null }),
    }).catch(() => {})
  }, [])

  // ── Knowledge layer changes ───────────────────────────────────────────────────
  const handleKnowledgeChange = useCallback(async (newLayers: KnowledgeLayer[]) => {
    const prev = knowledgeLayers
    setKnowledgeLayers(newLayers)

    // Find added layers (no DB id format — they start with 'kl-' or similar local ids)
    for (const layer of newLayers) {
      const wasPresent = prev.find(p => p.id === layer.id)
      if (!wasPresent) {
        // New layer — POST to DB (scoped to the active knowledge branch)
        const res = await fetch('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...layer, branchId: activeBranchIdRef.current }),
        })
        if (res.ok) {
          const saved = await res.json()
          setKnowledgeLayers(current => current.map(l => l.id === layer.id ? { ...l, id: saved.id } : l))
        }
      } else {
        // Potentially updated layer
        const changed =
          wasPresent.content !== layer.content ||
          wasPresent.enabled !== layer.enabled ||
          wasPresent.name !== layer.name
        if (changed) {
          fetch('/api/knowledge', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(layer),
          }).catch(() => {})
        }
      }
    }

    // Find deleted layers
    for (const p of prev) {
      if (!newLayers.find(l => l.id === p.id)) {
        fetch('/api/knowledge', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.id }),
        }).catch(() => {})
      }
    }
  }, [knowledgeLayers])

  // ── Design system changes ─────────────────────────────────────────────────────
  const handleDesignSystemChange = useCallback(
    (ds: DesignSystem) => {
      designSystemRef.current = ds
      setDsName(ds.name)
      setDsFiles(ds.files)
      // Make it reactive (drives the design tools) and feed it to the AI context
      // automatically — no need to close the panel for it to take effect.
      const active = ds.files.length > 0 ? ds : null
      setDesignSystem(active)
      void storeDesignSystem(active, activeBranchIdRef.current)
      handleKnowledgeChange(syncDesignSystemLayers(active, knowledgeLayers))
    },
    [knowledgeLayers, handleKnowledgeChange]
  )

  const closeDesignSystem = useCallback(() => {
    setShowDesignSystem(false)
    const ds = designSystemRef.current
    const active = ds && ds.files.length > 0 ? ds : null
    setDesignSystem(active)
    void storeDesignSystem(active, activeBranchIdRef.current)
    handleKnowledgeChange(syncDesignSystemLayers(active, knowledgeLayers))
  }, [knowledgeLayers, handleKnowledgeChange])

  // Load a hub's knowledge layers into editor state so the existing Knowledge /
  // Design panels can browse + edit them straight from the portfolio screen.
  const loadBranchKnowledge = useCallback(
    async (branchId: string) => {
      setActiveBranchId(branchId)
      activeBranchIdRef.current = branchId
      try {
        const res = await fetch(`/api/knowledge?branchId=${branchId}`)
        if (res.ok) {
          const layers: KnowledgeLayer[] = await res.json()
          setKnowledgeLayers(layers.length > 0 ? layers : await seedBranchKnowledge(branchId))
        }
      } catch {
        /* keep current layers */
      }
    },
    [seedBranchKnowledge]
  )

  const openHubKnowledge = useCallback(
    async (branchId: string) => {
      await loadBranchKnowledge(branchId)
      setShowKnowledge(true)
    },
    [loadBranchKnowledge]
  )

  const openHubDesign = useCallback(
    async (branchId: string) => {
      await loadBranchKnowledge(branchId)
      const restoredDs = await loadStoredDesignSystem(dsId, branchId)
      if (restoredDs) {
        designSystemRef.current = restoredDs
        setDsName(restoredDs.name)
        setDsFiles(restoredDs.files)
        setDesignSystem(restoredDs)
      } else {
        designSystemRef.current = null
        setDsName('')
        setDsFiles([])
        setDesignSystem(null)
      }
      setShowDesignSystem(true)
    },
    [loadBranchKnowledge, dsId]
  )

  // Knowledge + Design System modals are shared between the portfolio (Knowledge
  // Hub) view and the deck editor, so they can be opened from either place.
  const knowledgeAndDesignModals = (
    <>
      {showKnowledge && (
        <KnowledgePanel
          layers={knowledgeLayers}
          onChange={handleKnowledgeChange}
          onClose={() => setShowKnowledge(false)}
        />
      )}
      {showDesignSystem && (
        <DesignSystemPanel
          dsId={dsId}
          initialName={dsName}
          initialFiles={dsFiles}
          onChange={handleDesignSystemChange}
          onClose={closeDesignSystem}
          templatesSlot={
            <TemplateUploader
              templates={templates}
              onLoadedBatch={batch => {
                setTemplates(prev => {
                  const next = mergeTemplateList(prev, batch)
                  const nextLayers = syncTemplateKnowledgeLayers(next, knowledgeLayers)
                  handleKnowledgeChange(nextLayers)
                  return next
                })
                const names = batch.map(t => t.filename).join(', ')
                const notif =
                  batch.length === 1
                    ? `Template added: "${batch[0].filename}" (${batch[0].source.toUpperCase()}). Style tokens extracted.`
                    : `${batch.length} templates added: ${names}. Combined style tokens are active.`
                setDisplay(prev => [
                  ...prev,
                  { role: 'assistant', response: { type: 'clarification', question: notif } },
                ])
              }}
              onRemove={id => {
                setTemplates(prev => {
                  const next = prev.filter(t => t.id !== id)
                  const nextLayers = syncTemplateKnowledgeLayers(next, knowledgeLayers)
                  handleKnowledgeChange(nextLayers)
                  return next
                })
              }}
              onClearAll={() => {
                setTemplates([])
                handleKnowledgeChange(knowledgeLayers.filter(l => l.source !== 'template'))
              }}
            />
          }
        />
      )}
    </>
  )

  // ── Download PPTX ────────────────────────────────────────────────────────────
  const downloadPptx = useCallback(async () => {
    // Bake lucide icons into PNGs first so they survive in PowerPoint (which can't
    // render our on-canvas SVG icons), reusing the existing image export path.
    const exportSlides = await rasterizeIconsInSlides(slides)
    const res = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slides: exportSlides }),
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'presentation.pptx'
    a.click()
    URL.revokeObjectURL(url)
  }, [slides])

  // ── Download PDF — snapshot each workspace slide from SlideCanvas (WYSIWYG) ─
  const downloadPdf = useCallback(async () => {
    if (exportingPdfRef.current || slides.length === 0) return
    exportingPdfRef.current = true
    setExportingPdf(true)
    const exportSlides = await rasterizeIconsInSlides(slides)
    const images: string[] = []
    setCaptureScale(PDF_EXPORT_SCALE)
    try {
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await document.fonts.ready
      }
      for (const slide of exportSlides) {
        setCaptureSlide(slide)
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
        // Extra beat so @font-face / layout settle before the snapshot.
        await new Promise<void>(resolve => setTimeout(resolve, 120))
        const node = agentCaptureRef.current
        if (!node) {
          images.push('')
          continue
        }
        try {
          const bg = slide.bg?.replace('#', '') || '0D1B2A'
          const png = await toPng(node, {
            pixelRatio: 2,
            cacheBust: true,
            backgroundColor: `#${bg}`,
            fontEmbedCSS: fontFaceCssRef.current || undefined,
          })
          images.push(png)
        } catch (err) {
          console.error('[pdf export] slide capture failed', err)
          images.push('')
        }
      }
      const base =
        presentationSummaries.find(p => p.id === presentationId)?.name
          ?.replace(/[^\w\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-') || 'presentation'
      downloadPdfFromImages(images, `${base}.pdf`)
    } finally {
      setCaptureSlide(null)
      setCaptureScale(AGENT_RENDER_SCALE)
      exportingPdfRef.current = false
      setExportingPdf(false)
    }
  }, [slides, presentationId, presentationSummaries])

  // ── Auth states ───────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#060d1a]">
        <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <LoginScreen />
  }

  if (showStartScreen) {
    return (
      <>
        <StartScreen
          branches={branches}
          presentations={presentationSummaries}
          userName={session?.user?.name || session?.user?.email}
          loading={portfolioLoading}
          onOpen={openPresentation}
          onCreate={createPresentation}
          onCreateBranch={createBranch}
          onImportFile={importPresentation}
          importJobs={importJobs}
          onDismissImportJob={dismissImportJob}
          onRenameBranch={renameBranch}
          onDeleteBranch={deleteBranch}
          onDeletePresentation={deletePresentation}
          onRenamePresentation={renamePresentation}
          onOpenKnowledge={openHubKnowledge}
          onOpenDesign={openHubDesign}
          onSignOut={() => signOut()}
          onPortfolioRefresh={loadPortfolio}
        />
        {knowledgeAndDesignModals}
      </>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <DesignTokensProvider value={designTokens}>
    {fontFaceCss && <style dangerouslySetInnerHTML={{ __html: fontFaceCss }} />}
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top header toolbar */}
      <header className="flex justify-between items-center gap-2 px-4 py-2 bg-[#0d1b2a] border-b border-[#1e3a5f] flex-shrink-0">
        <button
          onClick={goHome}
          title="Back to portfolio"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[#1e3a5f] text-violet-300 rounded hover:bg-[#2a4a6f] hover:text-white transition-colors flex-shrink-0"
        >
          <HomeIcon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Portfolio</span>
        </button>
        <span className="text-xs text-[#475569] min-w-0 truncate">
          {slides.length} slide{slides.length !== 1 ? 's' : ''}
          {selectedSlideIds.length > 1 &&
            ` · ${selectedSlideIds.length} slides selected`}
          {lastScopeMode === 'full' && ' · full deck context'}
          {lastScopeMode === 'multi' && ' · multi-slide scope'}
          {pendingSlideIds.length > 1 && ` · ${pendingSlideIds.length} slides in preview`}
          {selectedElementIds.length > 0 &&
            ` · ${selectedElementIds.length} element${selectedElementIds.length !== 1 ? 's' : ''} selected`}
        </span>
        <div className="flex gap-2 items-center flex-shrink-0">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleImageFile(f)
              e.target.value = ''
            }}
          />
          <input
            ref={importInputRef}
            type="file"
            accept={IMPORT_ACCEPT}
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void appendImportedDeck(f)
              e.target.value = ''
            }}
          />
          {/* Insert-element tools — monochrome, icon-only; hover shows the tool name */}
          <button
            onClick={addTextElement}
            title="Add text block"
            className="p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <Type className="w-4 h-4" />
          </button>
          <button
            onClick={addShapeElement}
            title="Add shape"
            className="p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <Square className="w-4 h-4" />
          </button>
          <button
            onClick={() => addTableElement()}
            title="Add table"
            className="p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <Table className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              onClick={() =>
                designTokens?.logos?.length
                  ? setShowImageMenu(v => !v)
                  : imageInputRef.current?.click()
              }
              title="Add image"
              className="p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
            {showImageMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowImageMenu(false)} />
                <div className="absolute right-0 mt-1 z-50 w-52 rounded-lg border border-[#1e3a5f] bg-[#0d1b2a] shadow-2xl p-1.5">
                  <button
                    onClick={() => {
                      setShowImageMenu(false)
                      imageInputRef.current?.click()
                    }}
                    className="w-full text-left px-2 py-1.5 text-xs text-[#e2e8f0] rounded hover:bg-[#1e3a5f]"
                  >
                    Upload from computer…
                  </button>
                  {designTokens?.logos?.length ? (
                    <>
                      <div className="h-px bg-[#16263b] my-1" />
                      <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-400/80">
                        Brand logos
                      </p>
                      <div className="grid grid-cols-3 gap-1 p-1 max-h-44 overflow-y-auto">
                        {designTokens.logos.map(l => (
                          <button
                            key={l.name}
                            title={l.name}
                            onClick={() => {
                              setShowImageMenu(false)
                              insertImageSrc(l.src)
                            }}
                            className="aspect-square rounded bg-[#0a1422] p-1 hover:ring-1 hover:ring-[#60a5fa]"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={l.src}
                              alt={l.name}
                              className="w-full h-full object-contain"
                            />
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => addChartElement()}
            title="Add chart"
            className="p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIconPickerFor('insert')}
            title="Add icon"
            className="p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <Sparkles className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-[#1e3a5f] mx-0.5" />
          <button
            onClick={() => setShowDesignSystem(true)}
            title={
              dsFiles.length > 0
                ? `Design System: ${dsName || 'unnamed'} (${dsFiles.length} files) — AI follows it`
                : 'Upload a design system the AI will follow'
            }
            className="flex items-center gap-1 p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <Palette className="w-4 h-4" />
            <span className="text-[10px] font-mono text-[#64748B]">{dsFiles.length}</span>
          </button>
          <button
            onClick={() => setShowKnowledge(true)}
            title={`Knowledge layers: ${knowledgeLayers.filter(l => l.enabled).length} active`}
            className="flex items-center gap-1 p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <Brain className="w-4 h-4" />
            <span className="text-[10px] font-mono text-[#64748B]">{knowledgeLayers.filter(l => l.enabled).length}</span>
          </button>
          <button
            onClick={() => setShowVersions(true)}
            title={`${versions.length} version${versions.length !== 1 ? 's' : ''}`}
            className="flex items-center gap-1 p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <History className="w-4 h-4" />
            <span className="text-[10px] font-mono text-[#64748B]">{versions.length}</span>
          </button>
          <button
            onClick={revert}
            disabled={slideHistory.length === 0}
            title={
              slideHistory.length === 0
                ? 'Nothing to undo'
                : `Undo last action (${slideHistory.length} step${slideHistory.length !== 1 ? 's' : ''})`
            }
            className="p-1.5 text-[#94a3b8] rounded disabled:opacity-30 hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-[#1e3a5f] mx-0.5" />
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importingDeck}
            title="Import .pptx / .pdf — appends its slides to this deck"
            className="p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors disabled:opacity-40"
          >
            {importingDeck ? (
              <span className="block w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={downloadPptx}
            title="Download PPTX"
            className="p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={downloadPdf}
            disabled={exportingPdf || slides.length === 0}
            title="Download PDF — exports your slides exactly as shown in the editor"
            className="p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors disabled:opacity-50"
          >
            {exportingPdf ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4" />
            )}
          </button>
          <div className="flex items-center gap-1.5 pl-2 border-l border-[#1e3a5f]">
            {session?.user?.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt={session.user.name ?? 'User'}
                className="w-6 h-6 rounded-full"
              />
            )}
            <span className="text-xs text-[#64748B] max-w-[80px] truncate hidden sm:block">
              {session?.user?.name?.split(' ')[0]}
            </span>
            <button
              onClick={() => signOut()}
              title="Sign out"
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-[#64748B] hover:text-red-400 rounded hover:bg-[#1e3a5f] transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
      {/* Left — slide list / design inspector (collapsible with hover-peek) */}
      <div
        className="relative flex-shrink-0 transition-[width] duration-200 ease-out"
        style={{ width: leftCollapsed ? 0 : leftPanelWidth }}
        onMouseLeave={() => setLeftPeek(false)}
      >
        {/* Edge rail — hover to peek the collapsed panel, click to reopen it. */}
        {leftCollapsed && (
          <button
            type="button"
            onMouseEnter={() => setLeftPeek(true)}
            onClick={() => {
              setLeftCollapsed(false)
              setLeftPeek(false)
            }}
            title="Show slide panel"
            aria-label="Show slide panel"
            className="absolute inset-y-0 left-0 z-30 flex w-2.5 items-center justify-center bg-[#1e3a5f]/40 transition-colors hover:bg-[#60a5fa]/40"
          >
            <PanelLeftOpen className="h-4 w-4 text-[#64748b]" />
          </button>
        )}
      <div
        onMouseEnter={() => {
          if (leftCollapsed) setLeftPeek(true)
        }}
        style={{ width: leftPanelWidth }}
        className={`absolute inset-y-0 left-0 bg-[#0d1b2a] flex flex-col overflow-hidden transition-transform duration-200 ease-out ${
          leftCollapsed && !leftPeek ? '-translate-x-full' : 'translate-x-0'
        } ${leftCollapsed && leftPeek ? 'z-40 border-r border-[#1e3a5f] shadow-2xl' : ''}`}
      >
        {leftCollapsed && leftPeek && (
          <button
            type="button"
            onClick={() => {
              setLeftCollapsed(false)
              setLeftPeek(false)
            }}
            title="Keep panel open"
            aria-label="Keep panel open"
            className="absolute right-1.5 top-1.5 z-50 flex h-6 w-6 items-center justify-center rounded text-[#475569] transition-colors hover:bg-[#1e3a5f] hover:text-[#93c5fd]"
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="flex-shrink-0 flex border-b border-[#16263b]">
          {([
            ['slides', 'Slides'],
            ['design', 'Design'],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setLeftTab(tab)}
              className={`flex-1 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                leftTab === tab
                  ? 'text-[#93c5fd] border-b-2 border-[#60a5fa] bg-[#112236]'
                  : 'text-[#475569] border-b-2 border-transparent hover:text-[#64748b]'
              }`}
            >
              {label}
              {tab === 'design' && selectedElementIds.length === 1 && (
                <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[#60a5fa] align-middle" />
              )}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {leftTab === 'slides' ? (
            <SlidePanel
              slides={slides}
              activeSlideId={activeSlideId}
              selectedSlideIds={selectedSlideIds}
              pendingSlideIds={pendingSlideIds}
              deletedSlideIds={pendingDeletedSlideIds}
              onSelect={handleSlideSelect}
              onSelectAll={selectAllSlides}
              onReorder={reorderSlides}
              onAddSlide={() => addSlide()}
            />
          ) : (
            <ElementInspector
              element={selectedElements.length === 1 ? selectedElements[0] : null}
              selectedCount={selectedElementIds.length}
              onUpdate={updateElementWithHistory}
              onPickIcon={id => setIconPickerFor(id)}
              slideBg={slides.find(s => s.id === activeSlideId)?.bg ?? 'FFFFFF'}
              onUpdateSlideBg={updateSlideBg}
              slideGradient={slides.find(s => s.id === activeSlideId)?.bgGradient ?? null}
              onUpdateSlideGradient={updateSlideGradient}
            />
          )}
        </div>
      </div>
      </div>
      {!leftCollapsed && (
        <ResizeHandle
          side="left"
          onResize={resizeLeftPanel}
          onCollapse={() => setLeftCollapsed(true)}
        />
      )}

      {/* Center — canvas + diff bar */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col bg-[#060d1a] min-h-0 overflow-hidden">
          {(
            <>
              <div ref={canvasOverlayRef} className="relative flex-1 min-h-0 overflow-hidden">
                <div ref={canvasViewportRef} className="absolute inset-0 overflow-auto">
                <div
                  className="flex min-h-full min-w-full items-center justify-center p-6"
                  onClick={e => {
                    if (e.target === e.currentTarget) {
                      setEditingElementId(null)
                      setSelectedElementIds([])
                    }
                  }}
                >
                {/* Canvas + drawing overlay (captured to PNG on send) */}
                <div
                  ref={canvasCaptureRef}
                  className="relative rounded-lg overflow-hidden shadow-2xl flex-shrink-0 p-3 bg-[#060d1a]/40"
                  style={{
                    width: SLIDE_WIDTH * canvasScale + 24,
                    height: SLIDE_HEIGHT * canvasScale + 24,
                  }}
                  onClick={e => {
                    if (e.target === e.currentTarget) {
                      setEditingElementId(null)
                      setSelectedElementIds([])
                    }
                  }}
                >
                  <div
                    className="relative mx-auto"
                    style={{
                      width: SLIDE_WIDTH * canvasScale,
                      height: SLIDE_HEIGHT * canvasScale,
                    }}
                  >
                  <SlideCanvas
                    slide={activeSlide}
                    selectedElementIds={selectedElementIds}
                    editingElementId={editingElementId}
                    scale={canvasScale}
                    interactive={!annotationMode && !isAgentRunning && canEdit}
                    onElementClick={id =>
                      setSelectedElementIds(prev =>
                        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                      )
                    }
                    onElementDoubleClick={id => {
                      const dblEl = activeSlide.elements.find(e => e.id === id)
                      // Charts/images/icons have no inline text — double-click selects
                      // them and opens the inspector (colors, data) instead of text edit.
                      if (
                        dblEl &&
                        (dblEl.type === 'chart' || dblEl.type === 'image' || dblEl.type === 'icon')
                      ) {
                        setSelectedElementIds([id])
                        setEditingElementId(null)
                        setLeftTab('design')
                      } else {
                        setEditingElementId(id)
                        setSelectedElementIds([id])
                      }
                    }}
                    onElementUpdate={updateElementWithHistory}
                    onElementResize={updateElement}
                    onElementResizeStart={pushHistory}
                    onEditingEnd={() => setEditingElementId(null)}
                    onCanvasClick={() => {
                      setEditingElementId(null)
                      setSelectedElementIds([])
                    }}
                    onCanvasDoubleClick={() => {
                      setEditingElementId(null)
                      setSelectedElementIds([])
                      setLeftTab('design')
                    }}
                    onMarqueeSelect={ids => {
                      setEditingElementId(null)
                      setSelectedElementIds(ids)
                    }}
                  />
                  <AnnotationLayer
                    enabled={annotationMode}
                    color={annotationColor}
                    strokes={strokes}
                    onStrokesChange={setStrokes}
                    width={SLIDE_WIDTH}
                    height={SLIDE_HEIGHT}
                  />
                  </div>
                </div>
                </div>
                </div>
                <CanvasZoomControls
                  zoom={canvasZoom}
                  onZoomChange={z => setCanvasZoom(clamp(z, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX))}
                  min={CANVAS_ZOOM_MIN}
                  max={CANVAS_ZOOM_MAX}
                  step={CANVAS_ZOOM_STEP}
                />
                <CanvasFloatingToolbar
                  containerRef={canvasOverlayRef}
                  annotationMode={annotationMode}
                  onAnnotationModeChange={setAnnotationMode}
                  annotationColor={annotationColor}
                  onAnnotationColorChange={c => {
                    setAnnotationColor(c)
                    setAnnotationMode(true)
                  }}
                  strokesCount={strokes.length}
                  onUndoStroke={() => setStrokes(s => s.slice(0, -1))}
                  onClearStrokes={() => setStrokes([])}
                  selectedElements={selectedElements}
                  onUpdateElement={updateElementWithHistory}
                  onDeleteElements={deleteSelectedElements}
                  onCopyElements={copySelectedElements}
                  onPasteElements={pasteElements}
                  clipboardCount={clipboardElements.length}
                  onAlignElements={alignElements}
                  onStartEditing={id => {
                    setEditingElementId(id)
                    setSelectedElementIds([id])
                  }}
                  editingElementId={editingElementId}
                  selectedSlideCount={selectedSlideIds.length}
                  canDeleteSlides={
                    selectedSlideIds.length > 0 &&
                    slides.length - selectedSlideIds.length >= 1
                  }
                  canMergeSlides={selectedSlideIds.length > 1}
                  onDeleteSlides={deleteSelectedSlides}
                  onDuplicateSlides={duplicateSelectedSlides}
                  onAddSlide={() => addSlide(activeSlideId)}
                  onSplitSlide={splitActiveSlide}
                  onMergeSlides={mergeSelectedSlides}
                  slideBg={slides.find(s => s.id === activeSlideId)?.bg ?? 'FFFFFF'}
                  onUpdateSlideBg={updateSlideBg}
                  slideGradient={slides.find(s => s.id === activeSlideId)?.bgGradient ?? null}
                  onUpdateSlideGradient={updateSlideGradient}
                  quickActions={QUICK_ACTIONS}
                  quickActionCtx={{
                    slides,
                    activeSlideId,
                    activeSlideIndex: slides.findIndex(s => s.id === activeSlideId),
                    selectedSlideIds,
                    selectedElementIds,
                  }}
                  onRunQuickAction={runQuickAction}
                  quickActionsDisabled={isLoading || isAgentRunning}
                />
              </div>
            </>
          )}
        </div>

      </div>

      {!rightCollapsed && (
        <ResizeHandle
          side="right"
          onResize={resizeRightPanel}
          onCollapse={() => setRightCollapsed(true)}
        />
      )}

      {/* Off-screen render target: the agent screenshots THIS to "see" a slide. */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: -100000,
          top: 0,
          pointerEvents: 'none',
          opacity: 0,
          zIndex: -1,
        }}
      >
        <div ref={agentCaptureRef}>
          {fontFaceCss ? <style dangerouslySetInnerHTML={{ __html: fontFaceCss }} /> : null}
          {captureSlide && (
            <SlideCanvas slide={captureSlide} scale={captureScale} interactive={false} />
          )}
        </div>
      </div>

      {/* Right — chat (collapsible with hover-peek) */}
      <div
        className="relative flex-shrink-0 transition-[width] duration-200 ease-out"
        style={{ width: rightCollapsed ? 0 : rightPanelWidth }}
        onMouseLeave={() => setRightPeek(false)}
      >
        {/* Edge rail — hover to peek the collapsed chat, click to reopen it. */}
        {rightCollapsed && (
          <button
            type="button"
            onMouseEnter={() => setRightPeek(true)}
            onClick={() => {
              setRightCollapsed(false)
              setRightPeek(false)
            }}
            title="Show chat panel"
            aria-label="Show chat panel"
            className="absolute inset-y-0 right-0 z-30 flex w-2.5 items-center justify-center bg-[#1e3a5f]/40 transition-colors hover:bg-[#60a5fa]/40"
          >
            <PanelRightOpen className="h-4 w-4 text-[#64748b]" />
          </button>
        )}
        <div
          onMouseEnter={() => {
            if (rightCollapsed) setRightPeek(true)
          }}
          style={{ width: rightPanelWidth }}
          className={`absolute inset-y-0 right-0 bg-[#0d1b2a] flex flex-col overflow-hidden transition-transform duration-200 ease-out ${
            rightCollapsed && !rightPeek ? 'translate-x-full' : 'translate-x-0'
          } ${rightCollapsed && rightPeek ? 'z-40 border-l border-[#1e3a5f] shadow-2xl' : ''}`}
        >
          <ChatPanel
            isLoading={isLoading || isAgentRunning}
            isAgentRunning={isAgentRunning}
            canEdit={canEdit}
            selectedSlideIds={selectedSlideIds}
            selectedElementIds={selectedElementIds}
            display={display}
            onSend={handleSend}
            onRunAgent={runAgent}
            onStopAgent={stopProcessing}
            onPickOption={handlePickOption}
            onSubmitAnswers={handleSubmitAnswers}
            onRevert={revertToMessage}
            draft={chatDraft}
            slides={slides}
            pendingChanges={pendingChanges}
            pendingSummary={pendingSummary}
            onApproveProposal={applyChanges}
            onDeclineProposal={discardChanges}
            onOpenProposal={() => setIsPreviewOpen(true)}
            onCollapse={() => setRightCollapsed(true)}
            peeking={rightCollapsed && rightPeek}
            onPin={() => {
              setRightCollapsed(false)
              setRightPeek(false)
            }}
          />
        </div>
      </div>
      </div>

      {/* ── Proposal preview overlay (opened from the chat proposal widget) ──── */}
      {isPreviewOpen && pendingChanges && (
        <ProposalPreviewModal
          slides={slides}
          changes={pendingChanges}
          summary={pendingSummary}
          onApply={applyChanges}
          onDiscard={discardChanges}
          onClose={() => setIsPreviewOpen(false)}
          onRefine={refineProposal}
          isRefining={isRefining}
          refineNote={refineNote}
        />
      )}

      {/* ── Knowledge Manager Modal ─────────────────────────────────────────── */}
      {iconPickerFor && (
        <IconPicker
          current={
            iconPickerFor !== 'insert'
              ? activeSlide?.elements.find(e => e.id === iconPickerFor)?.icon
              : undefined
          }
          onSelect={name => {
            if (iconPickerFor === 'insert') addIconElement(name)
            else updateElementWithHistory(iconPickerFor, { icon: name })
            setIconPickerFor(null)
          }}
          onClose={() => setIconPickerFor(null)}
        />
      )}

      {knowledgeAndDesignModals}

      {/* ── Version Control Modal ───────────────────────────────────────────── */}
      {showVersions && (
        <VersionPanel
          versions={versions}
          decisions={decisions}
          currentSlides={slides}
          activeSlideId={activeSlideId}
          branches={versionBranches}
          currentBranchId={currentBranchId}
          currentVersionId={currentVersionId}
          onSwitchBranch={switchBranch}
          onRestoreVersion={restoreVersion}
          onRestoreSlide={restoreSlide}
          onNameVersion={nameVersion}
          onClose={() => setShowVersions(false)}
        />
      )}
    </div>
    </DesignTokensProvider>
  )
}
