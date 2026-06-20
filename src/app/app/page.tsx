'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { toPng } from 'html-to-image'
import { Brain, History, Undo2, Download, FileDown, LogOut, Palette, Image as ImageIcon, Home as HomeIcon, BarChart3, Sparkles, Type, Square, Table, Upload, PanelLeftOpen, PanelRightOpen, Pin, Loader2, MessageSquare } from 'lucide-react'
import { IMPORT_ACCEPT } from '@/lib/importDeck'
import SlidePanel from '@/components/SlidePanel'
import ElementInspector from '@/components/ElementInspector'
import SlideCanvas from '@/components/SlideCanvas'
import ResizeHandle from '@/components/ResizeHandle'
import CanvasFloatingToolbar, { AlignMode } from '@/components/CanvasFloatingToolbar'
import CanvasZoomControls from '@/components/CanvasZoomControls'
import AnnotationLayer, { Stroke } from '@/components/AnnotationLayer'
import { useFitScale } from '@/hooks/useFitScale'
import { useCanvasWheelZoom } from '@/hooks/useCanvasWheelZoom'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '@/lib/slideDimensions'
import ChatPanel, { DisplayMessage } from '@/components/ChatPanel'
import {
  conversationToDisplay,
  DEFAULT_WELCOME,
  normalizeConversationHistory,
} from '@/lib/conversation'
import { savePresentation, saveVersion, persistDecision, setDecisionStatus } from '@/lib/persistence'
import ProposalPreviewModal from '@/components/ProposalPreviewModal'
import AmendmentsBar from '@/components/AmendmentsBar'
import IconPicker from '@/components/IconPicker'
import { QUICK_ACTIONS, QuickAction, QuickActionContext, resolveQuickActionTargetSlideIds } from '@/lib/quickActions'
import TemplateUploader, { TemplateKnowledge } from '@/components/TemplateUploader'
import {
  mergeTemplateList,
  mergeTemplatesKnowledge,
  syncTemplateKnowledgeLayers,
} from '@/lib/templateKnowledge'
import KnowledgePanel from '@/components/KnowledgePanel'
import {
  type DeckElementLink,
  indexDeckElementLinks,
} from '@/lib/deckKnowledgeLinks'
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
  buildApplyDesignSystemToDeckInstruction,
  buildDesignSystemAlignmentFromUserNote,
  formatDesignSystemDeckAlignmentBlock,
  formatDesignSystemApplyExistingBlock,
  formatDesignSystemApplyScopedBlock,
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
import CommentsPanel from '@/components/CommentsPanel'
import CommentPinLayer from '@/components/CommentPinLayer'
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
  DeckComment,
  SlideVersion,
  VersionBranch,
  ElementStyle,
  ChartSpec,
  HubRole,
} from '@/lib/types'
import { canEditPresentation, canModerateKnowledge } from '@/lib/hubAccess'
import { actorDisplayName } from '@/lib/actorInfo'
import {
  buildKnowledgeContext,
  activeSlideText,
  defaultKnowledgeLayers,
  diffSlideIds,
  mergeKnowledgeContexts,
  fetchGraphKnowledgeContext,
  fetchAgentPlan,
  reviewAgentChanges,
} from '@/lib/knowledge'
import { buildCommentsContext } from '@/lib/comments'
import {
  commentsOnSlide,
  elementAtCanvasPoint,
  type CommentPinDraft,
} from '@/lib/commentPins'
import { formatValidationForAgent, formatValidationForUser } from '@/lib/agent/review'
import type { SemanticEditPlan, ValidationResult } from '@/lib/agent/types'
import { summarizeDeckChanges } from '@/lib/versionDiff'
import { fontsUsedOnSlides } from '@/lib/fonts'
import {
  applyChangesToSlides,
  excludeChangesByElements,
  excludeChangesBySlide,
  filterChangesByElements,
  filterChangesBySlide,
  countChangesBySlide,
  getAffectedElementIds,
  getDeletedElementIds,
  getDeletedSlideIds,
  getPendingSlideIds,
  resolveEffectivePendingChanges,
  buildNetChangesFromSnapshots,
  changesAreGeometryOnly,
} from '@/lib/preview'
import { consumeAgentSdkStream } from '@/lib/agent/claudeSdk/consumeStream'
import type { DeckAgentStreamEvent } from '@/lib/agent/claudeSdk/types'
import {
  changesAddSlides,
  compressAgentIntro,
  effectiveSlideLimit,
  formatPresentationScopeNote,
  formatScopeGateNote,
  buildDeckBuildResumeInstruction,
  buildDeckBuildContinuationInstruction,
  formatDeckBuildExecuteBlock,
  isDeckBuildResumeTask,
  isDesignSystemAlignmentRequest,
  isDeckWideDesignSystemRequest,
  isNewDeckBuildRequest,
  parsePresentationScope,
  PRESENTATION_DEPTH_QUESTION,
  slimSlideJson,
  wouldExceedScopeSlideLimit,
} from '@/lib/presentationScope'
import {
  buildAgentContinuationInstruction,
  buildSlideTargetFixInstruction,
  findRecentLayoutFixTask,
  isAgentContinuationMessage,
  isClarificationAskingForClaims,
  isClarificationAskingToConfirmSlides,
  isKnowledgeBasedEditRequest,
  isLayoutAuditChangeRequest,
  isLayoutGeometryOnlyRequest,
  isSlideStructureLayoutRequest,
  isTitleAlignmentFixRequest,
  isGeometryEditRequest,
  formatTitleAlignmentDirective,
  stripUserFacingInstruction,
  isDeckWideLayoutAudit,
  isDeckWideInstruction,
  isShortSlideTargetAnswer,
  parseSlideNumbersFromText,
  parseSlideIdsFromText,
  recoverIncompleteContextFromHistory,
  withLayoutAuditDirective,
  type IncompleteAgentContext,
} from '@/lib/agent/routingHeuristics'
import {
  formatAgentWorkScopeBlock,
  reopenFailedLayoutPatches,
  resolveAgentWorkScope,
  type AgentWorkScope,
} from '@/lib/agent/workScope'
import {
  buildApplyLimitError,
  buildNoToolCallPauseError,
  buildOverloadedError,
  buildRateLimitError,
  buildSpacingLimitError,
  buildStepLimitError,
  buildTimeoutError,
  formatAgentLimitError,
} from '@/lib/agent/limitError'
import {
  AGENT_PAUSE_STATE_VERSION,
  buildAgentResumeNote,
  cloneMessages,
  type AgentPauseReason,
  type AgentPauseState,
} from '@/lib/agent/agentPauseState'
import { analyzeChanges, formatChangeReport } from '@/lib/changeDiagnostics'
import { readShowKnowledgePins, writeShowKnowledgePins } from '@/lib/showKnowledgePins'
import {
  clearEditorSessionLocal,
  hasRestorableEditorSession,
  readEditorSessionLocal,
  slimDisplayForSession,
  writeEditorSessionLocal,
  type EditorSession,
} from '@/lib/editorSession'
import { installGlobalErrorReporting, reportClientError } from '@/lib/clientLog'
import { formatLayoutIssues, formatOverlapCheck, formatSpacingCheck, findOverlapIssues, findOverlapsAmong, findLayoutFixIssues, findGeometryIssues, findSpacingIssues, filterGeometryLayoutIssues, filterLayoutFixIssues, filterOverlapOnlyLayoutIssues, reviewLayoutChange, SLIDE_W_IN, SLIDE_H_IN } from '@/lib/layout'
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
/** Outer p-6 (48px) + capture frame p-3 (24px) per axis — must match canvas chrome. */
const CANVAS_VIEWPORT_PADDING = 72
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
type UiMode = 'agent'

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
): Promise<{ mode: 'agent' | 'ask'; effort: Effort; scope: RouterScope }> {
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction, ...ctx }),
    })
    if (res.ok) {
      const data = (await res.json()) as { mode?: string; effort?: string; scope?: string }
      const mode = data.mode === 'ask' ? 'ask' : 'agent'
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

function bumpEffort(e: Effort): Effort {
  const order: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
  return order[Math.min(order.length - 1, order.indexOf(e) + 1)]
}

/** A background deck import (PPTX/PDF) shown as a pending card in the portfolio. */
type ImportJob = { id: string; name: string; status: 'loading' | 'error'; error?: string }

export default function Home() {
  const { data: session, status } = useSession()

  const messageActorFields = useCallback(() => {
    if (!session?.user?.id) return {}
    return {
      userId: session.user.id,
      userName: actorDisplayName(session.user.name, session.user.email),
      userImage: session.user.image ?? null,
    }
  }, [session])

  const versionActorFields = useCallback(() => {
    if (!session?.user?.id) return {}
    return {
      actorId: session.user.id,
      actorName: actorDisplayName(session.user.name, session.user.email),
      actorImage: session.user.image ?? null,
    }
  }, [session])

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
        opts?: {
          effort?: Effort
          skipUserEcho?: boolean
          checkpoint?: SlideData[]
          historyLength?: number
          continuation?: boolean
          scopedSlideIds?: string[]
          uiScopeAuthoritative?: boolean
          deckWide?: boolean
          /** Resume the exact agent message thread from a pipeline pause. */
          resumeFromPause?: boolean
          /** Q&A — no deck edits; show a clean prose answer in chat. */
          answerOnly?: boolean
          /** User-visible message text (without agent directives). */
          displayText?: string
        }
      ) => void)
    | null
  >(null)
  // Groups a burst of keyboard nudges into a single undo step.
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Pending amendments (live on canvas; accept/decline via top bar) ───────────
  const [pendingChanges, setPendingChanges] = useState<Change[] | null>(null)
  const [pendingSummary, setPendingSummary] = useState<string>('')
  const [amendmentCheckpoint, setAmendmentCheckpoint] = useState<SlideData[] | null>(null)
  const [amendmentSource, setAmendmentSource] = useState<'single' | 'agent' | null>(null)
  const [agentRunIncomplete, setAgentRunIncomplete] = useState(false)
  const pendingChangesRef = useRef<Change[] | null>(null)
  const amendmentCheckpointRef = useRef<SlideData[] | null>(null)
  const amendmentSourceRef = useRef<'single' | 'agent' | null>(null)
  const amendmentsCommittedRef = useRef(false)
  const agentProgressRef = useRef({
    applyBatches: 0,
    changedSlideIds: new Set<string>(),
    lastAction: '',
  })
  const incompleteAgentContextRef = useRef<IncompleteAgentContext | null>(null)
  const agentPauseStateRef = useRef<AgentPauseState | null>(null)
  useEffect(() => {
    pendingChangesRef.current = pendingChanges
  }, [pendingChanges])
  useEffect(() => {
    amendmentCheckpointRef.current = amendmentCheckpoint
  }, [amendmentCheckpoint])
  useEffect(() => {
    amendmentSourceRef.current = amendmentSource
  }, [amendmentSource])
  const [showKnowledgePins, setShowKnowledgePins] = useState(false)
  const showKnowledgePinsReadyRef = useRef(false)
  useEffect(() => {
    setShowKnowledgePins(readShowKnowledgePins())
    showKnowledgePinsReadyRef.current = true
  }, [])
  const setShowKnowledgePinsPersisted = useCallback((show: boolean) => {
    setShowKnowledgePins(show)
    if (showKnowledgePinsReadyRef.current) writeShowKnowledgePins(show)
  }, [])
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
  const effectivePendingChanges = useMemo(
    () =>
      isAgentRunning
        ? null
        : resolveEffectivePendingChanges(pendingChanges, amendmentCheckpoint, slides),
    [pendingChanges, amendmentCheckpoint, slides, isAgentRunning]
  )
  const deckFonts = useMemo(() => fontsUsedOnSlides(slides), [slides])
  const [captureSlide, setCaptureSlide] = useState<SlideData | null>(null)
  const [captureScale, setCaptureScale] = useState(AGENT_RENDER_SCALE)
  const agentCaptureRef = useRef<HTMLDivElement>(null)
  // Cancellation: a flag the agent loop checks each step, plus the in-flight
  // request's AbortController so a Stop also kills the current network call.
  const agentStopRef = useRef(false)
  const agentProviderRef = useRef<string | null>(null)
  const isAgentRunningRef = useRef(false)
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
  const [showComments, setShowComments] = useState(false)
  const [commentPlacementMode, setCommentPlacementMode] = useState(false)
  const [pendingCommentPin, setPendingCommentPin] = useState<CommentPinDraft | null>(null)
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null)
  const [deckComments, setDeckComments] = useState<DeckComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsBusy, setCommentsBusy] = useState(false)
  const deckCommentsRef = useRef<DeckComment[]>([])
  useEffect(() => {
    deckCommentsRef.current = deckComments
  }, [deckComments])
  const [deckElementLinks, setDeckElementLinks] = useState<DeckElementLink[]>([])

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
  const canvasScrollContentRef = useRef<HTMLDivElement>(null)
  const [canvasZoom, setCanvasZoom] = useState(1)

  // ── DB persistence state ─────────────────────────────────────────────────────
  const [presentationId, setPresentationId] = useState<string | null>(null)
  const [currentRole, setCurrentRole] = useState<HubRole | null>(null)
  const canEditDeck = canEditPresentation(currentRole)
  const canModerateHubKnowledge = canModerateKnowledge(currentRole)
  const canEdit = canEditDeck
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

  const updateElementsWithHistory = useCallback(
    (
      elementIds: string[],
      patch: { content?: string; style?: Partial<ElementStyle>; chart?: ChartSpec; icon?: string; x?: number; y?: number; w?: number; h?: number }
    ) => {
      if (elementIds.length === 0) return
      pushHistory()
      elementIds.forEach(id => updateElement(id, patch))
    },
    [pushHistory, updateElement]
  )

  useEffect(() => {
    setEditingElementId(null)
  }, [activeSlideId])

  // Surface the design inspector when a single element is selected, or when multiple
  // text blocks are selected for group typography editing.
  useEffect(() => {
    if (selectedElementIds.length === 0) {
      setLeftTab('slides')
      return
    }
    if (selectedElementIds.length === 1) {
      setLeftTab('design')
      return
    }
    const slide = slides.find(s => s.id === activeSlideId)
    const hasTextInSelection = (slide?.elements ?? []).some(
      el => selectedElementIds.includes(el.id) && (el.type === 'text' || el.type === 'chip')
    )
    if (hasTextInSelection) setLeftTab('design')
  }, [selectedElementIds, activeSlideId, slides])

  // Auto-save presentation state (slides, chat, active slide, unfinished session) after edits
  useEffect(() => {
    if (!presentationId || !initialLoadDone) return
    const timer = setTimeout(() => {
      const incompleteCtx = incompleteAgentContextRef.current
      const hasPendingAmendments = (pendingChanges?.length ?? 0) > 0
      const hasUnfinished =
        hasPendingAmendments ||
        agentRunIncomplete ||
        !!pendingAgentInstruction ||
        display.some(m => !!m.agentStep || m.patchStatus === 'pending')

      let editorSession: EditorSession | null = null
      if (hasUnfinished) {
        editorSession = {
          version: 1,
          updatedAt: Date.now(),
          slides,
          activeSlideId,
          selectedSlideIds,
          selectedElementIds,
          pendingChanges,
          amendmentCheckpoint,
          pendingSummary,
          amendmentSource,
          pendingDecisionId,
          agentRunIncomplete,
          incompleteAgentContext: incompleteCtx,
          agentPauseState: agentPauseStateRef.current,
          pendingAgentInstruction,
          display: slimDisplayForSession(display),
        }
        writeEditorSessionLocal(presentationId, editorSession)
      } else {
        clearEditorSessionLocal(presentationId)
      }

      savePresentation(presentationId, {
        slides,
        conversationHistory,
        activeSlideId,
        editorSession: hasUnfinished ? editorSession : null,
      }).catch(err => console.error('Failed to save presentation', err))
    }, 400)
    return () => clearTimeout(timer)
  }, [
    slides,
    conversationHistory,
    activeSlideId,
    presentationId,
    initialLoadDone,
    pendingChanges,
    amendmentCheckpoint,
    pendingSummary,
    amendmentSource,
    pendingDecisionId,
    agentRunIncomplete,
    pendingAgentInstruction,
    display,
    selectedSlideIds,
    selectedElementIds,
  ])

  // Commit manual edits into the version timeline. Debounced + coalesced: a burst
  // of direct edits becomes one "Manual edits" snapshot that keeps updating until
  // a boundary (AI edit / restore / branch) closes the session.
  useEffect(() => {
    if (!presentationId || !initialLoadDone) return
    // Agent/AI review preview — wait for Accept; do not capture as "Manual edits".
    if ((pendingChangesRef.current?.length ?? 0) > 0 || amendmentCheckpointRef.current) return
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
          ...versionActorFields(),
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

  // Flush unfinished session to localStorage immediately before tab close.
  useEffect(() => {
    if (!presentationId || !initialLoadDone) return
    const flush = () => {
      const hasPendingAmendments = (pendingChangesRef.current?.length ?? 0) > 0
      const hasUnfinished =
        hasPendingAmendments ||
        agentRunIncomplete ||
        !!pendingAgentInstruction ||
        display.some(m => !!m.agentStep || m.patchStatus === 'pending')
      if (!hasUnfinished) return
      const session: EditorSession = {
        version: 1,
        updatedAt: Date.now(),
        slides: slidesRef.current,
        activeSlideId,
        selectedSlideIds,
        selectedElementIds,
        pendingChanges: pendingChangesRef.current,
        amendmentCheckpoint,
        pendingSummary,
        amendmentSource,
        pendingDecisionId,
        agentRunIncomplete,
        incompleteAgentContext: incompleteAgentContextRef.current,
        agentPauseState: agentPauseStateRef.current,
        pendingAgentInstruction,
        display: slimDisplayForSession(display),
      }
      writeEditorSessionLocal(presentationId, session)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [
    presentationId,
    initialLoadDone,
    activeSlideId,
    selectedSlideIds,
    selectedElementIds,
    amendmentCheckpoint,
    pendingSummary,
    amendmentSource,
    pendingDecisionId,
    agentRunIncomplete,
    pendingAgentInstruction,
    display,
  ])

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

  const loadComments = useCallback(async (presId: string) => {
    setCommentsLoading(true)
    try {
      const res = await fetch(`/api/presentations/${presId}/comments`)
      if (res.ok) setDeckComments(await res.json())
      else setDeckComments([])
    } catch {
      setDeckComments([])
    } finally {
      setCommentsLoading(false)
    }
  }, [])

  const addDeckComment = useCallback(
    async (
      content: string,
      scope: {
        slideId?: string | null
        elementId?: string | null
        pinX?: number | null
        pinY?: number | null
      }
    ) => {
      if (!presentationId) return
      setCommentsBusy(true)
      try {
        const res = await fetch(`/api/presentations/${presentationId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            slideId: scope.slideId ?? null,
            elementId: scope.elementId ?? null,
            pinX: scope.pinX ?? null,
            pinY: scope.pinY ?? null,
          }),
        })
        if (res.ok) {
          const created = (await res.json()) as DeckComment
          setDeckComments(prev => [...prev, created])
          setPendingCommentPin(null)
          setCommentPlacementMode(false)
          setShowComments(false)
          setHighlightedCommentId(null)
        }
      } finally {
        setCommentsBusy(false)
      }
    },
    [presentationId]
  )

  const handleCommentPinPlace = useCallback(
    (x: number, y: number) => {
      const slide = slides.find(s => s.id === activeSlideId)
      if (!slide) return
      setPendingCommentPin({
        slideId: activeSlideId,
        elementId: elementAtCanvasPoint(slide, x, y),
        pinX: x,
        pinY: y,
      })
      setCommentPlacementMode(false)
      setShowComments(true)
    },
    [slides, activeSlideId]
  )

  const handleCommentPinClick = useCallback((commentId: string) => {
    setHighlightedCommentId(commentId)
    setCommentPlacementMode(false)
    setPendingCommentPin(null)
    setShowComments(true)
  }, [])

  const closeCommentsUi = useCallback(() => {
    setShowComments(false)
    setPendingCommentPin(null)
    setCommentPlacementMode(false)
    setHighlightedCommentId(null)
  }, [])

  const startCommentPlacement = useCallback(() => {
    setAnnotationMode(false)
    setCommentPlacementMode(true)
    setPendingCommentPin(null)
    setShowComments(false)
    setHighlightedCommentId(null)
  }, [])

  const toggleDeckCommentResolved = useCallback(
    async (commentId: string, resolved: boolean) => {
      if (!presentationId) return
      const res = await fetch(`/api/presentations/${presentationId}/comments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: commentId, resolved }),
      })
      if (res.ok) {
        const updated = (await res.json()) as DeckComment
        setDeckComments(prev => prev.map(c => (c.id === commentId ? updated : c)))
      }
    },
    [presentationId]
  )

  const deleteDeckComment = useCallback(
    async (commentId: string) => {
      if (!presentationId) return
      const res = await fetch(`/api/presentations/${presentationId}/comments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: commentId }),
      })
      if (res.ok) setDeckComments(prev => prev.filter(c => c.id !== commentId))
    },
    [presentationId]
  )

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
        pendingChangesRef.current = null
        setPendingSummary('')
        setAmendmentCheckpoint(null)
        setAmendmentSource(null)
        setHighlightDiffOnCanvas(false)
        setAgentRunIncomplete(false)
        incompleteAgentContextRef.current = null
        setPendingAgentInstruction(null)
        setSelectedElementIds([])
        setEditingElementId(null)
        setStrokes([])
        setSlideHistory([])
        setVersions([])
        setDecisions([])
        setDeckComments([])
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
        void loadComments(id)

        const history = normalizeConversationHistory(detail.conversationHistory)
        setConversationHistory(history)
        setDisplay(history.length > 0 ? conversationToDisplay(history) : [DEFAULT_WELCOME])

        const apiSession = detail.editorSession as EditorSession | null | undefined
        const localSession = readEditorSessionLocal(id)
        let restoredSession: EditorSession | null = null
        if (apiSession && hasRestorableEditorSession(apiSession)) restoredSession = apiSession
        if (localSession && hasRestorableEditorSession(localSession)) {
          if (
            !restoredSession ||
            (localSession.updatedAt ?? 0) > (restoredSession.updatedAt ?? 0)
          ) {
            restoredSession = localSession
          }
        }
        if (restoredSession) {
          const restoredSlides = JSON.parse(
            JSON.stringify(restoredSession.slides)
          ) as SlideData[]
          if (restoredSlides.length > 0) {
            setSlides(restoredSlides)
            slidesRef.current = restoredSlides
          }
          const nextActive =
            restoredSession.activeSlideId &&
            (restoredSlides.length ? restoredSlides : loadedSlides).some(
              s => s.id === restoredSession!.activeSlideId
            )
              ? restoredSession.activeSlideId
              : restoredActiveId
          setActiveSlideId(nextActive)
          setSelectedSlideIds(
            restoredSession.selectedSlideIds?.length
              ? restoredSession.selectedSlideIds
              : [nextActive]
          )
          setSelectionAnchorId(nextActive)
          setSelectedElementIds(restoredSession.selectedElementIds ?? [])

          if (restoredSession.pendingChanges?.length) {
            setPendingChanges(restoredSession.pendingChanges)
            pendingChangesRef.current = restoredSession.pendingChanges
            setAmendmentCheckpoint(restoredSession.amendmentCheckpoint)
            setAmendmentSource(restoredSession.amendmentSource)
            setPendingSummary(restoredSession.pendingSummary ?? '')
            setPendingDecisionId(restoredSession.pendingDecisionId)
            setHighlightDiffOnCanvas(true)
          }

          setAgentRunIncomplete(restoredSession.agentRunIncomplete)
          incompleteAgentContextRef.current = restoredSession.incompleteAgentContext
          agentPauseStateRef.current = restoredSession.agentPauseState ?? null
          setPendingAgentInstruction(restoredSession.pendingAgentInstruction)

          if (restoredSession.display?.length) {
            setDisplay(restoredSession.display)
          }

          setDisplay(prev => [
            ...prev,
            {
              role: 'assistant',
              agentStep: {
                kind: 'note',
                label:
                  'Restored your unfinished session after reload — review pending changes or say "continue" to resume the agent.',
              },
            },
          ])
        }

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
              actorId: v.actorId ?? null,
              actorName: v.actorName,
              actorImage: v.actorImage ?? null,
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
              actorId: d.actorId ?? null,
              actorName: d.actorName,
              actorImage: d.actorImage ?? null,
            }))
          )
        }

        // Knowledge for this branch (seed defaults if the branch is empty).
        const branchId: string | null = detail.branchId ?? null
        let loadedLayers: KnowledgeLayer[] = defaultKnowledgeLayers()
        try {
          const klRes = await fetch(
            `/api/knowledge${branchId ? `?branchId=${branchId}` : ''}`
          )
          if (klRes.ok) {
            const layers: KnowledgeLayer[] = await klRes.json()
            if (layers.length > 0) loadedLayers = layers
            else if (branchId) loadedLayers = await seedBranchKnowledge(branchId)
            else loadedLayers = defaultKnowledgeLayers()
            setKnowledgeLayers(loadedLayers)
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
          setKnowledgeLayers(syncDesignSystemLayers(restoredDs, loadedLayers))
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
    [dsId, seedBranchKnowledge, closeManualSession, loadComments]
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

  // During an agent run, keep the canvas frozen at the pre-run checkpoint so live
  // apply_changes patches don't desync highlights from what AmendmentsBar shows.
  const displaySlides = useMemo(() => {
    if (isAgentRunning && amendmentCheckpoint) return amendmentCheckpoint
    return slides
  }, [isAgentRunning, amendmentCheckpoint, slides])

  // NEVER assert here: after an agent/manual edit deletes or replaces the active
  // slide, activeSlideId can momentarily point at a slide that no longer exists.
  // A bare `!` then throws "Cannot read properties of undefined (reading
  // 'elements')" on render → Next does a full reload → the user's just-typed
  // message is lost ("chat disappears"). Fall back to the first slide and let the
  // resync effect below repair activeSlideId.
  const activeSlide = displaySlides.find(s => s.id === activeSlideId) ?? displaySlides[0]
  const selectedElements = (activeSlide?.elements ?? []).filter(el =>
    selectedElementIds.includes(el.id)
  )

  const loadDeckElementLinks = useCallback(async (pid: string) => {
    try {
      const res = await fetch(`/api/graph/map/deck/${pid}`)
      if (!res.ok) {
        setDeckElementLinks([])
        return
      }
      const data = (await res.json()) as { mappings?: DeckElementLink[] }
      setDeckElementLinks(data.mappings ?? [])
    } catch {
      setDeckElementLinks([])
    }
  }, [])

  useEffect(() => {
    if (!presentationId) {
      setDeckElementLinks([])
      return
    }
    void loadDeckElementLinks(presentationId)
  }, [presentationId, loadDeckElementLinks])

  const deckLinkIndex = useMemo(
    () => indexDeckElementLinks(deckElementLinks),
    [deckElementLinks]
  )

  const knowledgeLinkByElementId = useMemo(() => {
    const m = new Map<string, { knowledgeName: string; knowledgeType: string }>()
    for (const link of deckElementLinks) {
      m.set(link.elementId, {
        knowledgeName: link.knowledgeName,
        knowledgeType: link.knowledgeType,
      })
    }
    return m
  }, [deckElementLinks])

  const linkedElementIdsBySlide = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const [slideId, links] of deckLinkIndex.bySlideId) {
      m.set(slideId, new Set(links.map(l => l.elementId)))
    }
    return m
  }, [deckLinkIndex])

  const activeSlideLinkedElementIds = linkedElementIdsBySlide.get(activeSlide?.id ?? '')

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
    padding: CANVAS_VIEWPORT_PADDING,
    columns: 1,
    gap: 0,
  })
  const canvasScale = fitScale * canvasZoom

  const handleCanvasZoomChange = useCallback(
    (z: number) => setCanvasZoom(clamp(z, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX)),
    []
  )

  useCanvasWheelZoom(canvasOverlayRef, {
    zoom: canvasZoom,
    onZoomChange: handleCanvasZoomChange,
    min: CANVAS_ZOOM_MIN,
    max: CANVAS_ZOOM_MAX,
    step: CANVAS_ZOOM_STEP,
  })

  // Flex justify-center does not center when the slide exceeds the scrollport (scroll
  // stays at 0). Re-center whenever scale, slide, or panel layout changes.
  useEffect(() => {
    const viewport = canvasViewportRef.current
    const content = canvasScrollContentRef.current
    if (!viewport) return

    const centerScroll = () => {
      requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
        viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
      })
    }

    centerScroll()
    const ro = new ResizeObserver(centerScroll)
    ro.observe(viewport)
    if (content) ro.observe(content)
    return () => ro.disconnect()
  }, [
    canvasScale,
    activeSlideId,
    effectivePendingChanges?.length,
    leftCollapsed,
    rightCollapsed,
    leftPanelWidth,
    rightPanelWidth,
  ])
  const pendingSlideIds = effectivePendingChanges ? getPendingSlideIds(effectivePendingChanges) : []
  const pendingDeletedSlideIds = effectivePendingChanges ? getDeletedSlideIds(effectivePendingChanges) : []
  const pendingHighlightedElementIds = useMemo(() => {
    if (!effectivePendingChanges || !activeSlide?.id) return []
    return [
      ...getAffectedElementIds(effectivePendingChanges, activeSlide.id),
      ...getDeletedElementIds(effectivePendingChanges, activeSlide.id),
    ]
  }, [effectivePendingChanges, activeSlide?.id])
  const selectedPendingAmendmentCount = useMemo(() => {
    if (!effectivePendingChanges || selectedElementIds.length === 0) return 0
    return filterChangesByElements(effectivePendingChanges, selectedElementIds).length
  }, [effectivePendingChanges, selectedElementIds])
  const activeSlidePendingCount = useMemo(() => {
    if (!effectivePendingChanges || !activeSlide?.id) return 0
    return countChangesBySlide(effectivePendingChanges, activeSlide.id)
  }, [effectivePendingChanges, activeSlide?.id])
  const activePendingSlideIndex = useMemo(() => {
    if (!activeSlide?.id) return -1
    return pendingSlideIds.indexOf(activeSlide.id)
  }, [pendingSlideIds, activeSlide?.id])

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
      if (amendmentCheckpoint) {
        const restored = JSON.parse(JSON.stringify(amendmentCheckpoint)) as SlideData[]
        setSlides(restored)
        slidesRef.current = restored
      }
      setAmendmentCheckpoint(null)
      setAmendmentSource(null)
      setAgentRunIncomplete(false)
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
        const branchId =
          activeBranchIdRef.current ??
          presentationSummaries.find(p => p.id === presentationId)?.branchId ??
          null
        const layerCtx = buildKnowledgeContext(knowledgeLayers, decisions, activeSlideId, {
          instruction: lastUserMessage,
          slideText: activeSlideText(slides, activeSlideId),
          // Uploaded reference docs are the source of truth — keep a useful
          // chunk (incl. table structure) rather than cutting to one sentence.
          documentCharCap: 16000,
          documentTotalCap: 32000,
        })
        const graphCtx = await fetchGraphKnowledgeContext({
          branchId,
          presentationId,
          instruction: lastUserMessage,
          charBudget: 8000,
        })
        const targetSlideIds =
          selectedSlideIds.length > 0
            ? selectedSlideIds
            : activeSlideId
              ? [activeSlideId]
              : []
        const agentPlan = await fetchAgentPlan({
          branchId,
          presentationId,
          instruction: lastUserMessage,
          targetSlideIds,
        })
        const commentsCtx = buildCommentsContext(deckComments, slides, activeSlideId, {
          instruction: lastUserMessage,
        })
        const knowledgeContext = mergeKnowledgeContexts(
          mergeKnowledgeContexts(
            mergeKnowledgeContexts(layerCtx, graphCtx),
            commentsCtx
          ),
          agentPlan?.plan_context ?? ''
        )
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
            knowledgeContext,
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

        // Safety net: single-shot asked user to list claims despite hub graph in context.
        if (
          data.type === 'clarification' &&
          !answerOnly &&
          (graphCtx.trim() || agentPlan?.has_graph_knowledge) &&
          isKnowledgeBasedEditRequest(lastUserMessage) &&
          isClarificationAskingForClaims(data.question ?? '')
        ) {
          console.log('[edit] claim-list clarification with graph context — escalating to agent')
          setDisplay(prev => [
            ...prev,
            {
              role: 'assistant',
              agentStep: {
                kind: 'note',
                label: 'Hub research is available — switching to the agent to apply claims automatically.',
              },
            },
          ])
          setIsLoading(false)
          runAgentRef.current?.(lastUserMessage, { effort: bumpEffort(effort), skipUserEcho: true })
          return
        }

        // Safety net: single-shot asked to confirm slides after user already named them.
        if (
          data.type === 'clarification' &&
          !answerOnly &&
          isClarificationAskingToConfirmSlides(data.question ?? '') &&
          (parseSlideNumbersFromText(lastUserMessage, slides.length).length > 0 ||
            !!findRecentLayoutFixTask(newHistory))
        ) {
          const nums = parseSlideNumbersFromText(lastUserMessage, slides.length)
          const prior = findRecentLayoutFixTask(newHistory) ?? lastUserMessage
          const ids =
            nums.length > 0
              ? nums.map(n => slides[n - 1]?.id).filter((id): id is string => !!id)
              : []
          const instruction =
            ids.length > 0
              ? buildSlideTargetFixInstruction(nums, ids, prior)
              : withLayoutAuditDirective(
                  `${prior}\n\nUser follow-up: ${lastUserMessage}\nDo NOT ask again — apply fixes now.`
                )
          console.log('[edit] slide-confirm clarification loop — escalating to agent')
          setDisplay(prev => [
            ...prev,
            {
              role: 'assistant',
              agentStep: {
                kind: 'note',
                label: 'Applying fixes on the slides you named — switching to the agent.',
              },
            },
          ])
          setIsLoading(false)
          runAgentRef.current?.(instruction, { effort: bumpEffort(effort), skipUserEcho: true })
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
          const checkpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
          const preview = applyChangesToSlides(checkpoint, data.changes)
          setAmendmentCheckpoint(checkpoint)
          amendmentCheckpointRef.current = checkpoint
          setAmendmentSource('single')
          amendmentSourceRef.current = 'single'
          setAgentRunIncomplete(false)
          setPendingChanges(data.changes)
          pendingChangesRef.current = data.changes
          setPendingSummary(data.summary)
          setHighlightDiffOnCanvas(true)
          setSlides(preview)
          slidesRef.current = preview

          // Jump to the first changed slide so amendments are visible immediately.
          const changedSlideIds = getPendingSlideIds(data.changes)
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
            snapshotBefore: checkpoint,
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
    [slides, activeSlideId, selectedSlideIds, selectedElementIds, knowledgeLayers, decisions, deckComments, templates, presentationId, presentationSummaries, designSystem, collectAllAssets, amendmentCheckpoint]
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

  const goToAdjacentSlide = useCallback(
    (delta: -1 | 1) => {
      const idx = slides.findIndex(s => s.id === activeSlideId)
      if (idx < 0) return
      const nextIdx = idx + delta
      if (nextIdx < 0 || nextIdx >= slides.length) return
      const id = slides[nextIdx].id
      setActiveSlideId(id)
      setSelectedSlideIds([id])
      setSelectionAnchorId(id)
      setSelectedElementIds([])
      setEditingElementId(null)
    },
    [slides, activeSlideId]
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
      const linkedOnSlide = linkedElementIdsBySlide.get(slide.id)
      const linkedSel = linkedOnSlide?.size
        ? sel.filter(e => linkedOnSlide.has(e.id))
        : sel
      const targets = linkedSel.length >= 2 ? linkedSel : sel
      if (targets.length < 2) return

      const minX = Math.min(...targets.map(e => e.x))
      const maxX = Math.max(...targets.map(e => e.x + e.w))
      const minY = Math.min(...targets.map(e => e.y))
      const maxY = Math.max(...targets.map(e => e.y + e.h))

      const updates = new Map<string, { x?: number; y?: number }>()
      if (mode === 'left') targets.forEach(e => updates.set(e.id, { x: minX }))
      else if (mode === 'right') targets.forEach(e => updates.set(e.id, { x: maxX - e.w }))
      else if (mode === 'hcenter') {
        const c = (minX + maxX) / 2
        targets.forEach(e => updates.set(e.id, { x: c - e.w / 2 }))
      } else if (mode === 'top') targets.forEach(e => updates.set(e.id, { y: minY }))
      else if (mode === 'bottom') targets.forEach(e => updates.set(e.id, { y: maxY - e.h }))
      else if (mode === 'vmiddle') {
        const c = (minY + maxY) / 2
        targets.forEach(e => updates.set(e.id, { y: c - e.h / 2 }))
      } else if (mode === 'distribute-h' && targets.length >= 3) {
        const sorted = [...targets].sort((a, b) => a.x - b.x)
        const totalW = sorted.reduce((s, e) => s + e.w, 0)
        const gap = (maxX - minX - totalW) / (sorted.length - 1)
        let cursor = minX
        sorted.forEach(e => {
          updates.set(e.id, { x: cursor })
          cursor += e.w + gap
        })
      } else if (mode === 'distribute-v' && targets.length >= 3) {
        const sorted = [...targets].sort((a, b) => a.y - b.y)
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
    [slides, activeSlideId, selectedElementIds, linkedElementIdsBySlide, pushHistory]
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
        designSystem: designSystemRef.current,
      }
      if (!action.isAvailable(ctx)) return
      incompleteAgentContextRef.current = null
      setAgentRunIncomplete(false)
      const scopedSlideIds = action.deckWide ? [] : resolveQuickActionTargetSlideIds(ctx)
      const scopedCtx: QuickActionContext = {
        ...ctx,
        selectedSlideIds: scopedSlideIds.length ? scopedSlideIds : ctx.selectedSlideIds,
        activeSlideId: scopedSlideIds[0] ?? ctx.activeSlideId,
        activeSlideIndex:
          scopedSlideIds[0] != null
            ? ctx.slides.findIndex(s => s.id === scopedSlideIds[0])
            : ctx.activeSlideIndex,
      }
      const instruction = action.buildInstruction(scopedCtx)
      if (scopedSlideIds.length > 0) {
        setSelectedSlideIds(scopedSlideIds)
        setSelectionAnchorId(scopedSlideIds[0])
      }
      const checkpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
      const historyLength = conversationHistory.length
      setConversationHistory(prev => [...prev, { role: 'user', content: instruction, historyLength: prev.length }])
      runAgentRef.current?.(instruction, {
        effort: action.effort ?? 'medium',
        checkpoint,
        historyLength,
        scopedSlideIds: scopedSlideIds.length ? scopedSlideIds : undefined,
        uiScopeAuthoritative: scopedSlideIds.length > 0,
        deckWide: action.deckWide,
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

  const applyDesignSystemToDeck = useCallback(() => {
    if (isLoading || isAgentRunning || !canEdit || !!pendingChanges) return
    const ds = designSystemRef.current
    if (!ds || ds.files.length === 0 || slides.length === 0) return

    incompleteAgentContextRef.current = null
    setAgentRunIncomplete(false)
    const instruction = buildApplyDesignSystemToDeckInstruction(ds, slides.length)
    const checkpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
    const historyLength = conversationHistory.length
    setConversationHistory(prev => [
      ...prev,
      { role: 'user', content: instruction, historyLength: prev.length },
    ])
    setShowDesignSystem(false)
    runAgentRef.current?.(instruction, {
      effort: 'high',
      checkpoint,
      historyLength,
      deckWide: true,
    })
  }, [isLoading, isAgentRunning, canEdit, pendingChanges, slides, conversationHistory])

  const handleSend = useCallback(
    async (text: string, images: string[] = [], _uiMode: UiMode = 'agent') => {
     if (!canEdit) {
       setDisplay(prev => [
         ...prev,
         {
           role: 'assistant',
           response: {
             type: 'clarification',
             question:
               'You have view-only access to this hub. Ask an owner to make you an editor to edit decks, or a moderator to manage knowledge.',
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

      // ── Continue: resume an interrupted agent run (layout audit, step limit, timeout) ──
      if (isAgentContinuationMessage(text)) {
        const modifiedFromPending = pendingChanges ? getPendingSlideIds(pendingChanges) : []
        if (agentPauseStateRef.current) {
          const ps = agentPauseStateRef.current
          const agentCheckpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
          const agentHistoryLength = conversationHistory.length
          setConversationHistory(prev => [
            ...prev,
            { role: 'user', content: text, historyLength: prev.length },
          ])
          setDisplay(prev => [
            ...prev,
            { role: 'user', text, checkpoint: agentCheckpoint, historyLength: agentHistoryLength, ...messageActorFields() },
          ])
          runAgentRef.current?.(ps.originalInstruction, {
            effort: (ps.agentEffort as Effort) ?? 'high',
            continuation: true,
            resumeFromPause: true,
            skipUserEcho: true,
          })
          return
        }
        const ctx =
          incompleteAgentContextRef.current ??
          recoverIncompleteContextFromHistory(conversationHistory, modifiedFromPending)
        if (ctx || agentRunIncomplete || modifiedFromPending.length > 0) {
          let resolved: IncompleteAgentContext = ctx ?? {
            originalInstruction:
              [...conversationHistory].reverse().find(m => m.role === 'user' && !isAgentContinuationMessage(m.content))
                ?.content ?? 'Finish the previous editing task',
            modifiedSlideIds: modifiedFromPending,
            targetSlideIds: [],
            lastAction: agentProgressRef.current.lastAction,
            wasLayoutAudit: isLayoutAuditChangeRequest(
              [...conversationHistory].reverse().find(m => m.role === 'user' && !isAgentContinuationMessage(m.content))
                ?.content ?? ''
            ),
            deckWide: false,
          }
          if (modifiedFromPending.length && !resolved.modifiedSlideIds.length) {
            resolved.modifiedSlideIds = modifiedFromPending
          }
          if (
            resolved.wasLayoutAudit ||
            isLayoutAuditChangeRequest(resolved.originalInstruction)
          ) {
            const reopened = reopenFailedLayoutPatches(slides, resolved)
            resolved = { ...resolved, ...reopened, wasLayoutAudit: true }
          }
          incompleteAgentContextRef.current = resolved
          const allSlideIds = slides.map(s => s.id)
          const dsForAlign =
            designSystemRef.current && designSystemRef.current.files.length > 0
              ? designSystemRef.current
              : null
          const deckDesignAlignment = dsForAlign
            ? formatDesignSystemDeckAlignmentBlock(dsForAlign)
            : undefined
          const resumeInstruction =
            (resolved.deckWide || isDeckBuildResumeTask(resolved.originalInstruction)) &&
            !resolved.wasLayoutAudit
              ? buildDeckBuildContinuationInstruction(
                  resolved.originalInstruction,
                  slides.length,
                  allSlideIds,
                  deckDesignAlignment
                )
              : buildAgentContinuationInstruction(resolved, allSlideIds)
          const agentCheckpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
          const agentHistoryLength = conversationHistory.length
          setConversationHistory(prev => [
            ...prev,
            { role: 'user', content: text, historyLength: prev.length },
          ])
          setDisplay(prev => [
            ...prev,
            { role: 'user', text, checkpoint: agentCheckpoint, historyLength: agentHistoryLength, ...messageActorFields() },
          ])
          runAgentRef.current?.(resumeInstruction, {
            effort:
              resolved.deckWide || isDeckBuildResumeTask(resolved.originalInstruction)
                ? 'high'
                : 'medium',
            continuation: true,
            skipUserEcho: true,
          })
          return
        }
      }

      // ── Slide-number follow-up: user answered "14 and 15" etc. after a layout fix thread ──
      const slideNums = parseSlideNumbersFromText(text, slides.length)
      const priorLayoutTask = findRecentLayoutFixTask(conversationHistory)
      if (
        slideNums.length > 0 &&
        isShortSlideTargetAnswer(text, slideNums) &&
        priorLayoutTask
      ) {
        const slideIds = slideNums.map(n => slides[n - 1]?.id).filter((id): id is string => !!id)
        if (slideIds.length > 0) {
          const agentInstruction = buildSlideTargetFixInstruction(
            slideNums,
            slideIds,
            priorLayoutTask
          )
          setSelectedSlideIds(slideIds)
          setActiveSlideId(slideIds[0])
          setSelectionAnchorId(slideIds[0])
          const agentCheckpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
          const agentHistoryLength = conversationHistory.length
          setConversationHistory(prev => [
            ...prev,
            { role: 'user', content: text, historyLength: prev.length },
          ])
          setDisplay(prev => [
            ...prev,
            { role: 'user', text, checkpoint: agentCheckpoint, historyLength: agentHistoryLength, ...messageActorFields() },
          ])
          runAgentRef.current?.(agentInstruction, {
            effort: 'medium',
            skipUserEcho: true,
          })
          return
        }
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
      const titleAlignFix = isTitleAlignmentFixRequest(text)
      const isAsk = cls.mode === 'ask' && !titleAlignFix && !isLayoutAuditChangeRequest(text)

      // ── Scope disambiguation ──
      if (
        !isAsk &&
        !annotatedImage &&
        images.length === 0 &&
        cls.scope === 'ask'
      ) {
        setPendingScopeInstruction(text)
        const scopeCheckpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
        const scopeHistoryLength = conversationHistory.length
        setDisplay(prev => [
          ...prev,
          { role: 'user', text, checkpoint: scopeCheckpoint, historyLength: scopeHistoryLength, ...messageActorFields() },
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

      const effort: Effort = cls.effort === 'low' ? 'medium' : cls.effort

      console.log(
        `[router] "${text.slice(0, 60)}" → agent${isAsk ? ' (answer-only)' : ''} · effort=${effort}`
      )

      incompleteAgentContextRef.current = null
      setAgentRunIncomplete(false)
      const agentCheckpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
      const agentHistoryLength = conversationHistory.length
      setConversationHistory(prev => [
        ...prev,
        { role: 'user', content: text, historyLength: prev.length, ...messageActorFields() },
      ])

      const agentInstruction = isAsk
        ? `[ANSWER ONLY — NOT AN EDIT]\nThe user wants information, not slide changes. ` +
          `You may call get_slide/get_slides to read context. Do NOT call apply_changes. ` +
          `Call finish with a clear, helpful answer in summary.\n\nUser question: ${text}`
        : titleAlignFix
          ? formatTitleAlignmentDirective(text)
          : (() => {
            const ds = designSystemRef.current
            if (ds?.files.length && isDeckWideDesignSystemRequest(text)) {
              return buildDesignSystemAlignmentFromUserNote(ds, slides.length, text)
            }
            return text
          })()

      if (!isAsk && isNewDeckBuildRequest(text) && !parsePresentationScope(text)) {
        setPendingAgentInstruction(agentInstruction)
        setDisplay(prev => [
          ...prev,
          {
            role: 'user',
            text,
            checkpoint: agentCheckpoint,
            historyLength: agentHistoryLength,
            ...messageActorFields(),
          },
          {
            role: 'assistant',
            response: {
              type: 'clarification',
              question:
                'Before building from your documents, choose how comprehensive the presentation should be:',
              questions: [PRESENTATION_DEPTH_QUESTION],
            },
          },
        ])
        return
      }

      runAgentRef.current?.(agentInstruction, {
        effort: isAsk
          ? 'medium'
          : isDesignSystemAlignmentRequest(text) || isLayoutAuditChangeRequest(text)
            ? 'high'
            : effort,
        checkpoint: agentCheckpoint,
        historyLength: agentHistoryLength,
        answerOnly: isAsk,
        displayText: text,
        deckWide: isDeckWideDesignSystemRequest(text) ? true : undefined,
        ...(() => {
          if (
            isAsk ||
            !isLayoutAuditChangeRequest(text) ||
            isDeckWideLayoutAudit(text) ||
            isDeckWideInstruction(text)
          ) {
            return {}
          }
          const explicitNums = parseSlideNumbersFromText(text, slides.length)
          const explicitSlideIds = parseSlideIdsFromText(text).filter(id =>
            slides.some(s => s.id === id)
          )
          if (explicitNums.length > 0 || explicitSlideIds.length > 0) return {}
          const scoped = resolveQuickActionTargetSlideIds({
            slides,
            activeSlideId,
            activeSlideIndex: slides.findIndex(s => s.id === activeSlideId),
            selectedSlideIds,
            selectedElementIds,
          })
          if (!scoped.length) return {}
          return { scopedSlideIds: scoped, uiScopeAuthoritative: true as const }
        })(),
      })

      if (annotatedImage) {
        setStrokes([])
        setAnnotationMode(false)
      }
     } catch (err) {
       // A failure here used to silently vanish (and take the user's message with
       // it). Now: log loudly to the terminal, restore the text to the input so it
       // ISN'T lost, and tell the user what happened.
       setIsLoading(false)
       reportClientError('handleSend', err, { text: text.slice(0, 200) })
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
    [conversationHistory, callApi, strokes, slides, selectedElementIds, selectedSlideIds, isAgentRunning, canEdit, agentRunIncomplete, pendingChanges]
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
        ...versionActorFields(),
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
      opts?: {
        effort?: Effort
        skipUserEcho?: boolean
        checkpoint?: SlideData[]
        historyLength?: number
        continuation?: boolean
        /** Sidebar/quick-action slide scope — authoritative over instruction text parsing. */
        scopedSlideIds?: string[]
        uiScopeAuthoritative?: boolean
        deckWide?: boolean
        /** Resume the exact agent message thread from a pipeline pause. */
        resumeFromPause?: boolean
        /** Q&A — no deck edits; show a clean prose answer in chat. */
        answerOnly?: boolean
        /** User-visible message text (without agent directives). */
        displayText?: string
      }
    ) => {
      // Re-entrancy guard: only block on the agent's OWN in-flight flag. Do NOT
      // gate on isLoading — handleSend briefly sets isLoading(true) while the
      // router classifies, and reading that (stale, via the ref closure) here made
      // every agent-routed message silently bail: the bubble never rendered and
      // nothing hit the server. isLoading is the single-shot/router indicator.
      if (isAgentRunning || !instruction.trim()) return
      if (!canEdit) return
      const isContinuation =
        opts?.continuation === true || opts?.resumeFromPause === true
      const restoringPause = opts?.resumeFromPause === true && !!agentPauseStateRef.current
      if (!isContinuation && !opts?.resumeFromPause) {
        agentPauseStateRef.current = null
      }
      const agentInstruction = isContinuation
        ? instruction.trim()
        : withLayoutAuditDirective(instruction.trim())

      // Central gate: every agent entry (router, self-escalation, quick actions) must
      // pick presentation depth before building a new deck from source material.
      if (
        !isContinuation &&
        isNewDeckBuildRequest(agentInstruction) &&
        !parsePresentationScope(agentInstruction)
      ) {
        setPendingAgentInstruction(agentInstruction)
        setDisplay(prev => [
          ...prev,
          {
            role: 'assistant',
            response: {
              type: 'clarification',
              question:
                'Before building from your documents, choose how comprehensive the presentation should be:',
              questions: [PRESENTATION_DEPTH_QUESTION],
            },
          },
        ])
        return
      }

      const priorCtxForScope = incompleteAgentContextRef.current
      const scopeSource =
        isContinuation && priorCtxForScope?.originalInstruction
          ? `${priorCtxForScope.originalInstruction}\n${agentInstruction}`
          : agentInstruction
      const parsedScopeForBuild = parsePresentationScope(scopeSource)
      const deckBuildResume =
        isContinuation &&
        !!priorCtxForScope &&
        (priorCtxForScope.deckWide || isDeckBuildResumeTask(priorCtxForScope.originalInstruction)) &&
        !!parsedScopeForBuild &&
        !priorCtxForScope.wasLayoutAudit &&
        !isLayoutAuditChangeRequest(priorCtxForScope.originalInstruction)
      let deckBuildWithScope =
        (isNewDeckBuildRequest(agentInstruction) && !!parsePresentationScope(agentInstruction)) ||
        deckBuildResume ||
        (restoringPause && !!agentPauseStateRef.current?.deckBuildWithScope)

      let layoutAuditRun =
        isLayoutAuditChangeRequest(agentInstruction) ||
        (isContinuation && incompleteAgentContextRef.current?.wasLayoutAudit === true)
      const deckWideLayoutAudit =
        isDeckWideLayoutAudit(agentInstruction) ||
        (isContinuation && incompleteAgentContextRef.current?.deckWide === true)
      let geometryOnlyRun = isGeometryEditRequest(agentInstruction)
      if (restoringPause && agentPauseStateRef.current) {
        const ps = agentPauseStateRef.current
        deckBuildWithScope = ps.deckBuildWithScope
        layoutAuditRun = ps.layoutAuditRun
        geometryOnlyRun = ps.geometryOnlyRun
      }
      const layoutFixTask =
        layoutAuditRun ||
        geometryOnlyRun ||
        isLayoutAuditChangeRequest(
          (isContinuation && priorCtxForScope?.originalInstruction
            ? priorCtxForScope.originalInstruction
            : agentInstruction) ?? ''
        )
      const routedEffort: Effort = opts?.effort ?? 'medium'
      agentStopRef.current = false // reset cancellation flag for this run
      amendmentsCommittedRef.current = false
      isAgentRunningRef.current = true
      setIsAgentRunning(true)

      const answerOnly = opts?.answerOnly === true
      let beforeRun: SlideData[]

      if (isContinuation) {
        // Keep live canvas + pending amendments from the interrupted run.
        beforeRun =
          amendmentCheckpoint ??
          (JSON.parse(JSON.stringify(slidesRef.current)) as SlideData[])
        if (!amendmentCheckpoint) {
          setAmendmentCheckpoint(beforeRun)
          setAmendmentSource('agent')
        }
        if (restoringPause && agentPauseStateRef.current) {
          incompleteAgentContextRef.current = agentPauseStateRef.current.incompleteContext
        }
        agentProgressRef.current = {
          applyBatches: 0,
          changedSlideIds: new Set(incompleteAgentContextRef.current?.modifiedSlideIds ?? []),
          lastAction: incompleteAgentContextRef.current?.lastAction ?? '',
        }
        setAgentRunIncomplete(false)
      } else if (answerOnly) {
        // Q&A — never discard an in-progress amendment review or version checkpoint.
        beforeRun = JSON.parse(JSON.stringify(slidesRef.current)) as SlideData[]
        agentProgressRef.current = {
          applyBatches: 0,
          changedSlideIds: new Set<string>(),
          lastAction: '',
        }
      } else {
        incompleteAgentContextRef.current = null
        if (amendmentCheckpoint) {
          const restored = JSON.parse(JSON.stringify(amendmentCheckpoint)) as SlideData[]
          setSlides(restored)
          slidesRef.current = restored
        }
        setAmendmentCheckpoint(null)
        setAmendmentSource(null)
        setAgentRunIncomplete(false)
        setPendingChanges(null)
        pendingChangesRef.current = null
        pushHistory()

        beforeRun = JSON.parse(JSON.stringify(slidesRef.current)) as SlideData[]
        closeManualSession(beforeRun)
        setAmendmentCheckpoint(beforeRun)
        amendmentCheckpointRef.current = beforeRun
        setAmendmentSource('agent')
        amendmentSourceRef.current = 'agent'
        pendingChangesRef.current = []
        agentProgressRef.current = {
          applyBatches: 0,
          changedSlideIds: new Set<string>(),
          lastAction: '',
        }
        incompleteAgentContextRef.current = {
          originalInstruction: agentInstruction,
          modifiedSlideIds: [],
          targetSlideIds: [],
          lastAction: '',
          wasLayoutAudit: layoutAuditRun || geometryOnlyRun,
          deckWide: deckWideLayoutAudit || opts?.deckWide === true || deckBuildWithScope,
        }
      }

      let runSummary = ''
      let totalSkipped = 0
      let runFinishedCleanly = false

      // When callApi self-escalates, the user's message bubble is already shown.
      // Otherwise echo it WITH a checkpoint so it gets the same edit/revert button
      // as single-shot messages (Cursor-style: edit a past message → rewind here).
      if (!opts?.skipUserEcho) {
        const userDisplayText =
          opts?.displayText?.trim() || stripUserFacingInstruction(agentInstruction)
        setDisplay(prev => [
          ...prev,
          {
            role: 'user',
            text: userDisplayText,
            ...messageActorFields(),
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
      const explicitNums = parseSlideNumbersFromText(agentInstruction, deckSlides.length)
      const explicitIds =
        explicitNums.length > 0
          ? explicitNums.map(n => deckSlides[n - 1]?.id).filter((id): id is string => !!id)
          : []

      const priorCtx = incompleteAgentContextRef.current
      const uiScopedSlideIds = isContinuation ? undefined : opts?.scopedSlideIds
      const uiScopeAuthoritative =
        !isContinuation && opts?.uiScopeAuthoritative === true && !!uiScopedSlideIds?.length
      const workScope: AgentWorkScope = resolveAgentWorkScope({
        instruction: agentInstruction,
        slides: deckSlides,
        activeSlideId,
        selectedSlideIds: uiScopedSlideIds?.length ? uiScopedSlideIds : selectedSlideIds,
        forcedSlideIds: uiScopedSlideIds,
        uiAuthoritativeScope: uiScopeAuthoritative,
        geometryOnly: geometryOnlyRun,
        deckWide:
          deckWideLayoutAudit ||
          opts?.deckWide === true ||
          (isContinuation && priorCtx?.deckWide === true) ||
          deckBuildWithScope ||
          (isDesignSystemAlignmentRequest(agentInstruction) &&
            isDeckWideDesignSystemRequest(agentInstruction)),
        layoutAudit: layoutAuditRun,
        alreadyDoneSlideIds: deckBuildWithScope
          ? deckSlides.map(s => s.id)
          : isContinuation
            ? priorCtx?.modifiedSlideIds
            : undefined,
        priorTargetSlideIds: deckBuildWithScope
          ? undefined
          : isContinuation
            ? priorCtx?.targetSlideIds
            : undefined,
      })

      if (incompleteAgentContextRef.current) {
        incompleteAgentContextRef.current.targetSlideIds = workScope.targetSlideIds
      }

      // Ground "these / selected / slide N" references: the model only ever sees
      // slide IDs in tool calls, but the user thinks in 1-based positions and in
      // terms of the current multi-selection.
      const effectiveSelectedIds = uiScopedSlideIds?.length
        ? uiScopedSlideIds
        : selectedSlideIds
      let selectionContext = ''
      const designSystemAlign = isDesignSystemAlignmentRequest(agentInstruction)
      const deckWideDesignSystem = isDeckWideDesignSystemRequest(agentInstruction)
      if (deckBuildWithScope && !layoutAuditRun) {
        const scope = parsedScopeForBuild!
        const max = effectiveSlideLimit(scope)
        selectionContext =
          `DECK BUILD (${scope}): Build up to ${max} slides total from the knowledge graph. ` +
          `Add 1–2 slides per apply_changes. ` +
          (isContinuation
            ? 'Do NOT delete or rebuild slides marked COMPLETED in the CONTINUE block.\n'
            : 'Start with a cover/hub slide, then add section slides.\n')
      } else if (designSystemAlign) {
        const patchIds =
          workScope.remainingSlideIds.length > 0
            ? workScope.remainingSlideIds
            : workScope.targetSlideIds
        const deckWideDs = isDeckWideDesignSystemRequest(agentInstruction)
        selectionContext =
          deckWideDs
            ? `DESIGN SYSTEM ALIGNMENT (deck-wide): ${deckSlides.length} slide(s). ` +
              `Apply tokens on ALL slides in batches of 2–4.\n`
            : `DESIGN SYSTEM ALIGNMENT (scoped): ${patchIds.length} slide(s) — ${patchIds.map(describeId).join(', ')}.\n` +
              `Apply slidePatch.bg + style.fontFace + style.color + style.bg on ONLY these slide(s). ` +
              `Do NOT touch other slides.\n` +
              `Call get_slides with slideIds: [${patchIds.map(id => `"${id}"`).join(', ')}]. ` +
              `Do NOT nudge x/y/w/h — styling only.\n`
      } else if (workScope.remainingSlideIds.length > 0 || workScope.targetSlideIds.length > 0) {
        const executeIds = workScope.remainingSlideIds.length
          ? workScope.remainingSlideIds
          : workScope.targetSlideIds
        selectionContext =
          `WORK SCOPE LOCK: Only ${executeIds.length} slide(s) need changes for this task. ` +
          `Targets: ${executeIds.map(describeId).join(', ')}. ` +
          `Call get_slides with slideIds: [${executeIds.map(id => `"${id}"`).join(', ')}]. ` +
          `Do NOT read or patch other slides.\n`
      } else if (deckWideLayoutAudit) {
        selectionContext =
          `SCOPE: Layout audit — pre-scan found no remaining issues. Verify active slide only.\n`
      } else if (explicitIds.length > 0) {
        selectionContext =
          `EXPLICIT TARGET: User named slide position(s) ${explicitNums.join(', ')}. ` +
          `Operate ONLY on: ${explicitIds.map(describeId).join(', ')}. ` +
          `Call get_slides with slideIds: [${explicitIds.map(id => `"${id}"`).join(', ')}]. ` +
          `Do NOT ask which slides — they already told you.\n`
      } else if (effectiveSelectedIds.length > 0) {
        selectionContext =
          `The user currently has ${effectiveSelectedIds.length} slide(s) MULTI-SELECTED: ` +
          `${effectiveSelectedIds.map(describeId).join(', ')}.\n` +
          `If the instruction refers to "these/those slides", "the selected slides", "this slide", ` +
          `or otherwise omits explicit slide numbers, target EXACTLY these slide IDs — nothing else.\n`
      } else {
        selectionContext = `Active slide: ${describeId(activeSlideId)} (no multi-selection).\n`
      }

      const workScopeBlock = formatAgentWorkScopeBlock(deckSlides, workScope, isContinuation)

      const scopedSlideCount =
        workScope.remainingSlideIds.length ||
        workScope.targetSlideIds.length ||
        explicitIds.length ||
        1
      const fastLayoutRun = false
      const agentEffort: Effort =
        deckBuildWithScope
          ? routedEffort === 'low' || routedEffort === 'medium'
            ? 'high'
            : routedEffort
          : designSystemAlign
            ? routedEffort === 'low' || routedEffort === 'medium'
              ? 'high'
              : routedEffort
          : fastLayoutRun
            ? 'medium'
            : layoutAuditRun &&
                (routedEffort === 'high' || routedEffort === 'xhigh' || routedEffort === 'max')
              ? 'medium'
              : routedEffort

      const activeSlideForIntro = deckSlides.find(s => s.id === activeSlideId)
      const selectedOverlapNote =
        activeSlideForIntro && selectedElementIds.length >= 2
          ? (() => {
              const hits = findOverlapsAmong(selectedElementIds, activeSlideForIntro)
              if (!hits.length) return ''
              return (
                `SELECTED ELEMENT OVERLAP (user highlighted these — fix on canvas):\n` +
                `${formatLayoutIssues(hits)}\n`
              )
            })()
          : ''

      const agentBranchId =
        activeBranchIdRef.current ??
        presentationSummaries.find(p => p.id === presentationId)?.branchId ??
        null
      const planInstruction =
        isContinuation && incompleteAgentContextRef.current
          ? incompleteAgentContextRef.current.originalInstruction
          : agentInstruction
      const skipKnowledgePipeline =
        isGeometryEditRequest(planInstruction) || answerOnly
      const layerCtx = buildKnowledgeContext(knowledgeLayers, decisions, activeSlideId, {
        instruction: planInstruction,
        slideText: activeSlideText(slidesRef.current, activeSlideId),
        documentCharCap: skipKnowledgePipeline ? 0 : 200000,
        documentTotalCap: skipKnowledgePipeline ? 0 : 240000,
      })
      const graphCtx = skipKnowledgePipeline
        ? ''
        : await fetchGraphKnowledgeContext({
            branchId: agentBranchId,
            presentationId,
            instruction: planInstruction,
            charBudget: 16000,
          })
      const planTargetSlideIds = deckBuildWithScope
        ? deckSlides.map(s => s.id)
        : uiScopedSlideIds?.length
          ? uiScopedSlideIds
          : workScope.targetSlideIds.length
            ? workScope.targetSlideIds
            : effectiveSelectedIds.length > 0
              ? effectiveSelectedIds
              : activeSlideId
                ? [activeSlideId]
                : []
      const agentPlan = skipKnowledgePipeline
        ? null
        : await fetchAgentPlan({
            branchId: agentBranchId,
            presentationId,
            instruction: planInstruction,
            targetSlideIds: planTargetSlideIds,
          })
      const semanticEditPlan: SemanticEditPlan | null = agentPlan?.semantic_edit_plan ?? null
      const approvalRequired = agentPlan?.orchestrator.approval_required ?? false
      const commentsCtx = buildCommentsContext(
        deckCommentsRef.current,
        slidesRef.current,
        activeSlideId,
        { instruction: planInstruction }
      )
      const knowledgeContext = skipKnowledgePipeline
        ? commentsCtx
        : mergeKnowledgeContexts(mergeKnowledgeContexts(layerCtx, graphCtx), commentsCtx)
      const templateKnowledge = fastLayoutRun ? '' : mergeTemplatesKnowledge(templates)
      const mediaCtx = fastLayoutRun ? '' : buildMediaContext(mediaManifest(collectAllAssets()))

      const slideIndexForIntro =
        fastLayoutRun && workScope.targetSlideIds.length
          ? workScope.targetSlideIds
              .map(id => {
                const i = deckSlides.findIndex(s => s.id === id)
                if (i < 0) return id
                const s = deckSlides[i]
                const title =
                  s.elements.find(e => e.type === 'text' && e.content?.trim())?.content?.slice(0, 40) ??
                  ''
                return `${i + 1}. ${s.id} · ${s.elements.length} elements${title ? ` · "${title}"` : ''}`
              })
              .join('\n')
          : slideIndex

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

      const newRequestOverride =
        !isContinuation && opts?.scopedSlideIds?.length
          ? `NEW REQUEST OVERRIDE — UI SELECTED SLIDES (${opts.scopedSlideIds.length}): ` +
            `${opts.scopedSlideIds.map(describeId).join(', ')}. ` +
            `Execute ONLY on these — ignore prior [INCOMPLETE] work and all other slides.\n\n`
          : !isContinuation && explicitIds.length > 0
          ? `NEW REQUEST OVERRIDE — SUPERSEDES PRIOR INCOMPLETE: User named specific slide(s) in this message: ` +
            `${explicitIds.map(describeId).join(', ')}. Execute ONLY these targets. ` +
            `Ignore any prior assistant [INCOMPLETE] turns or unfinished work on other slides.\n\n`
          : !isContinuation && workScope.targetSlideIds.length > 0 && layoutAuditRun
            ? `NEW REQUEST OVERRIDE — SUPERSEDES PRIOR INCOMPLETE: Layout fix scoped to ` +
              `${workScope.targetSlideIds.map(id => describeId(id)).join(', ')}. ` +
              `Do NOT continue patching slides outside this scope from earlier incomplete runs.\n\n`
            : ''

      const deckSlideCap = deckBuildWithScope
        ? effectiveSlideLimit(parsedScopeForBuild!)
        : 0

      const dsForAlign =
        designSystemRef.current && designSystemRef.current.files.length > 0
          ? designSystemRef.current
          : null
      const deckDesignAlignment = dsForAlign
        ? formatDesignSystemDeckAlignmentBlock(dsForAlign)
        : undefined
      const deckDesignApplyExisting =
        designSystemAlign && dsForAlign
          ? deckWideDesignSystem
            ? formatDesignSystemApplyExistingBlock(dsForAlign)
            : formatDesignSystemApplyScopedBlock(
                dsForAlign,
                workScope.targetSlideIds.length
                  ? workScope.targetSlideIds
                  : [activeSlideId].filter((id): id is string => !!id)
              )
          : undefined

      const intro =
        newRequestOverride +
        `User instruction: "${agentInstruction}"\n\n` +
        (recentTranscript
          ? `RECENT CONVERSATION (context for follow-ups — if the current instruction refers to an ` +
            `earlier request like "I asked you to…", "do that across all slides", "the whole deck", ` +
            `resolve what "that" means from here and carry out the ORIGINAL intent across the requested scope):\n` +
            `${recentTranscript}\n\n`
          : '') +
        `Deck overview (NUMBER. id — the leading number is the slide's 1-based position):\n${slideIndexForIntro}\n\n` +
        `${selectionContext}` +
        (selectedOverlapNote ? `${selectedOverlapNote}\n` : '') +
        `Active slide: ${describeId(activeSlideId)}${activeIdx >= 0 ? '' : ''}. ` +
        `Selected elements: ${selectedElementIds.join(', ') || 'none'}.\n` +
        `IMPORTANT: When the user says "slide N", N is the 1-based position above — map it to the ` +
        `matching slide ID before calling any tool. Never assume the ID's own number equals its position.\n` +
        (knowledgeContext
          ? `\nFollow this knowledge & design system as the source of truth:\n${knowledgeContext}\n`
          : '') +
        (mediaCtx ? `\n${mediaCtx}\n` : '') +
        (templateKnowledge ? `\nReference template styling:\n${templateKnowledge}\n` : '') +
        (agentPlan?.plan_context ? `\n${agentPlan.plan_context}\n` : '') +
        (workScopeBlock && !deckBuildWithScope ? `\n${workScopeBlock}\n` : '') +
        (deckDesignApplyExisting ? `\n${deckDesignApplyExisting}\n` : '') +
        (designSystemAlign
          ? deckWideDesignSystem
            ? `\nDESIGN SYSTEM TASK (deck-wide): Restyle ALL slides with tokens above. Geometry frozen.\n`
            : `\nDESIGN SYSTEM TASK (scoped): Restyle ONLY slides in work scope. Do NOT touch other slides. Geometry frozen.\n`
          : '') +
        (deckBuildWithScope
          ? `\n${formatDeckBuildExecuteBlock(
              parsedScopeForBuild!,
              deckSlides.length,
              workScope.alreadyDoneSlideIds,
              deckDesignAlignment
            )}\n`
          : isNewDeckBuildRequest(agentInstruction) && !parsePresentationScope(agentInstruction)
            ? `\n${formatScopeGateNote()}\n`
            : '') +
        ((() => {
          const scope = parsePresentationScope(agentInstruction)
          return scope ? `\n${formatPresentationScopeNote(scope)}\n` : ''
        })()) +
        (deckBuildWithScope
          ? `\nDECK BUILD: Add 2–3 NEW slides per apply_changes until slide count reaches the cap, then render 1–2 slides and finish. Do NOT rebuild or delete existing slides.${
              deckDesignAlignment
                ? ' Apply the loaded design system (bg, fonts, semantic colors) on every new slide.'
                : ''
            }`
          : `\nIf the instruction covers MULTIPLE slides (e.g. "all slides", "slides 2–5", the selection, ` +
            `the whole deck), read them all with get_slides (omit slideIds for the whole deck), then apply ONE ` +
            `combined apply_changes covering every target slide, render 1–2 to verify, then finish. ` +
            `For a single slide use get_slide → apply_changes → verify → finish.`) +
        (layoutAuditRun
          ? `\n\nLAYOUT AUDIT: Scope is pre-computed above — execute ONLY on listed slides. ` +
            `get_slides with scoped slideIds (NOT the full deck). Batch apply_changes 2–4 scoped slides per call. ` +
            `Geometry patches only (x, y, w, h, index). Align header/title icons to the SAME x/y across all scoped slides.`
          : '') +
        (isTitleAlignmentFixRequest(agentInstruction)
          ? `\n\nTITLE ALIGNMENT: patch ONLY header-main (or the slide title element) — y≈0.45in to match other content slides. No icons/bullets/underlines.\n`
          : '');

      let messages: AgentMessage[]
      let loopStartStep = 0

      const deckBuild = isNewDeckBuildRequest(agentInstruction)
      let presentationScope = parsedScopeForBuild
      let scopeConfirmed = !!presentationScope
      let introCompressed = false

      let answerProse = ''
      const addStep = (step: NonNullable<DisplayMessage['agentStep']>) => {
        if (answerOnly) {
          if (step.kind === 'plan') return
          if (step.kind === 'done') {
            if (step.label?.trim() && !answerProse) answerProse = step.label.trim()
            return
          }
          if (step.kind === 'note') {
            if (step.label?.trim()) answerProse = step.label.trim()
            return
          }
          if (step.kind === 'thinking') {
            setDisplay(prev => [
              ...prev,
              { role: 'assistant', agentStep: { ...step, processSection: 'reasoning' } },
            ])
            return
          }
          if (step.kind === 'read' || step.kind === 'render') {
            setDisplay(prev => [
              ...prev,
              { role: 'assistant', agentStep: { ...step, processSection: 'activity' } },
            ])
            return
          }
        }
        setDisplay(prev => [...prev, { role: 'assistant', agentStep: step }])
      }

      if (restoringPause && agentPauseStateRef.current) {
        const ps = agentPauseStateRef.current
        messages = cloneMessages(ps.messages) as AgentMessage[]
        loopStartStep = ps.nextStep
        introCompressed = ps.introCompressed
        presentationScope = ps.presentationScope
        scopeConfirmed = !!presentationScope
        messages.push({ role: 'user', content: buildAgentResumeNote(ps) })
        addStep({
          kind: 'plan',
          label: `Resuming pipeline — ${ps.reasonLabel} (step ${loopStartStep + 1}, full context kept)`,
        })
      } else {
        messages = [{ role: 'user', content: intro }]
      }

      if (deckBuildWithScope && !isContinuation) {
        addStep({
          kind: 'plan',
          label: `Deck build: ${presentationScope} — up to ${deckSlideCap} slides (batch 2–3 per apply)`,
        })
      }

      if (
        agentPlan?.has_graph_knowledge &&
        semanticEditPlan &&
        !isContinuation &&
        isKnowledgeBasedEditRequest(planInstruction)
      ) {
        const claimCount = semanticEditPlan.claims_to_use.length
        const metricCount = semanticEditPlan.metrics_to_use.length
        addStep({
          kind: 'plan',
          label:
            `Knowledge plan: ${claimCount} claim(s), ${metricCount} metric(s)` +
            (semanticEditPlan.risk_flags.length
              ? ` · ${semanticEditPlan.risk_flags.length} risk flag(s)`
              : '') +
            (approvalRequired ? ' · human approval recommended' : ''),
        })
      }

      if (workScope.targetSlideIds.length > 0 && (layoutAuditRun || (isContinuation && !deckBuildWithScope))) {
        const scopeIds = workScope.remainingSlideIds.length
          ? workScope.remainingSlideIds
          : workScope.targetSlideIds
        addStep({
          kind: 'plan',
          label:
            `Work scope: ${scopeIds.length} slide(s) — ${scopeIds
              .map(id => describeId(id))
              .join(', ')}` +
            (workScope.alreadyDoneSlideIds.length
              ? ` · ${workScope.alreadyDoneSlideIds.length} already done`
              : '') +
            (Object.keys(workScope.issueBySlideId).length
              ? ` · ${Object.keys(workScope.issueBySlideId).length} with detected issues`
              : ''),
        })
      }

      // Bounded "act, don't hang" recovery: if a turn returns no tool call we
      // nudge the model to act instead of silently stopping.
      let nudges = 0
      const MAX_NUDGES = 2

      // ── Phase 5 guards: verification, cost ceiling, oscillation ──
      let appliedAny =
        restoringPause && agentPauseStateRef.current
          ? agentPauseStateRef.current.appliedAny
          : false
      let verifiedSinceApply =
        restoringPause && agentPauseStateRef.current
          ? agentPauseStateRef.current.verifiedSinceApply
          : false
      let verifyNudges = 0            // times we've forced a verify before finish
      const MAX_VERIFY_NUDGES = 1
      let knowledgeReviewNudges = 0
      const MAX_KNOWLEDGE_REVIEW_NUDGES = 0
      let spacingFinishNudges = 0
      const MAX_SPACING_FINISH_NUDGES = geometryOnlyRun ? 0 : 2
      let layoutFinishNudges = 0
      const MAX_LAYOUT_FINISH_NUDGES = layoutFixTask ? 2 : 0
      let lastValidation: ValidationResult | null = null
      let applyCount = 0
      const scopedApplyCount =
        workScope.remainingSlideIds.length ||
        workScope.targetSlideIds.length ||
        explicitIds.length ||
        1
      const MAX_APPLIES = deckBuildWithScope
        ? Math.min(28, Math.max(16, deckSlideCap * 2))
        : layoutFixTask
          ? Math.max(8, scopedApplyCount * 4)
          : geometryOnlyRun
            ? scopedApplyCount <= 1
              ? 5
              : Math.min(6, scopedApplyCount * 2)
            : layoutAuditRun
              ? Math.max(12, scopedApplyCount * 4)
              : 8
      const maxAgentSteps = deckBuildWithScope
        ? Math.min(40, 12 + deckSlideCap * 2)
        : AGENT_MAX_STEPS
      const applySignatures: string[] = []
      let stopFlag: string | null = null  // set to abort the loop after this turn
      let hitStepLimit = false        // ran out of steps before calling finish

      const captureAgentPause = (
        reason: AgentPauseReason,
        reasonLabel: string,
        step: number
      ) => {
        const p = agentProgressRef.current
        const modified = Array.from(p.changedSlideIds)
        const incomplete: IncompleteAgentContext = incompleteAgentContextRef.current ?? {
          originalInstruction:
            agentPauseStateRef.current?.originalInstruction ?? agentInstruction,
          modifiedSlideIds: modified,
          targetSlideIds: slidesRef.current.map(s => s.id),
          lastAction: p.lastAction,
          wasLayoutAudit: layoutAuditRun || geometryOnlyRun,
          deckWide: deckBuildWithScope,
        }
        agentPauseStateRef.current = {
          version: AGENT_PAUSE_STATE_VERSION,
          reason,
          reasonLabel,
          originalInstruction: incomplete.originalInstruction,
          messages: cloneMessages(messages),
          nextStep: step + 1,
          introCompressed,
          presentationScope,
          parsedScopeForBuild,
          deckBuildWithScope,
          layoutAuditRun,
          geometryOnlyRun,
          deckSlideCap,
          agentEffort,
          appliedAny,
          verifiedSinceApply,
          incompleteContext: {
            ...incomplete,
            modifiedSlideIds: modified,
            lastAction: p.lastAction,
            deckWide: incomplete.deckWide || deckBuildWithScope,
            targetSlideIds: deckBuildWithScope
              ? slidesRef.current.map(s => s.id)
              : incomplete.targetSlideIds,
          },
          segmentIndex: (agentPauseStateRef.current?.segmentIndex ?? -1) + 1,
          pausedAt: Date.now(),
        }
        incompleteAgentContextRef.current = agentPauseStateRef.current.incompleteContext
      }

      try {
        let useLegacyAgentLoop = true

        if (!restoringPause) {
          if (!agentProviderRef.current) {
            try {
              const cfgRes = await fetch('/api/edit/agent/config')
              const cfg = (await cfgRes.json()) as { provider?: string }
              agentProviderRef.current = cfg.provider ?? 'anthropic'
            } catch {
              agentProviderRef.current = 'anthropic'
            }
          }

          if (agentProviderRef.current === 'claude-agent-sdk') {
            useLegacyAgentLoop = false
            addStep({ kind: 'plan', label: 'Claude Agent SDK — running autonomous edit loop' })

            if (agentStopRef.current) {
              addStep({ kind: 'note', label: 'Stopped by user. Changes so far are kept.' })
            } else {
              const ac = new AbortController()
              agentAbortRef.current = ac
              const sdkState: {
                askUser: { intro?: string; questions: ClarificationQuestion[] } | null
              } = { askUser: null }

              try {
                const res = await fetch('/api/edit/agent/sdk', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    prompt: intro,
                    slides: beforeRun,
                    effort: agentEffort,
                    deckBuild: deckBuildWithScope,
                    geometryOnly: geometryOnlyRun || fastLayoutRun,
                    layoutAudit: layoutAuditRun,
                  }),
                  signal: ac.signal,
                })

                await consumeAgentSdkStream(res, (event: DeckAgentStreamEvent) => {
                  if (event.type === 'step') {
                    addStep({ kind: event.kind, label: event.label })
                    return
                  }
                  if (event.type === 'error') {
                    addStep({ kind: 'error', label: event.message })
                    return
                  }
                  if (event.type === 'ask_user') {
                    sdkState.askUser = { intro: event.intro, questions: event.questions }
                    return
                  }
                  if (event.type === 'result') {
                    slidesRef.current = event.slides
                    setSlides(event.slides)
                    runSummary = event.summary
                    runFinishedCleanly = event.success
                    if (event.changes.length > 0) {
                      appliedAny = true
                      for (const c of event.changes) {
                        if (c.slideId) agentProgressRef.current.changedSlideIds.add(c.slideId)
                      }
                      agentProgressRef.current.applyBatches++
                      const netPending = buildNetChangesFromSnapshots(beforeRun, event.slides)
                      if (netPending.length) {
                        pendingChangesRef.current = netPending
                        setPendingChanges(netPending)
                        setAmendmentCheckpoint(beforeRun)
                        amendmentCheckpointRef.current = beforeRun
                        setAmendmentSource('agent')
                        amendmentSourceRef.current = 'agent'
                        setHighlightDiffOnCanvas(true)
                      }
                    }
                  }
                })
              } catch (err) {
                const aborted =
                  agentStopRef.current ||
                  (err instanceof DOMException && err.name === 'AbortError') ||
                  (err as { name?: string })?.name === 'AbortError'
                if (aborted) {
                  addStep({ kind: 'note', label: 'Stopped by user. Changes so far are kept.' })
                } else {
                  const msg = err instanceof Error ? err.message : 'Agent SDK error'
                  addStep({ kind: 'error', label: msg })
                }
              }

              if (sdkState.askUser) {
                const payload = sdkState.askUser
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
                setPendingAgentInstruction(agentInstruction)
                const modifiedNow = diffSlideIds(beforeRun, slidesRef.current)
                if (incompleteAgentContextRef.current) {
                  incompleteAgentContextRef.current = {
                    ...incompleteAgentContextRef.current,
                    modifiedSlideIds: modifiedNow,
                    targetSlideIds: slidesRef.current.map(s => s.id),
                    deckWide: isNewDeckBuildRequest(agentInstruction),
                    lastAction: 'Paused for user input',
                  }
                } else if (modifiedNow.length > 0) {
                  incompleteAgentContextRef.current = {
                    originalInstruction: agentInstruction,
                    modifiedSlideIds: modifiedNow,
                    targetSlideIds: slidesRef.current.map(s => s.id),
                    lastAction: 'Paused for user input',
                    wasLayoutAudit: false,
                    deckWide: isNewDeckBuildRequest(agentInstruction),
                  }
                }
                const asked = payload.questions.map(q => q.question).filter(Boolean).join(' | ')
                runSummary =
                  `[asked the user]${payload.intro ? ` ${payload.intro}` : ''}${asked ? ` — ${asked}` : ''}`.trim()
              }
            }
          }
        }

        if (useLegacyAgentLoop) {
        for (let step = loopStartStep; step < maxAgentSteps; step++) {
          // Cancellation check at the top of each step (covers a Stop pressed
          // between turns, before the next request goes out).
          if (agentStopRef.current) {
            addStep({ kind: 'note', label: 'Stopped by user. Changes so far are kept.' })
            break
          }
          const ac = new AbortController()
          agentAbortRef.current = ac
          const deckBuildExecuteOnly =
            deckBuildWithScope && slidesRef.current.length < deckSlideCap
          const useReviewPhase = false
          const agentPhase = useReviewPhase ? 'review' : 'execute'
          const res = await fetch('/api/edit/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages,
              effort: agentEffort,
              phase: agentPhase,
              layoutAudit: layoutAuditRun,
              geometryOnly: fastLayoutRun || geometryOnlyRun,
              deckBuild: deckBuildWithScope,
            }),
            signal: ac.signal,
          })
          if (!res.ok) {
            let msg = `Agent request failed (HTTP ${res.status})`
            let transientKind: 'overloaded' | 'rate_limit' | null = null
            try {
              const errData = await res.json()
              if (errData?.error) msg = errData.error
              if (errData?.transient === 'overloaded' || errData?.transient === 'rate_limit') {
                transientKind = errData.transient
              } else if (/overloaded/i.test(String(errData?.error ?? ''))) {
                transientKind = 'overloaded'
              }
            } catch {
              /* non-JSON error body — keep the generic message */
            }
            if (!transientKind && /overloaded/i.test(msg)) transientKind = 'overloaded'
            if (!transientKind && res.status === 429) transientKind = 'rate_limit'
            if (!transientKind && (res.status === 503 || res.status === 529)) {
              transientKind = 'overloaded'
            }

            const p = agentProgressRef.current
            const modified = Array.from(p.changedSlideIds)
            const hasChanges =
              modified.length > 0 || (pendingChangesRef.current?.length ?? 0) > 0

            if (transientKind) {
              const limitReached =
                transientKind === 'overloaded'
                  ? buildOverloadedError({
                      modifiedSlideIds: modified,
                      applyBatches: p.applyBatches || undefined,
                      lastAction: p.lastAction || undefined,
                      hasChanges,
                    })
                  : buildRateLimitError({
                      modifiedSlideIds: modified,
                      applyBatches: p.applyBatches || undefined,
                      lastAction: p.lastAction || undefined,
                      hasChanges,
                    })
              msg = formatAgentLimitError(limitReached)
              captureAgentPause(
                transientKind,
                transientKind === 'overloaded'
                  ? 'Anthropic API overloaded'
                  : 'Anthropic rate limit',
                step
              )
              setAgentRunIncomplete(true)
              if (hasChanges && pendingChangesRef.current?.length) {
                setPendingSummary(prev => prev || runSummary || 'Agent edits (incomplete)')
              }
              addStep({ kind: 'error', label: msg, limitReached })
              break
            }

            if (res.status === 504) {
              const limitReached = buildTimeoutError({
                modifiedSlideIds: modified,
                applyBatches: p.applyBatches || undefined,
                lastAction: p.lastAction || undefined,
                hasChanges,
              })
              msg = formatAgentLimitError(limitReached)
              setAgentRunIncomplete(true)
              if (!hasChanges) {
                setAmendmentCheckpoint(null)
                setAmendmentSource(null)
                setPendingChanges(null)
                pendingChangesRef.current = null
                setSlides(JSON.parse(JSON.stringify(beforeRun)) as SlideData[])
                slidesRef.current = JSON.parse(JSON.stringify(beforeRun)) as SlideData[]
              } else if (pendingChangesRef.current?.length) {
                setPendingSummary(prev => prev || runSummary || 'Agent edits (incomplete)')
              }
              if (hasChanges) {
                captureAgentPause(
                  'timeout',
                  'server step timed out (504)',
                  step
                )
              }
              addStep({ kind: 'error', label: msg, limitReached })
              break
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
            if (block.type === 'redacted_thinking') {
              addStep({ kind: 'thinking', label: '(extended reasoning — hidden by provider)' })
              continue
            }
            if (block.type === 'text') {
              if (block.text?.trim()) addStep({ kind: 'note', label: block.text.trim() })
              continue
            }
            if (block.type !== 'tool_use') continue

            const { id, name, input } = block
            if (name === 'finish') {
              // Knowledge validation gate: block finish when unverified claims remain
              // on investor-facing edits until the agent revises or softens copy.
              const needsKnowledgeFix =
                !fastLayoutRun &&
                lastValidation &&
                (lastValidation.validation_result === 'human_review' ||
                  (lastValidation.validation_result === 'needs_fix' &&
                    lastValidation.issues.some(i => i.severity === 'high')))
              if (
                needsKnowledgeFix &&
                knowledgeReviewNudges < MAX_KNOWLEDGE_REVIEW_NUDGES
              ) {
                knowledgeReviewNudges++
                addStep({
                  kind: 'review',
                  label: formatValidationForUser(lastValidation!),
                })
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    `Do NOT finish yet — knowledge validation flagged issues:\n${formatValidationForAgent(lastValidation!)}`,
                })
              } else if (
                appliedAny &&
                !verifiedSinceApply &&
                verifyNudges < MAX_VERIFY_NUDGES &&
                !(fastLayoutRun)
              ) {
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
              } else if (designSystemAlign && appliedAny) {
                finished = true
                runFinishedCleanly = true
                if (input?.summary) runSummary = input.summary
                addStep({ kind: 'done', label: input?.summary || 'Done.' })
              } else if (agentPhase === 'review' || layoutFixTask) {
                const modifiedIds = agentProgressRef.current.changedSlideIds
                const finishCheckIds = new Set(modifiedIds)
                if (layoutFixTask) {
                  for (const id of workScope.targetSlideIds) finishCheckIds.add(id)
                  for (const id of workScope.remainingSlideIds) finishCheckIds.add(id)
                  for (const id of workScope.alreadyDoneSlideIds) finishCheckIds.add(id)
                } else if (layoutAuditRun) {
                  for (const id of workScope.targetSlideIds) finishCheckIds.add(id)
                  for (const id of workScope.remainingSlideIds) finishCheckIds.add(id)
                } else {
                  if (activeSlideId) finishCheckIds.add(activeSlideId)
                  for (const id of selectedSlideIds) finishCheckIds.add(id)
                }
                const slidesToFinishCheck = slidesRef.current.filter(s => finishCheckIds.has(s.id))
                const geometryRemaining = slidesToFinishCheck.flatMap(s => findLayoutFixIssues(s))
                if (geometryRemaining.length > 0 && layoutFixTask) {
                  if (layoutFinishNudges < MAX_LAYOUT_FINISH_NUDGES) {
                    layoutFinishNudges++
                    addStep({
                      kind: 'review',
                      label: `${geometryRemaining.length} layout issue(s) still on slide — overlaps, clipping, or misalignment.`,
                    })
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: id,
                      content:
                        `Do NOT finish yet — layout check failed:\n${formatOverlapCheck(
                          geometryRemaining
                        )}\n\n` +
                        `Call apply_changes ONCE with patches for EVERY issue above — do not fix one pair per turn.`,
                    })
                  } else {
                    addStep({
                      kind: 'review',
                      label: `Layout polish limit — ${geometryRemaining.length} issue(s) remain; pipeline paused.`,
                    })
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: id,
                      content:
                        `Layout finish limit reached — ${geometryRemaining.length} issue(s) still open:\n${formatOverlapCheck(
                          geometryRemaining
                        )}\n\n` +
                        `Say "continue" to resume fixes, or Accept/Decline changes on the canvas.`,
                    })
                    stopFlag =
                      'Paused: layout polish limit reached — say "continue" to resume.'
                  }
                } else if (!geometryOnlyRun && spacingFinishNudges < MAX_SPACING_FINISH_NUDGES) {
                  const spacingRemaining = slidesToFinishCheck.flatMap(s => findSpacingIssues(s))
                  if (spacingRemaining.length > 0) {
                    spacingFinishNudges++
                    addStep({
                      kind: 'review',
                      label: `Spacing/fill issues on ${spacingRemaining.length} check(s) — rebalancing margins and gaps.`,
                    })
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: id,
                      content:
                        `Do NOT finish yet — review phase spacing check failed:\n${formatSpacingCheck(
                          spacingRemaining
                        )}\n\n` +
                        `Call apply_changes to fix: equal top/bottom and left/right margins; even vertical gaps ` +
                        `between stacked elements; stretch or redistribute horizontal columns to fill width evenly; ` +
                        `for tables bump style.fontSize on cell text flagged as text-underfill so copy fills each cell.`,
                    })
                  } else {
                    finished = true
                    runFinishedCleanly = true
                    if (input?.summary) runSummary = input.summary
                    addStep({ kind: 'done', label: input?.summary || 'Done.' })
                  }
                } else if (geometryOnlyRun) {
                  finished = true
                  runFinishedCleanly = true
                  if (input?.summary) runSummary = input.summary
                  addStep({ kind: 'done', label: input?.summary || 'Done.' })
                } else if (spacingFinishNudges >= MAX_SPACING_FINISH_NUDGES) {
                  const spacingRemaining = slidesToFinishCheck.flatMap(s => findSpacingIssues(s))
                  if (spacingRemaining.length > 0) {
                    addStep({
                      kind: 'review',
                      label: `Spacing/balance limit — ${spacingRemaining.length} issue(s) remain; pipeline paused.`,
                    })
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: id,
                      content:
                        `Do NOT finish yet — spacing/balance review limit reached for this segment:\n${formatSpacingCheck(
                          spacingRemaining
                        )}\n\n` +
                        `Say "continue" to resume margin/gap fixes, or Accept/Decline changes on the canvas.`,
                    })
                    stopFlag =
                      'Paused: spacing/balance review limit reached — say "continue" to resume.'
                  } else {
                    finished = true
                    runFinishedCleanly = true
                    if (input?.summary) runSummary = input.summary
                    addStep({ kind: 'done', label: input?.summary || 'Done.' })
                  }
                } else {
                  finished = true
                  runFinishedCleanly = true
                  if (input?.summary) runSummary = input.summary
                  addStep({ kind: 'done', label: input?.summary || 'Done.' })
                }
              } else if (!appliedAny && layoutAuditRun) {
                addStep({
                  kind: 'note',
                  label: 'Layout audit requires apply_changes — asking the agent to patch slides, not just report.',
                })
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    'Do NOT finish yet: this is a layout audit/fix task but you applied ZERO changes. ' +
                    'Call get_slides, then apply_changes with geometry patches (x, y, w, h, spacing) for every issue. ' +
                    'A text-only deck inventory is not acceptable — fixes must appear on the slides. ' +
                    'Scope slide caps do NOT block geometry edits on existing slides.',
                })
              } else if (layoutFixTask) {
                const finishCheckIds = new Set([
                  ...workScope.targetSlideIds,
                  ...workScope.remainingSlideIds,
                  ...workScope.alreadyDoneSlideIds,
                  ...Array.from(agentProgressRef.current.changedSlideIds),
                ])
                const slidesToFinishCheck = slidesRef.current.filter(s => finishCheckIds.has(s.id))
                const geometryRemaining = slidesToFinishCheck.flatMap(s => findLayoutFixIssues(s))
                if (geometryRemaining.length > 0) {
                  addStep({
                    kind: 'review',
                    label: `${geometryRemaining.length} layout issue(s) still on slide — overlaps, clipping, or overflow.`,
                  })
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: id,
                    content:
                      `Do NOT finish yet — layout check failed:\n${formatOverlapCheck(
                        geometryRemaining
                      )}\n\n` +
                      `Call apply_changes to fix every issue before finishing. ` +
                      `Render alone is not sufficient when programmatic checks still fail.`,
                  })
                } else {
                  finished = true
                  runFinishedCleanly = true
                  if (input?.summary) runSummary = input.summary
                  addStep({ kind: 'done', label: input?.summary || 'Done.' })
                }
              } else {
                finished = true
                runFinishedCleanly = true
                if (input?.summary) runSummary = input.summary
                addStep({ kind: 'done', label: input?.summary || 'Done.' })
              }
            } else if (name === 'ask_user') {
              const questions = Array.isArray(input?.questions) ? input!.questions! : []
              const asksSlideIds = questions.some(q =>
                /\b(which\s+slide|what\s+slide|slide\s+id|last\s*\/\s*closing|confirm\s+both|which\s+is\s+the\s+last)\b/i.test(
                  q.question ?? ''
                )
              )
              const depthOnly =
                questions.length > 0 &&
                questions.every((q: ClarificationQuestion) => q.id === 'presentation_depth')
              if (asksSlideIds || designSystemAlign) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    'Do NOT call ask_user to identify slides. The deck overview lists every position → id ' +
                    `(slide 1 = first, slide ${slidesRef.current.length} = last). ` +
                    'Call get_slides (omit slideIds) then apply_changes immediately.',
                  is_error: true,
                })
              } else if (scopeConfirmed && depthOnly && deckBuild) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    'Presentation depth is already confirmed in the DECK BUILD block. ' +
                    'Proceed with get_slides and apply_changes — do NOT call ask_user for depth.',
                  is_error: true,
                })
              } else if (isContinuation || agentInstruction.includes('[CONTINUE —')) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    'Do NOT call ask_user on a CONTINUE request. The original task and remaining slides are in the intro. ' +
                    'Proceed with get_slides and apply_changes for the outstanding work immediately.',
                  is_error: true,
                })
              } else {
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
              }
            } else if (name === 'get_slide') {
              const slide = slidesRef.current.find(s => s.id === input?.slideId)
              agentProgressRef.current.lastAction = `Inspected ${input?.slideId}`
              addStep({ kind: 'read', label: `Inspected ${input?.slideId}` })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: slide
                  ? slimSlideJson([{ id: slide.id, bg: slide.bg, elements: slide.elements }])
                  : `Slide ${input?.slideId} not found. Available: ${slidesRef.current
                      .map(s => s.id)
                      .join(', ')}`,
                ...(slide ? {} : { is_error: true }),
              })
            } else if (name === 'get_slides') {
              const requested = Array.isArray(input?.slideIds) ? (input!.slideIds as string[]) : null
              const scopedIds =
                workScope.remainingSlideIds.length > 0
                  ? workScope.remainingSlideIds
                  : workScope.targetSlideIds
              const scopeLocked =
                scopedIds.length > 0 &&
                scopedIds.length < slidesRef.current.length &&
                !workScope.allowFullDeckRead
              const uiScopeLocked = !!opts?.scopedSlideIds?.length
              if (
                requested &&
                scopeLocked &&
                (layoutAuditRun || (isContinuation && !deckBuildWithScope) || uiScopeLocked)
              ) {
                const allowed = new Set(scopedIds)
                const outside = requested.filter(id => !allowed.has(id))
                if (outside.length) {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: id,
                    content:
                      `Slides outside work scope: ${outside.join(', ')}. ` +
                      `Call get_slides with slideIds: [${scopedIds.map(sid => `"${sid}"`).join(', ')}] only.`,
                    is_error: true,
                  })
                  continue
                }
              }
              if (
                !requested &&
                scopedIds.length > 0 &&
                scopedIds.length < slidesRef.current.length &&
                !workScope.allowFullDeckRead &&
                (layoutAuditRun || (isContinuation && !deckBuildWithScope) || uiScopeLocked)
              ) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    `Do NOT read the full deck — work scope is limited to ${scopedIds.length} slide(s). ` +
                    `Call get_slides again with slideIds: [${scopedIds.map(sid => `"${sid}"`).join(', ')}].`,
                  is_error: true,
                })
                continue
              }
              const picked = requested
                ? slidesRef.current.filter(s => requested.includes(s.id))
                : slidesRef.current
              addStep({
                kind: 'read',
                label: requested
                  ? `Inspected ${picked.length} slide(s): ${picked.map(s => s.id).join(', ')}`
                  : `Inspected all ${picked.length} slides`,
              })
              agentProgressRef.current.lastAction = requested
                ? `Inspected ${picked.length} slide(s)`
                : `Inspected all ${picked.length} slides`
              toolResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: slimSlideJson(
                  picked.map(s => ({ id: s.id, bg: s.bg, elements: s.elements }))
                ),
              })
            } else if (name === 'render_slide') {
              const slide = slidesRef.current.find(s => s.id === input?.slideId)
              const png = slide ? await renderSlideToPng(slide) : null
              // A render after an edit counts as verification (satisfies the gate).
              if (appliedAny) verifiedSinceApply = true
              agentProgressRef.current.lastAction = `Rendered ${input?.slideId}`
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

              const scopeSlideIds =
                workScope.remainingSlideIds.length > 0
                  ? workScope.remainingSlideIds
                  : workScope.targetSlideIds
              const scopeLocked =
                scopeSlideIds.length > 0 && scopeSlideIds.length < slidesRef.current.length
              const uiScopeLocked = !!opts?.scopedSlideIds?.length
              if (
                scopeLocked &&
                (layoutAuditRun || (isContinuation && !deckBuildWithScope) || uiScopeLocked) &&
                !(deckBuild && scopeConfirmed && changesAddSlides(changes))
              ) {
                const allowed = new Set(scopeSlideIds)
                const touched = [
                  ...new Set(changes.map(c => c.slideId).filter((id): id is string => !!id)),
                ]
                const outside = touched.filter(id => !allowed.has(id))
                if (outside.length) {
                  addStep({
                    kind: 'note',
                    label: `Blocked — patch targeted slide(s) outside scope: ${outside.join(', ')}`,
                  })
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: id,
                    content:
                      `These slide(s) are OUTSIDE the locked work scope: ${outside.join(', ')}. ` +
                      `apply_changes ONLY for: ${scopeSlideIds.join(', ')}. Nothing was applied.`,
                    is_error: true,
                  })
                  continue
                }
              }

              if (deckBuild && !scopeConfirmed) {
                addStep({
                  kind: 'note',
                  label: 'Blocked — choose Light / Medium / In-depth first.',
                })
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    'You must call ask_user FIRST with question id "presentation_depth" (Light ≤5 / Medium ≤10 / In-depth ≤15 slides) before any apply_changes on a new deck build. Nothing was applied.',
                  is_error: true,
                })
                continue
              }

              if (wouldExceedScopeSlideLimit(slidesRef.current, changes, presentationScope)) {
                const slideLimit = effectiveSlideLimit(presentationScope)
                const projected = applyChangesToSlides(slidesRef.current, changes).length
                addStep({
                  kind: 'note',
                  label: `Blocked — would exceed the ${slideLimit}-slide limit (${projected} total).`,
                })
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: id,
                  content:
                    `This patch would ADD slides and bring the deck to ${projected}, exceeding the limit of ${slideLimit}` +
                    (presentationScope ? ` (${presentationScope} scope)` : '') +
                    `. Nothing was applied. Scope caps apply only when creating NEW slides — geometry/content edits on existing slides are always allowed. ` +
                    `Add at most ${Math.max(0, slideLimit - slidesRef.current.length)} more slide(s), or finish.`,
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
                  'Paused: identical edit loop detected. Changes kept — say "continue" to resume the pipeline.'
              } else if (applyCount > MAX_APPLIES) {
                stopFlag = `Paused: reached the ${MAX_APPLIES}-edit limit for this segment. Changes kept — say "continue" to resume.`
              }
              const report = analyzeChanges(slidesRef.current, changes)
              const before = slidesRef.current
              const next = applyChangesToSlides(before, changes)
              const sum = input?.summary || `${report.willApply} change(s)`
              slidesRef.current = next
              pendingChangesRef.current = [...(pendingChangesRef.current ?? []), ...changes]
              const netPending = buildNetChangesFromSnapshots(beforeRun, next)
              if (netPending.length) {
                setSlides(next)
                setPendingChanges(netPending)
                pendingChangesRef.current = netPending
                setAmendmentCheckpoint(beforeRun)
                amendmentCheckpointRef.current = beforeRun
                setAmendmentSource('agent')
                amendmentSourceRef.current = 'agent'
                setHighlightDiffOnCanvas(true)
              }
              for (const c of changes) agentProgressRef.current.changedSlideIds.add(c.slideId)
              agentProgressRef.current.applyBatches++
              agentProgressRef.current.lastAction = `Applied ${report.willApply} change(s): ${sum}`
              if (incompleteAgentContextRef.current) {
                const merged = new Set([
                  ...incompleteAgentContextRef.current.modifiedSlideIds,
                  ...Array.from(agentProgressRef.current.changedSlideIds),
                ])
                incompleteAgentContextRef.current = {
                  ...incompleteAgentContextRef.current,
                  modifiedSlideIds: Array.from(merged),
                  targetSlideIds:
                    incompleteAgentContextRef.current.targetSlideIds.length > 0
                      ? incompleteAgentContextRef.current.targetSlideIds
                      : workScope.targetSlideIds,
                  lastAction: agentProgressRef.current.lastAction,
                }
              }
              // Programmatic geometry check (mirrors a designer measuring for
              // overflow): surface only the issues THIS edit introduced so the
              // model can self-correct without re-rendering every slide.
              const { newIssues, spacingIssues, overlapIssues } = reviewLayoutChange(before, next)
              const geomNewIssues = designSystemAlign
                ? filterOverlapOnlyLayoutIssues(newIssues)
                : geometryOnlyRun || layoutFixTask
                  ? filterLayoutFixIssues(newIssues)
                  : newIssues
              const touchedIds = new Set(changes.map(c => c.slideId).filter(Boolean))
              const spacingOnTouched = spacingIssues.filter(
                i => i.slideId && touchedIds.has(i.slideId)
              )
              const overlapOnTouched = overlapIssues.filter(
                i => i.slideId && touchedIds.has(i.slideId)
              )
              const layoutOnTouched =
                geometryOnlyRun || layoutFixTask
                  ? [...touchedIds].flatMap(sid => {
                      const s = next.find(sl => sl.id === sid)
                      return s ? findLayoutFixIssues(s) : []
                    })
                  : overlapOnTouched
              runSummary = sum
              totalSkipped += report.skipped
              addStep({
                kind: 'apply',
                label: `Applied ${report.willApply}/${report.total}: ${sum}${
                  geomNewIssues.length ? ` · ${geomNewIssues.length} layout issue(s)` : ''
                }`,
              })

              let knowledgeReviewBlock = ''
              const skipKnowledgeOnApply =
                fastLayoutRun || (changes.length > 0 && changesAreGeometryOnly(changes))
              if ((semanticEditPlan || approvalRequired) && !skipKnowledgeOnApply) {
                const validation = await reviewAgentChanges({
                  instruction: agentInstruction,
                  semanticEditPlan,
                  changes,
                  slidesAfter: next,
                  approvalRequired,
                })
                if (validation) {
                  lastValidation = validation
                  if (validation.issues.length) {
                    addStep({
                      kind: 'review',
                      label: formatValidationForUser(validation),
                    })
                  }
                  if (validation.validation_result !== 'pass') {
                    knowledgeReviewBlock = `\n\nKNOWLEDGE VALIDATION:\n${formatValidationForAgent(validation)}`
                  } else {
                    knowledgeReviewBlock = '\n\nKNOWLEDGE VALIDATION: PASS — no blocking issues.'
                  }
                }
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: `Applied ${report.willApply} of ${report.total} change(s)${
                  report.skipped
                    ? ` (${report.skipped} skipped — verify those element ids actually exist on the slide)`
                    : ''
                }.${
                  geomNewIssues.length
                    ? `\n\nLAYOUT CHECK — this edit introduced ${geomNewIssues.length} geometry issue(s) (slide is 10×7.5in); fix them before finishing:\n${formatLayoutIssues(
                        geomNewIssues
                      )}`
                    : '\n\nLAYOUT CHECK — no new overflow/overlap detected.'
                }${
                  geometryOnlyRun || layoutFixTask
                    ? layoutOnTouched.length
                      ? `\n\n${formatOverlapCheck(layoutOnTouched)}\n\n` +
                        `Fix ALL issues above in your NEXT apply_changes (one batch) — do not micro-patch one pair per turn.`
                      : '\n\nLAYOUT CHECK — no overlaps, misalignment, or clipped text detected.'
                    : designSystemAlign
                      ? overlapOnTouched.length
                        ? `\n\n${formatOverlapCheck(overlapOnTouched)}`
                        : '\n\nSTYLING PASS — ignore margin-imbalance on accent bars; overlaps only.'
                    : agentPhase === 'review' || layoutAuditRun
                      ? `\n\n${formatOverlapCheck(overlapOnTouched)}\n\n${formatSpacingCheck(spacingOnTouched)}`
                      : geomNewIssues.some(i => i.kind === 'overlap')
                        ? `\n\n${formatOverlapCheck(geomNewIssues.filter(i => i.kind === 'overlap'))}`
                        : ''
                }${knowledgeReviewBlock}${
                  designSystemAlign
                    ? ' Finish when bg/fonts/colors match on all target slides — do not chase margins.'
                    : geometryOnlyRun || layoutFixTask
                      ? layoutOnTouched.length
                        ? ' Re-render once, then finish when LAYOUT CHECK is clean.'
                        : ' Finish after one render — LAYOUT CHECK is clean.'
                      : ' Re-render the slide to verify the result visually.'
                }`,
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
            setPendingAgentInstruction(agentInstruction)
            const modifiedNow = diffSlideIds(beforeRun, slidesRef.current)
            if (incompleteAgentContextRef.current) {
              incompleteAgentContextRef.current = {
                ...incompleteAgentContextRef.current,
                modifiedSlideIds: modifiedNow,
                targetSlideIds: slidesRef.current.map(s => s.id),
                deckWide: isNewDeckBuildRequest(agentInstruction),
                lastAction: 'Paused for user input',
              }
            } else if (modifiedNow.length > 0) {
              incompleteAgentContextRef.current = {
                originalInstruction: agentInstruction,
                modifiedSlideIds: modifiedNow,
                targetSlideIds: slidesRef.current.map(s => s.id),
                lastAction: 'Paused for user input',
                wasLayoutAudit: false,
                deckWide: isNewDeckBuildRequest(agentInstruction),
              }
            }
            // Record what was asked so the resumed run has continuity.
            const asked = payload.questions.map(q => q.question).filter(Boolean).join(' | ')
            runSummary =
              `[asked the user]${payload.intro ? ` ${payload.intro}` : ''}${asked ? ` — ${asked}` : ''}`.trim()
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
            captureAgentPause(
              'no_tool_call',
              'agent stopped without calling a tool',
              step
            )
            const modified = Array.from(agentProgressRef.current.changedSlideIds)
            const limitReached = buildNoToolCallPauseError({
              modifiedSlideIds: modified,
              lastAction: agentProgressRef.current.lastAction || undefined,
              hasChanges: modified.length > 0,
            })
            addStep({
              kind: 'error',
              label: formatAgentLimitError(limitReached),
              limitReached,
            })
            setAgentRunIncomplete(true)
            break
          }

          messages.push({ role: 'user', content: toolResults })

          if (!introCompressed && step === loopStartStep) {
            introCompressed = true
            const parsedScope = parsePresentationScope(agentInstruction)
            if (parsedScope) presentationScope = parsedScope
            const first = messages[0]
            if (first?.role === 'user' && typeof first.content === 'string') {
              messages[0] = {
                role: 'user',
                content: compressAgentIntro(first.content, agentInstruction, {
                  scopeNote: presentationScope
                    ? formatPresentationScopeNote(presentationScope)
                    : undefined,
                }),
              }
            }
          }

          if (stopFlag) {
            const modified = Array.from(agentProgressRef.current.changedSlideIds)
            const oscillation = stopFlag.includes('identical edit')
            const spacingLimit =
              stopFlag.includes('spacing/balance') || stopFlag.includes('layout polish')
            captureAgentPause(
              spacingLimit ? 'spacing_limit' : oscillation ? 'oscillation' : 'apply_limit',
              stopFlag.replace(/^Paused:\s*/i, ''),
              step
            )
            const limitReached = spacingLimit
              ? buildSpacingLimitError({
                  modifiedSlideIds: modified,
                  applyBatches: agentProgressRef.current.applyBatches || undefined,
                  lastAction: agentProgressRef.current.lastAction || undefined,
                  hasChanges: modified.length > 0 || (pendingChangesRef.current?.length ?? 0) > 0,
                })
              : buildApplyLimitError({
                  applyLimit: MAX_APPLIES,
                  modifiedSlideIds: modified,
                  applyBatches: agentProgressRef.current.applyBatches || undefined,
                  lastAction: agentProgressRef.current.lastAction || undefined,
                  hasChanges: modified.length > 0 || (pendingChangesRef.current?.length ?? 0) > 0,
                  oscillation,
                })
            addStep({
              kind: 'error',
              label: formatAgentLimitError(limitReached),
              limitReached,
            })
            setAgentRunIncomplete(true)
            break
          }

          if (step === maxAgentSteps - 1) {
            hitStepLimit = true
            setAgentRunIncomplete(true)
            const p = agentProgressRef.current
            const modified = Array.from(p.changedSlideIds)
            captureAgentPause(
              'step_limit',
              `reached the ${maxAgentSteps}-step limit`,
              step
            )
            if (incompleteAgentContextRef.current) {
              const merged = new Set([
                ...incompleteAgentContextRef.current.modifiedSlideIds,
                ...modified,
              ])
              incompleteAgentContextRef.current = {
                ...incompleteAgentContextRef.current,
                modifiedSlideIds: Array.from(merged),
                lastAction: p.lastAction,
              }
            }
            const limitReached = buildStepLimitError({
              stepLimit: maxAgentSteps,
              modifiedSlideIds: modified,
              lastAction: p.lastAction || undefined,
              hasChanges: modified.length > 0,
            })
            addStep({
              kind: 'error',
              label: formatAgentLimitError(limitReached),
              limitReached,
            })
          }
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
        isAgentRunningRef.current = false
        setCaptureSlide(null)
        setIsAgentRunning(false)
        const afterRun = slidesRef.current
        const changedSlideIds = diffSlideIds(beforeRun, afterRun)
        if (hitStepLimit && incompleteAgentContextRef.current && changedSlideIds.length > 0) {
          incompleteAgentContextRef.current = {
            ...incompleteAgentContextRef.current,
            modifiedSlideIds: Array.from(
              new Set([...incompleteAgentContextRef.current.modifiedSlideIds, ...changedSlideIds])
            ),
            lastAction: agentProgressRef.current.lastAction,
          }
        }
        const wirePendingReview = () => {
          const toReview =
            resolveEffectivePendingChanges(
              pendingChangesRef.current,
              beforeRun,
              afterRun
            ) ??
            (pendingChangesRef.current?.length ? pendingChangesRef.current : null) ??
            (() => {
              const net = buildNetChangesFromSnapshots(beforeRun, afterRun)
              return net.length ? net : null
            })()
          if (!toReview?.length) return
          setAmendmentCheckpoint(beforeRun)
          amendmentCheckpointRef.current = beforeRun
          setAmendmentSource('agent')
          amendmentSourceRef.current = 'agent'
          setPendingChanges(toReview)
          pendingChangesRef.current = toReview
          if (stopFlag) setAgentRunIncomplete(true)
          setPendingSummary(prev => prev || runSummary || agentInstruction.slice(0, 120))
          setHighlightDiffOnCanvas(true)
          if (!changedSlideIds.includes(activeSlideId)) {
            const target = changedSlideIds[0]
            setActiveSlideId(target)
            setSelectedSlideIds([target])
            setSelectionAnchorId(target)
          }
        }

        if (
          changedSlideIds.length > 0 &&
          !amendmentsCommittedRef.current &&
          !answerOnly
        ) {
          wirePendingReview()
        } else if (
          answerOnly &&
          changedSlideIds.length > 0 &&
          !amendmentsCommittedRef.current
        ) {
          // Agent edited during a Q&A turn — still surface for review.
          wirePendingReview()
        } else if (changedSlideIds.length === 0 && !answerOnly) {
          setAmendmentCheckpoint(null)
          setAmendmentSource(null)
          setPendingChanges(null)
          pendingChangesRef.current = null
          setSlides(JSON.parse(JSON.stringify(beforeRun)) as SlideData[])
          slidesRef.current = JSON.parse(JSON.stringify(beforeRun)) as SlideData[]
        }
        // Reconcile React state with the ref source-of-truth in case any path
        // updated one without the other during the loop.
        setSlides(slidesRef.current)
        // Record the agent's outcome in history so future turns have continuity
        // (the transcript builder surfaces this to the next agent run). When the run
        // was cut off at the step limit, flag it as INCOMPLETE so a later "continue"
        // re-reads the slide and finishes the remaining work instead of starting over.
        const outcome = hitStepLimit
          ? `[INCOMPLETE — stopped at the ${maxAgentSteps}-step limit before finishing.${
              runSummary ? ` Applied so far: ${runSummary}.` : ''
            } Remaining work on the original request is NOT done yet. If the user says "continue", re-read the target slide(s) with get_slide, see what is already there, and finish ONLY the outstanding parts.]`
          : runSummary
        if (answerOnly && answerProse.trim()) {
          setDisplay(prev => [...prev, { role: 'assistant', assistantAnswer: answerProse.trim() }])
          setConversationHistory(prev => [
            ...prev,
            { role: 'assistant', content: answerProse.trim() },
          ])
        } else if (outcome) {
          setConversationHistory(prev => [
            ...prev,
            { role: 'assistant', content: JSON.stringify({ type: 'clarification', question: outcome }) },
          ])
        }
        if (runFinishedCleanly && !hitStepLimit) {
          incompleteAgentContextRef.current = null
          agentPauseStateRef.current = null
          setAgentRunIncomplete(false)
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
      presentationId,
      presentationSummaries,
      amendmentCheckpoint,
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
      stopProcessing()
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
      const forkCount = Object.keys(branchNamesRef.current).filter(k => k !== MAIN_BRANCH_ID).length
      const newBranchName = `Fork ${forkCount + 1}`
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
    [display, slides, presentationId, makeBranchMeta, closeManualSession, stopProcessing]
  )

  /** Resolve conversationHistory index before a user message (works after reload). */
  const resolveHistoryIndex = useCallback(
    (displayIndex: number): number | null => {
      const target = display[displayIndex]
      if (target?.role !== 'user') return null
      if (typeof target.historyLength === 'number') return target.historyLength

      let userIdx = 0
      for (let i = 0; i < displayIndex; i++) {
        if (display[i]?.role === 'user') userIdx++
      }
      let seen = 0
      for (let i = 0; i < conversationHistory.length; i++) {
        const m = conversationHistory[i]
        if (m.role !== 'user') continue
        if (seen === userIdx && m.content === (target.text ?? '')) {
          return typeof m.historyLength === 'number' ? m.historyLength : i
        }
        seen++
      }
      return null
    },
    [display, conversationHistory]
  )

  // Retruncate chat from a past user message and resend it to the AI.
  const resendMessage = useCallback(
    async (displayIndex: number) => {
      const target = display[displayIndex]
      if (target?.role !== 'user' || !target.text?.trim() || !canEdit) return

      stopProcessing()

      const historyIndex = resolveHistoryIndex(displayIndex)
      if (historyIndex === null) {
        window.alert('Could not locate this message in chat history — try typing it again.')
        return
      }

      let restoreDeck = false
      if (target.checkpoint) {
        restoreDeck = window.confirm(
          'Resend this message?\n\n' +
            'OK = restore the deck to how it was BEFORE this message, then resend.\n' +
            'Cancel = keep the current deck and resend anyway.'
        )
      } else if (!window.confirm('Resend this message to the AI?')) {
        return
      }

      setDisplay(prev => prev.slice(0, displayIndex))
      setConversationHistory(prev => prev.slice(0, historyIndex))
      setPendingChanges(null)
      setPendingSummary('')
      setPendingDecisionId(null)
      setPendingAgentInstruction(null)
      setPendingScopeInstruction(null)
      setHighlightDiffOnCanvas(false)

      if (restoreDeck && target.checkpoint) {
        pushHistory()
        setSlides(JSON.parse(JSON.stringify(target.checkpoint)) as SlideData[])
      }

      // Wait for an in-flight agent/single-shot to finish stopping.
      for (let i = 0; i < 40; i++) {
        if (!isAgentRunningRef.current && !singleShotAbortRef.current) break
        await new Promise<void>(r => setTimeout(r, 50))
      }
      handleSend(target.text!.trim(), [], 'agent')
    },
    [
      display,
      canEdit,
      stopProcessing,
      resolveHistoryIndex,
      pushHistory,
      handleSend,
    ]
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
    return Array.from(map.values()).sort((a, b) => {
      if (a.id === MAIN_BRANCH_ID) return -1
      if (b.id === MAIN_BRANCH_ID) return 1
      return a.createdAt - b.createdAt
    })
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
      const text = withLayoutAuditDirective(`Option ${option.id}: ${option.label}`)
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
        const answerCheckpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
        const answerHistoryLength = conversationHistory.length
        setDisplay(prev => [
          ...prev,
          { role: 'user', text, checkpoint: answerCheckpoint, historyLength: answerHistoryLength },
        ])
        setConversationHistory(prev => [
          ...prev,
          { role: 'user', content: text, historyLength: prev.length },
        ])
        const scope = parsePresentationScope(text)
        const scopeHint = scope ? `\n${formatPresentationScopeNote(scope)}\n` : ''
        const completedSlideIds = amendmentCheckpoint
          ? diffSlideIds(amendmentCheckpoint, slides)
          : []

        // Agent already built slide(s) then paused for depth — continue without rolling back.
        if (completedSlideIds.length > 0 && scope) {
          incompleteAgentContextRef.current = {
            originalInstruction: orig,
            modifiedSlideIds: completedSlideIds,
            targetSlideIds: slides.map(s => s.id),
            lastAction: 'Slides built before depth answer',
            wasLayoutAudit: false,
            deckWide: true,
          }
          const dsForAlign =
            designSystemRef.current && designSystemRef.current.files.length > 0
              ? designSystemRef.current
              : null
          const deckDesignAlignment = dsForAlign
            ? formatDesignSystemDeckAlignmentBlock(dsForAlign)
            : undefined
          runAgentRef.current?.(
            buildDeckBuildResumeInstruction(
              orig,
              text,
              scope,
              completedSlideIds,
              deckDesignAlignment
            ),
            { skipUserEcho: true, continuation: true, effort: 'high' }
          )
          return
        }

        const slideNums = parseSlideNumbersFromText(text, slides.length)
        const slideIds = slideNums.map(n => slides[n - 1]?.id).filter((id): id is string => !!id)
        const slideHint =
          slideIds.length > 0
            ? `\n${buildSlideTargetFixInstruction(slideNums, slideIds, orig)}\n`
            : ''
        runAgentRef.current?.(
          `${orig}\n\n[User chose presentation depth:]\n${text}${scopeHint}${slideHint}\n\n` +
            `Build the full presentation now. Do NOT call ask_user for depth again.`,
          { skipUserEcho: true, effort: 'high' }
        )
        return
      }

      const slideNums = parseSlideNumbersFromText(text, slides.length)
      const priorLayoutTask = findRecentLayoutFixTask(conversationHistory)
      if (
        slideNums.length > 0 &&
        isShortSlideTargetAnswer(text, slideNums) &&
        priorLayoutTask
      ) {
        const slideIds = slideNums.map(n => slides[n - 1]?.id).filter((id): id is string => !!id)
        if (slideIds.length > 0) {
          const agentInstruction = buildSlideTargetFixInstruction(
            slideNums,
            slideIds,
            priorLayoutTask
          )
          setSelectedSlideIds(slideIds)
          setActiveSlideId(slideIds[0])
          setSelectionAnchorId(slideIds[0])
          const answerCheckpoint = JSON.parse(JSON.stringify(slides)) as SlideData[]
          const answerHistoryLength = conversationHistory.length
          setDisplay(prev => [
            ...prev,
            { role: 'user', text, checkpoint: answerCheckpoint, historyLength: answerHistoryLength },
          ])
          setConversationHistory(prev => [
            ...prev,
            { role: 'user', content: text, historyLength: prev.length },
          ])
          runAgentRef.current?.(agentInstruction, { effort: 'medium', skipUserEcho: true })
          return
        }
      }

      handleSend(text)
    },
    [handleSend, pendingAgentInstruction, conversationHistory, slides, amendmentCheckpoint]
  )

  // ── Commit pending amendments (canvas preview → saved version) ─────────────
  const commitAmendments = useCallback(
    (opts?: {
      before?: SlideData[]
      after?: SlideData[]
      changes?: Change[]
      summary?: string
    }) => {
      if (!canEdit) return

      if (isAgentRunningRef.current) {
        agentStopRef.current = true
        agentAbortRef.current?.abort()
      }

      const checkpoint =
        opts?.before ??
        amendmentCheckpointRef.current ??
        amendmentCheckpoint
      const afterSlides =
        opts?.after ??
        slidesRef.current ??
        slides
      const before =
        checkpoint ??
        (JSON.parse(JSON.stringify(afterSlides)) as SlideData[])

      let changesLog =
        opts?.changes ??
        (checkpoint
          ? buildNetChangesFromSnapshots(before, afterSlides)
          : null)
      if (!changesLog?.length) {
        changesLog =
          resolveEffectivePendingChanges(
            pendingChangesRef.current ?? pendingChanges,
            checkpoint,
            afterSlides
          ) ?? null
      }

      let changedIds = diffSlideIds(before, afterSlides)
      if (!changedIds.length && changesLog?.length) {
        changedIds = Array.from(new Set(changesLog.map(c => c.slideId).filter(Boolean)))
      }

      if (!changedIds.length && !(changesLog?.length)) {
        console.warn('[commit] no pending changes to commit — snapshot unchanged')
        return
      }

      amendmentsCommittedRef.current = true

      const summaryText = opts?.summary ?? pendingSummary
      const source = amendmentSourceRef.current ?? amendmentSource

      console.groupCollapsed(
        `%c[edit] accepted amendments · ${changedIds.length} slide(s) changed`,
        'color:#4ade80;font-weight:bold'
      )
      console.log('pending changes:', changesLog)
      console.log('slides changed:', changedIds)
      console.groupEnd()

      let linkedDecisionId = pendingDecisionId
      if (!linkedDecisionId && source === 'agent' && changedIds.length > 0) {
        linkedDecisionId = crypto.randomUUID()
        const decision: DecisionRecord = {
          id: linkedDecisionId,
          timestamp: Date.now(),
          slideIds: changedIds,
          selectedElementIds: [],
          instruction: summaryText || 'Agent edit',
          proposedSummary: summaryText || 'Agent edit',
          proposedChanges: changesLog ?? [],
          status: 'accepted',
          snapshotBefore: JSON.parse(JSON.stringify(before)),
        }
        setDecisions(prev => [...prev, decision])
        if (presentationId) {
          persistDecision(presentationId, decision).catch(e =>
            console.warn('[persist] agent decision failed', e)
          )
        }
      }

      const versionId = crypto.randomUUID()
      const diff = summarizeDeckChanges(before, afterSlides)
      const version: SlideVersion = {
        id: versionId,
        timestamp: Date.now(),
        label: null,
        changeLog: `${summaryText || 'Changes applied'} · ${diff.text}`,
        slides: JSON.parse(JSON.stringify(afterSlides)),
        decisionId: linkedDecisionId,
        slideCount: afterSlides.length,
        changedSlideIds: changedIds,
        ...makeBranchMeta(),
        ...versionActorFields(),
      }
      setVersions(prev => [...prev, version])
      setCurrentVersionId(version.id)

      if (pendingDecisionId) {
        setDecisions(prev => prev.map(d =>
          d.id === pendingDecisionId ? { ...d, status: 'accepted' } : d
        ))
        setDecisionStatus(pendingDecisionId, 'accepted').catch(e =>
          console.warn('[persist] decision accept failed', e)
        )
        setPendingDecisionId(null)
      }

      pushHistory()
      slidesRef.current = afterSlides
      setSlides(afterSlides)
      closeManualSession(afterSlides)

      if (!afterSlides.some(s => s.id === activeSlideId)) {
        const nextActive = afterSlides[0]?.id
        if (nextActive) {
          setActiveSlideId(nextActive)
          setSelectedSlideIds([nextActive])
          setSelectionAnchorId(nextActive)
        }
      } else {
        setSelectedSlideIds(prev => prev.filter(id => afterSlides.some(s => s.id === id)))
      }

      setAmendmentCheckpoint(null)
      amendmentCheckpointRef.current = null
      setAmendmentSource(null)
      amendmentSourceRef.current = null
      setAgentRunIncomplete(false)
      incompleteAgentContextRef.current = null
      setPendingChanges(null)
      pendingChangesRef.current = null
      setPendingSummary('')
      setRefineNote(null)
      setHighlightDiffOnCanvas(false)
      setIsPreviewOpen(false)
      setSelectedElementIds([])
      setEditingElementId(null)
      setPendingAgentInstruction(null)

      if (presentationId) {
        clearEditorSessionLocal(presentationId)
        savePresentation(presentationId, {
          slides: afterSlides,
          editorSession: null,
        }).catch(e => console.warn('[persist] save presentation failed', e))
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
    },
    [
      pendingChanges,
      pendingSummary,
      pendingDecisionId,
      slides,
      amendmentCheckpoint,
      amendmentSource,
      presentationId,
      activeSlideId,
      makeBranchMeta,
      closeManualSession,
      canEdit,
      pushHistory,
    ]
  )

  const applyChanges = useCallback(() => commitAmendments(), [commitAmendments])

  // ── Discard all pending amendments (revert canvas to checkpoint) ─────────────
  const discardChanges = useCallback((reason?: string) => {
    const rejectionReason = typeof reason === 'string' ? reason.trim() || undefined : undefined
    if (isAgentRunningRef.current) {
      agentStopRef.current = true
      agentAbortRef.current?.abort()
    }
    amendmentsCommittedRef.current = true
    if (amendmentCheckpoint) {
      const restored = JSON.parse(JSON.stringify(amendmentCheckpoint)) as SlideData[]
      setSlides(restored)
      slidesRef.current = restored
    }
    setAmendmentCheckpoint(null)
    amendmentCheckpointRef.current = null
    setAmendmentSource(null)
    amendmentSourceRef.current = null
    setAgentRunIncomplete(false)
    incompleteAgentContextRef.current = null
    setPendingChanges(null)
    pendingChangesRef.current = null
    setPendingSummary('')
    setRefineNote(null)
    setHighlightDiffOnCanvas(false)
    setIsPreviewOpen(false)
    setPendingAgentInstruction(null)
    setDisplay(prev =>
      prev.map(m => (m.patchStatus === 'pending' ? { ...m, patchStatus: 'declined' as const } : m))
    )
    if (presentationId) {
      clearEditorSessionLocal(presentationId)
      savePresentation(presentationId, { editorSession: null }).catch(e =>
        console.warn('[persist] clear editor session failed', e)
      )
    }
    if (pendingDecisionId) {
      setDecisions(prev => prev.map(d =>
        d.id === pendingDecisionId ? { ...d, status: 'rejected', rejectionReason } : d
      ))
      setDecisionStatus(pendingDecisionId, 'rejected', rejectionReason ?? '').catch(e =>
        console.warn('[persist] decision reject failed', e)
      )
      setPendingDecisionId(null)
    }
  }, [pendingDecisionId, amendmentCheckpoint, presentationId])

  const applyPartialAmendmentAccept = useCallback(
    (accepted: Change[], remaining: Change[]) => {
      if (!amendmentCheckpoint || !effectivePendingChanges || !canEdit) return
      if (!remaining.length) {
        commitAmendments({
          before: amendmentCheckpoint,
          after: slidesRef.current ?? slides,
          changes: effectivePendingChanges,
        })
        return
      }
      const newCheckpoint = applyChangesToSlides(amendmentCheckpoint, accepted)
      setAmendmentCheckpoint(newCheckpoint)
      amendmentCheckpointRef.current = newCheckpoint
      setPendingChanges(remaining)
      pendingChangesRef.current = remaining
      const newSlides = applyChangesToSlides(newCheckpoint, remaining)
      setSlides(newSlides)
      slidesRef.current = newSlides
    },
    [amendmentCheckpoint, effectivePendingChanges, slides, canEdit, commitAmendments]
  )

  const acceptAmendmentForElement = useCallback(
    (elementId: string) => {
      if (!effectivePendingChanges || !amendmentCheckpoint || !canEdit) return
      const accepted = filterChangesByElements(effectivePendingChanges, [elementId])
      if (!accepted.length) return
      const remaining = excludeChangesByElements(effectivePendingChanges, [elementId])
      applyPartialAmendmentAccept(accepted, remaining)
    },
    [effectivePendingChanges, amendmentCheckpoint, canEdit, applyPartialAmendmentAccept]
  )

  const declineAmendmentForElement = useCallback(
    (elementId: string) => {
      if (!effectivePendingChanges || !amendmentCheckpoint || !canEdit) return
      const remaining = excludeChangesByElements(effectivePendingChanges, [elementId])
      if (remaining.length === effectivePendingChanges.length) return
      if (remaining.length === 0) {
        discardChanges()
        return
      }
      const newSlides = applyChangesToSlides(amendmentCheckpoint, remaining)
      setSlides(newSlides)
      slidesRef.current = newSlides
      setPendingChanges(remaining)
      pendingChangesRef.current = remaining
    },
    [effectivePendingChanges, amendmentCheckpoint, canEdit, discardChanges]
  )

  const acceptSelectedAmendments = useCallback(() => {
    if (!effectivePendingChanges || !amendmentCheckpoint || selectedElementIds.length === 0 || !canEdit)
      return
    const accepted = filterChangesByElements(effectivePendingChanges, selectedElementIds)
    if (accepted.length === 0) return
    const remaining = excludeChangesByElements(effectivePendingChanges, selectedElementIds)
    setSelectedElementIds([])
    applyPartialAmendmentAccept(accepted, remaining)
  }, [
    effectivePendingChanges,
    amendmentCheckpoint,
    selectedElementIds,
    canEdit,
    applyPartialAmendmentAccept,
  ])

  const declineSelectedAmendments = useCallback(() => {
    if (!effectivePendingChanges || !amendmentCheckpoint || selectedElementIds.length === 0 || !canEdit)
      return
    const remaining = excludeChangesByElements(effectivePendingChanges, selectedElementIds)
    if (remaining.length === effectivePendingChanges.length) return
    if (remaining.length === 0) {
      discardChanges()
      setSelectedElementIds([])
      return
    }
    const newSlides = applyChangesToSlides(amendmentCheckpoint, remaining)
    setSlides(newSlides)
    slidesRef.current = newSlides
    setPendingChanges(remaining)
    pendingChangesRef.current = remaining
    setSelectedElementIds([])
  }, [effectivePendingChanges, amendmentCheckpoint, selectedElementIds, canEdit, discardChanges])

  const acceptSlideAmendments = useCallback(() => {
    if (!effectivePendingChanges || !amendmentCheckpoint || !activeSlideId || !canEdit) return
    const accepted = filterChangesBySlide(effectivePendingChanges, activeSlideId)
    if (accepted.length === 0) return
    const remaining = excludeChangesBySlide(effectivePendingChanges, activeSlideId)
    if (!remaining.length) {
      commitAmendments({
        before: amendmentCheckpoint,
        after: slides,
        changes: effectivePendingChanges,
      })
      return
    }
    const newCheckpoint = applyChangesToSlides(amendmentCheckpoint, accepted)
    setAmendmentCheckpoint(newCheckpoint)
    setPendingChanges(remaining)
    pendingChangesRef.current = remaining
    const newSlides = applyChangesToSlides(newCheckpoint, remaining)
    setSlides(newSlides)
    slidesRef.current = newSlides
    setSelectedElementIds([])
  }, [
    effectivePendingChanges,
    amendmentCheckpoint,
    activeSlideId,
    slides,
    canEdit,
    commitAmendments,
  ])

  const declineSlideAmendments = useCallback(() => {
    if (!effectivePendingChanges || !amendmentCheckpoint || !activeSlideId || !canEdit) return
    const remaining = excludeChangesBySlide(effectivePendingChanges, activeSlideId)
    if (remaining.length === effectivePendingChanges.length) return
    if (remaining.length === 0) {
      discardChanges()
      setSelectedElementIds([])
      return
    }
    const newSlides = applyChangesToSlides(amendmentCheckpoint, remaining)
    setSlides(newSlides)
    slidesRef.current = newSlides
    setPendingChanges(remaining)
    pendingChangesRef.current = remaining
    setSelectedElementIds([])
  }, [effectivePendingChanges, amendmentCheckpoint, activeSlideId, canEdit, discardChanges])

  const navigatePendingSlide = useCallback(
    (direction: -1 | 1) => {
      if (pendingSlideIds.length === 0) return
      const currentIdx =
        activePendingSlideIndex >= 0 ? activePendingSlideIndex : direction === 1 ? -1 : 0
      const nextIdx =
        (currentIdx + direction + pendingSlideIds.length) % pendingSlideIds.length
      const targetId = pendingSlideIds[nextIdx]
      setActiveSlideId(targetId)
      setSelectedSlideIds([targetId])
      setSelectionAnchorId(targetId)
      setSelectedElementIds([])
      setEditingElementId(null)
    },
    [pendingSlideIds, activePendingSlideIndex]
  )

  // ── Undo last action (incremental, step-by-step like PowerPoint) ──────────────
  const revert = useCallback(() => {
    if (slideHistory.length === 0) return
    const prev = slideHistory[slideHistory.length - 1]
    setSlides(JSON.parse(JSON.stringify(prev)) as SlideData[])
    setSlideHistory(h => h.slice(0, -1))
    setAmendmentCheckpoint(null)
    setAmendmentSource(null)
    setAgentRunIncomplete(false)
    incompleteAgentContextRef.current = null
    setPendingChanges(null)
    pendingChangesRef.current = null
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

      if (e.key === 'Escape' && !inField) {
        if (commentPlacementMode || pendingCommentPin || showComments) {
          e.preventDefault()
          closeCommentsUi()
          return
        }
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
    commentPlacementMode,
    pendingCommentPin,
    showComments,
    closeCommentsUi,
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

        const refineBranchId =
          activeBranchIdRef.current ??
          presentationSummaries.find(p => p.id === presentationId)?.branchId ??
          null
        const refineLayerCtx = buildKnowledgeContext(knowledgeLayers, decisions, activeSlideId, {
          instruction: text,
          slideText: activeSlideText(slides, activeSlideId),
        })
        const refineGraphCtx = await fetchGraphKnowledgeContext({
          branchId: refineBranchId,
          presentationId,
          instruction: text,
          charBudget: 6000,
        })
        const refineCommentsCtx = buildCommentsContext(deckComments, slides, activeSlideId, {
          instruction: text,
        })
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
            knowledgeContext: mergeKnowledgeContexts(
              mergeKnowledgeContexts(refineLayerCtx, refineGraphCtx),
              refineCommentsCtx
            ),
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
      deckComments,
      activeSlideId,
      designSystem,
      collectAllAssets,
      presentationId,
      presentationSummaries,
    ]
  )

  // ── Restore a version (move the CURRENT pointer, no new snapshot) ─────────────
  // Restoring does NOT create a new version. It rolls the deck back to the chosen
  // snapshot and marks it as "current" — the latest version stays the latest. The
  // panel shows an amber "viewing v1 · latest is v2" remark. One-step undo (Revert
  // button) still works because we push the prior deck onto the local history.
  const restoreVersion = useCallback((v: SlideVersion) => {
    if (!canEdit) return
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
  }, [activeSlideId, pushHistory, closeManualSession, canEdit])

  // ── Restore single slide from a version ───────────────────────────────────────
  const restoreSlide = useCallback((slideId: string, fromVersion: SlideVersion) => {
    if (!canEdit) return
    const slideSnapshot = fromVersion.slides.find(s => s.id === slideId)
    if (!slideSnapshot) return
    setSlides(prev => prev.map(s => s.id === slideId ? JSON.parse(JSON.stringify(slideSnapshot)) : s))
    setPendingChanges(null)
  }, [canEdit])

  // ── Name a version milestone ──────────────────────────────────────────────────
  const nameVersion = useCallback((id: string, label: string) => {
    if (!canEdit) return
    setVersions(prev => prev.map(v => v.id === id ? { ...v, label: label.trim() || null } : v))
    // Persist label
    fetch('/api/versions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, label: label.trim() || null }),
    }).catch(() => {})
  }, [canEdit])

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

  const knowledgeBranchId =
    activeBranchId ??
    presentationSummaries.find(p => p.id === presentationId)?.branchId ??
    null

  const knowledgeHubName =
    branches.find(b => b.id === knowledgeBranchId)?.name ?? null

  const openKnowledgePanel = useCallback(async () => {
    const bid =
      activeBranchIdRef.current ??
      presentationSummaries.find(p => p.id === presentationId)?.branchId ??
      null
    if (bid) await loadBranchKnowledge(bid)
    setShowKnowledge(true)
  }, [loadBranchKnowledge, presentationSummaries, presentationId])

  // Knowledge + Design System modals are shared between the portfolio (Knowledge
  // Hub) view and the deck editor, so they can be opened from either place.
  const knowledgeAndDesignModals = (
    <>
      {showKnowledge && (
        <KnowledgePanel
          layers={knowledgeLayers}
          onChange={handleKnowledgeChange}
          onClose={() => {
            setShowKnowledge(false)
            if (presentationId) void loadDeckElementLinks(presentationId)
          }}
          branchId={knowledgeBranchId}
          hubName={knowledgeHubName}
          presentationId={presentationId}
          presentationName={presentationSummaries.find(p => p.id === presentationId)?.name ?? null}
          readOnly={!canModerateHubKnowledge}
          initialTab={presentationId ? 'graph' : 'sources'}
          onDeckLinksChange={() => {
            if (presentationId) void loadDeckElementLinks(presentationId)
          }}
          showMappingPins={showKnowledgePins}
          onShowMappingPinsChange={setShowKnowledgePinsPersisted}
        />
      )}
      {showDesignSystem && (
        <DesignSystemPanel
          dsId={dsId}
          initialName={dsName}
          initialFiles={dsFiles}
          onChange={handleDesignSystemChange}
          onClose={closeDesignSystem}
          slideCount={slides.length}
          canApplyToDeck={canEdit && !isLoading && !isAgentRunning && !pendingChanges}
          isApplyingToDeck={isAgentRunning}
          onApplyToDeck={applyDesignSystemToDeck}
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
            onClick={() => void openKnowledgePanel()}
            title={`Knowledge hub: documents, graph, and ${knowledgeLayers.filter(l => l.enabled).length} text layers`}
            className="flex items-center gap-1 p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            <Brain className="w-4 h-4" />
            <span className="text-[10px] font-mono text-[#64748B]">{knowledgeLayers.filter(l => l.enabled).length}</span>
          </button>
          <button
            onClick={e => {
              if (e.altKey || e.metaKey) {
                setCommentPlacementMode(false)
                setPendingCommentPin(null)
                setShowComments(true)
              } else {
                startCommentPlacement()
              }
            }}
            title={`Add comment — click slide to place · ⌥/Alt+click for list (${deckComments.filter(c => !c.resolved).length} open)`}
            className={`flex items-center gap-1 p-1.5 rounded transition-colors ${
              commentPlacementMode
                ? 'bg-teal-600/20 text-teal-300'
                : 'text-[#94a3b8] hover:bg-[#1e3a5f] hover:text-white'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span className="text-[10px] font-mono text-[#64748B]">
              {deckComments.filter(c => !c.resolved).length}
            </span>
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
              {tab === 'design' && selectedElementIds.length >= 1 && (
                <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[#60a5fa] align-middle" />
              )}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {leftTab === 'slides' ? (
            <SlidePanel
              slides={displaySlides}
              activeSlideId={activeSlideId}
              selectedSlideIds={selectedSlideIds}
              pendingSlideIds={pendingSlideIds}
              deletedSlideIds={pendingDeletedSlideIds}
              onSelect={handleSlideSelect}
              onSelectAll={selectAllSlides}
              onReorder={reorderSlides}
              onAddSlide={() => addSlide()}
              linkedSlideIds={deckLinkIndex.linkedSlideIds}
              linkedElementIdsBySlide={linkedElementIdsBySlide}
              knowledgeLinkByElementId={knowledgeLinkByElementId}
              showKnowledgePins={showKnowledgePins}
            />
          ) : (
            <ElementInspector
              element={selectedElements.length === 1 ? selectedElements[0] : null}
              elements={selectedElements}
              selectedCount={selectedElementIds.length}
              deckFonts={deckFonts}
              onUpdate={updateElementWithHistory}
              onUpdateMany={updateElementsWithHistory}
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

      {/* Center — canvas + amendments bar */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col bg-[#060d1a] min-h-0 overflow-hidden">
          {effectivePendingChanges && effectivePendingChanges.length > 0 && !isAgentRunning && (
            <AmendmentsBar
              changeCount={effectivePendingChanges.length}
              slideCount={pendingSlideIds.length}
              summary={pendingSummary}
              selectedAmendmentCount={selectedPendingAmendmentCount}
              activeSlideChangeCount={activeSlidePendingCount}
              activePendingSlideIndex={activePendingSlideIndex}
              source={amendmentSource ?? 'single'}
              incomplete={agentRunIncomplete}
              onAcceptAll={applyChanges}
              onDeclineAll={() => discardChanges()}
              onAcceptSelected={acceptSelectedAmendments}
              onDeclineSelected={declineSelectedAmendments}
              onAcceptSlide={acceptSlideAmendments}
              onDeclineSlide={declineSlideAmendments}
              onPrevPendingSlide={() => navigatePendingSlide(-1)}
              onNextPendingSlide={() => navigatePendingSlide(1)}
            />
          )}
          {(
            <>
              <div ref={canvasOverlayRef} className="relative flex-1 min-h-0 overflow-hidden">
                {commentPlacementMode && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0f172a]/95 border border-teal-500/40 text-xs text-teal-100 shadow-lg">
                      <Pin className="w-3 h-3 shrink-0" />
                      Click the slide to place a comment
                      <span className="text-[#64748B]">· Esc to cancel</span>
                      <button
                        type="button"
                        className="pointer-events-auto ml-1 text-teal-400 hover:text-teal-200 underline"
                        onClick={() => {
                          setCommentPlacementMode(false)
                          setShowComments(true)
                        }}
                      >
                        All comments
                      </button>
                    </div>
                  </div>
                )}
                <div ref={canvasViewportRef} className="absolute inset-0 overflow-auto">
                <div
                  ref={canvasScrollContentRef}
                  className="box-border flex w-max min-w-full min-h-full items-center justify-center p-6"
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
                  className={`relative rounded-lg shadow-2xl flex-shrink-0 p-3 bg-[#060d1a]/40 overflow-visible`}
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
                    highlightedElementIds={pendingHighlightedElementIds}
                    deletedElementIds={
                      effectivePendingChanges
                        ? getDeletedElementIds(effectivePendingChanges, activeSlide.id)
                        : []
                    }
                    highlightColor="green"
                    showDiffHighlights={!!effectivePendingChanges && effectivePendingChanges.length > 0}
                    amendmentElementIds={pendingHighlightedElementIds}
                    compareSlide={
                      amendmentCheckpoint?.find(s => s.id === activeSlide.id) ?? null
                    }
                    amendmentReview={!!effectivePendingChanges?.length}
                    onAcceptAmendment={acceptAmendmentForElement}
                    onDeclineAmendment={declineAmendmentForElement}
                    editingElementId={editingElementId}
                    scale={canvasScale}
                    showKnowledgePins={showKnowledgePins}
                    knowledgeLinkedElementIds={activeSlideLinkedElementIds}
                    knowledgeLinkByElementId={knowledgeLinkByElementId}
                    interactive={!annotationMode && !commentPlacementMode && !isAgentRunning && canEdit}
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
                  <CommentPinLayer
                    width={SLIDE_WIDTH}
                    height={SLIDE_HEIGHT}
                    placementMode={commentPlacementMode}
                    pins={commentsOnSlide(deckComments, activeSlideId)}
                    pendingPin={pendingCommentPin}
                    onPlacePin={handleCommentPinPlace}
                    onPinClick={handleCommentPinClick}
                  />
                  </div>
                </div>
                </div>
                </div>
                <CanvasZoomControls
                  zoom={canvasZoom}
                  onZoomChange={handleCanvasZoomChange}
                  min={CANVAS_ZOOM_MIN}
                  max={CANVAS_ZOOM_MAX}
                  step={CANVAS_ZOOM_STEP}
                  slideIndex={slides.findIndex(s => s.id === activeSlideId)}
                  slideCount={slides.length}
                  onPrevSlide={() => goToAdjacentSlide(-1)}
                  onNextSlide={() => goToAdjacentSlide(1)}
                />
                <CanvasFloatingToolbar
                  containerRef={canvasOverlayRef}
                  deckFonts={deckFonts}
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
                    designSystem,
                  }}
                  onRunQuickAction={runQuickAction}
                  quickActionsDisabled={isLoading || isAgentRunning || !!pendingChanges}
                  showKnowledgePins={showKnowledgePins}
                  onShowKnowledgePinsChange={setShowKnowledgePinsPersisted}
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
            onResend={resendMessage}
            draft={chatDraft}
            slides={slides}
            pendingChanges={effectivePendingChanges}
            pendingSummary={pendingSummary}
            amendmentSource={amendmentSource}
            amendmentCheckpoint={amendmentCheckpoint}
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
      {isPreviewOpen && effectivePendingChanges && (
        <ProposalPreviewModal
          slides={amendmentCheckpoint ?? slides}
          changes={effectivePendingChanges}
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

      {showComments && (
        <CommentsPanel
          comments={deckComments}
          slides={slides}
          activeSlideId={activeSlideId}
          selectedSlideIds={selectedSlideIds}
          selectedElementIds={selectedElementIds}
          loading={commentsLoading}
          busy={commentsBusy}
          pendingPin={pendingCommentPin}
          highlightId={highlightedCommentId}
          onAdd={addDeckComment}
          onToggleResolved={toggleDeckCommentResolved}
          onDelete={deleteDeckComment}
          onClose={closeCommentsUi}
          onCancelCompose={startCommentPlacement}
        />
      )}

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
          readOnly={!canEdit}
        />
      )}
    </div>
    </DesignTokensProvider>
  )
}
