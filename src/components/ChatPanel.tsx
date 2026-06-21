'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ImagePlus,
  RotateCcw,
  RefreshCw,
  X,
  Bot,
  Search,
  Camera,
  Pencil,
  Check,
  AlertTriangle,
  Brain,
  Sparkles,
  Zap,
  Maximize2,
  Trash2,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Square,
  PanelRightClose,
  Pin,
  Eye,
  Layers,
  MessageSquare,
} from 'lucide-react'
import {
  Change,
  ClaudeResponse,
  ClarificationOption,
  ClarificationQuestion,
  SlideData,
} from '@/lib/types'
import type { DeckPlan } from '@/lib/agent/planner/types'
import { applyChangesToSlides, getDeletedSlideIds } from '@/lib/preview'
import {
  buildStepLimitError,
  buildTimeoutError,
  formatAgentLimitError,
  parseAgentLimitError,
  type AgentLimitReached,
} from '@/lib/agent/limitError'
import SlideCanvas from '@/components/SlideCanvas'

export type ChatMode = 'agent'

export interface DisplayMessage {
  role: 'user' | 'assistant'
  text?: string           // user messages
  imageUrl?: string       // optional annotated-slide thumbnail on user messages
  imageUrls?: string[]    // optional user-uploaded reference images on user messages
  userId?: string
  userName?: string
  userImage?: string | null
  response?: ClaudeResponse // assistant messages
  // Resolution state of a patch proposal bubble (drives the inline widget UI).
  patchStatus?: 'pending' | 'approved' | 'declined'
  // Live agent-loop step (inspect / render / apply / verify) for the tool-using editor.
  agentStep?: {
    kind: 'read' | 'render' | 'apply' | 'note' | 'thinking' | 'done' | 'error' | 'plan' | 'review'
    label: string
    image?: string
    limitReached?: AgentLimitReached
    /** Q&A runs: group reasoning/activity for collapsible UI. */
    processSection?: 'reasoning' | 'activity'
  }
  /** Clean prose answer for Q&A (no agent step tags). */
  assistantAnswer?: string
  /** Phase 1 planner output — renders DeckPlanBubble with Approve / Revise. */
  deckPlan?: DeckPlan
  /** Phase 2 completion offer — renders PhaseCompleteBubble with layout-pass CTA. */
  layoutOffer?: { slideCount: number }
  /** Which multi-agent pipeline phase this bubble belongs to. */
  pipelinePhase?: 'plan' | 'content' | 'layout'
  // Cursor-style checkpoint: deck snapshot taken right before this user message
  // was sent, so we can revert everything this message (and later) changed.
  checkpoint?: SlideData[]
  // conversationHistory length before this user message, for truncation on revert.
  historyLength?: number
}

interface Props {
  isLoading: boolean
  isAgentRunning?: boolean
  canEdit?: boolean
  selectedSlideIds: string[]
  selectedElementIds: string[]
  display: DisplayMessage[]
  // mode: 'auto' lets the app route between single-shot and the agent; 'single'/'agent' force it.
  onSend: (text: string, images: string[], mode: ChatMode) => void
  // Whether the agent flow is available (gates the mode control).
  onRunAgent?: (text: string) => void
  // Cancel an in-flight agent run.
  onStopAgent?: () => void
  onPickOption: (option: ClarificationOption) => void
  // Submit a consolidated answer for a multi-question structured clarification.
  onSubmitAnswers?: (text: string) => void
  // Restore the deck to this message's checkpoint and load its text for editing.
  onRevert?: (index: number) => void
  // Retruncate chat and resend this message to the AI (works even without a checkpoint).
  onResend?: (index: number) => void
  // When set (nonce changes), prefill the input with this text (used by revert/edit).
  draft?: { text: string; nonce: number }
  // ── Inline proposal widget ──
  slides?: SlideData[]                 // current deck, to render the proposed thumbnail
  pendingChanges?: Change[] | null     // the live (unresolved) proposal
  pendingSummary?: string              // live proposal summary (kept fresh after refine)
  amendmentSource?: 'single' | 'agent' | null
  amendmentCheckpoint?: SlideData[] | null
  onApproveProposal?: () => void
  onDeclineProposal?: () => void
  onOpenProposal?: () => void          // open the full preview overlay
  // ── Multi-agent pipeline ──
  // Called when the user approves a Phase 1 plan; triggers content build.
  onApprovePlan?: (plan: DeckPlan) => void
  // Called when the user wants to revise the plan before building.
  onRevisePlan?: (plan: DeckPlan, feedback: string) => void
  // Called when the user accepts the Phase 3 layout-pass offer.
  onRunLayoutPass?: () => void
  // Collapse/hide the chat sidebar (toggle lives in the header).
  onCollapse?: () => void
  // True while the collapsed panel is being hover-previewed (peeking). In this
  // state the header button pins the panel open instead of closing it.
  peeking?: boolean
  // Pin the peeking panel open (keep it docked).
  onPin?: () => void
}

const MAX_IMAGES = 6

const MODE_OPTIONS: { id: ChatMode; Icon: typeof Bot; label: string; title: string }[] = [
  {
    id: 'agent',
    Icon: Bot,
    label: 'Agent',
    title: 'Agent — reads slides, reasons about your goal, edits, verifies',
  },
]

function readFilesAsDataUrls(files: File[]): Promise<string[]> {
  return Promise.all(
    files
      .filter(file => file.type.startsWith('image/'))
      .map(
        file =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
      )
  )
}

export default function ChatPanel({
  isLoading,
  isAgentRunning,
  canEdit = true,
  selectedSlideIds,
  selectedElementIds,
  display,
  onSend,
  onRunAgent,
  onStopAgent,
  onPickOption,
  onSubmitAnswers,
  onRevert,
  onResend,
  draft,
  slides,
  pendingChanges,
  pendingSummary,
  amendmentSource,
  amendmentCheckpoint,
  onApproveProposal,
  onDeclineProposal,
  onOpenProposal,
  onApprovePlan,
  onRevisePlan,
  onRunLayoutPass,
  onCollapse,
  peeking,
  onPin,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [mode, setMode] = useState<ChatMode>('agent')
  const [modeMenuOpen, setModeMenuOpen] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [display, isLoading])

  // Close the mode dropdown on outside click / Escape.
  useEffect(() => {
    if (!modeMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!modeMenuRef.current?.contains(e.target as Node)) setModeMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModeMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [modeMenuOpen])

  // Prefill input when a revert/edit loads a previous message's text.
  const draftNonce = draft?.nonce
  useEffect(() => {
    if (!draftNonce) return
    setText(draft?.text ?? '')
    const el = inputRef.current
    if (el) {
      el.focus()
      const len = (draft?.text ?? '').length
      el.setSelectionRange(len, len)
    }
  }, [draftNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grow the textarea up to a max height.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const addImages = async (files: File[]) => {
    if (files.length === 0) return
    const urls = await readFilesAsDataUrls(files)
    if (urls.length === 0) return
    setImages(prev => [...prev, ...urls].slice(0, MAX_IMAGES))
  }

  const send = () => {
    const val = text.trim()
    if ((!val && images.length === 0) || isLoading || !canEdit) return
    // When the agent flow isn't wired up, always use single-shot.
    onSend(val, images, 'agent')
    setText('')
    setImages([])
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-[#1e3a5f] flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-xs font-semibold text-[#64748b] tracking-widest">AI EDITOR</p>
            {!canEdit && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 border border-amber-500/40 bg-amber-500/10 rounded px-1.5 py-0.5 shrink-0">
                <Eye className="w-3 h-3" /> VIEW-ONLY
              </span>
            )}
          </div>
          {peeking && onPin ? (
            <button
              type="button"
              onClick={onPin}
              title="Pin chat panel open"
              aria-label="Pin chat panel open"
              className="-mr-1 flex h-6 w-6 items-center justify-center rounded text-[#475569] transition-colors hover:bg-[#1e3a5f] hover:text-[#93c5fd]"
            >
              <Pin className="h-4 w-4" />
            </button>
          ) : (
            onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                title="Hide chat panel"
                aria-label="Hide chat panel"
                className="-mr-1 flex h-6 w-6 items-center justify-center rounded text-[#475569] transition-colors hover:bg-[#1e3a5f] hover:text-[#93c5fd]"
              >
                <PanelRightClose className="h-4 w-4" />
              </button>
            )
          )}
        </div>
        {!canEdit && (
          <p className="text-[10px] text-amber-300/80 mt-1">
            You&apos;re a viewer on this hub — editing is disabled. Ask an owner for editor access.
          </p>
        )}
        {selectedSlideIds.length > 1 && (
          <p className="text-xs text-[#2dd4bf] mt-1">
            ◈ {selectedSlideIds.length} slides in scope
            {' '}(
            {selectedSlideIds
              .map(id => id.replace('slide-', ''))
              .join(', ')}
            )
          </p>
        )}
        {selectedElementIds.length > 0 && (
          <p className="text-xs text-[#60a5fa] mt-1">
            ◈ {selectedElementIds.length} element{selectedElementIds.length > 1 ? 's' : ''} selected
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {(() => {
          // Only the LAST patch bubble can be the live (interactive) proposal.
          let lastPatchIdx = -1
          display.forEach((m, i) => {
            if (m.response?.type === 'patch') lastPatchIdx = i
          })
          const renderItems = buildChatRenderItems(display)
          return renderItems.map(item => {
            if (item.kind === 'process') {
              return (
                <AgentProcessPanel
                  key={`process-${item.index}`}
                  steps={item.steps}
                />
              )
            }
            const i = item.index
            const msg = item.msg
            const isLivePending =
              i === lastPatchIdx &&
              msg.response?.type === 'patch' &&
              msg.patchStatus === 'pending' &&
              pendingChanges != null
            return (
              <div key={i}>
                {msg.role === 'user' ? (
                  <UserBubble
                    text={msg.text ?? ''}
                    imageUrl={msg.imageUrl}
                    imageUrls={msg.imageUrls}
                    userName={msg.userName}
                    userImage={msg.userImage}
                    onRevert={
                      msg.checkpoint && onRevert && canEdit ? () => onRevert(i) : undefined
                    }
                    onResend={
                      msg.text?.trim() && onResend && canEdit ? () => onResend(i) : undefined
                    }
                  />
                ) : msg.deckPlan ? (
                  <DeckPlanBubble
                    plan={msg.deckPlan}
                    onApprove={onApprovePlan ? () => onApprovePlan(msg.deckPlan!) : undefined}
                    onRevise={
                      onRevisePlan
                        ? (feedback: string) => onRevisePlan(msg.deckPlan!, feedback)
                        : undefined
                    }
                  />
                ) : msg.layoutOffer ? (
                  <PhaseCompleteBubble
                    slideCount={msg.layoutOffer.slideCount}
                    onRunLayoutPass={onRunLayoutPass}
                  />
                ) : msg.assistantAnswer ? (
                  <AssistantAnswerBubble text={msg.assistantAnswer} />
                ) : msg.agentStep ? (
                  <AgentStepBubble
                    step={msg.agentStep}
                    canEdit={canEdit}
                    onContinue={() => onSend('continue', [], 'agent')}
                    onNewRequest={() => {
                      setText('')
                      const el = inputRef.current
                      if (el) {
                        el.focus()
                        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                      }
                    }}
                  />
                ) : msg.response ? (
                  <AssistantBubble
                    response={msg.response}
                    onPickOption={onPickOption}
                    onSubmitAnswers={onSubmitAnswers}
                    patchStatus={msg.patchStatus}
                    isLivePending={isLivePending}
                    slides={slides}
                    liveChanges={isLivePending ? pendingChanges ?? undefined : undefined}
                    liveSummary={isLivePending ? pendingSummary : undefined}
                    onApproveProposal={onApproveProposal}
                    onDeclineProposal={onDeclineProposal}
                    onOpenProposal={onOpenProposal}
                  />
                ) : null}
              </div>
            )
          })
        })()}

        {isLoading && (
          <div className="flex items-center gap-2 px-1">
            <div className="flex items-center gap-1.5">
              {[0, 200, 400].map(delay => (
                <span
                  key={delay}
                  className="w-1.5 h-1.5 rounded-full bg-[#64748b] animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
            {isAgentRunning && (
              <span className="text-xs text-[#a78bfa] flex items-center gap-1">
                <Bot className="w-3 h-3" /> agent working…
              </span>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input — Cursor-style composer: textarea on top, controls in the corners */}
      <div className="p-3 border-t border-[#1e3a5f] flex-shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={async e => {
            await addImages(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <div
          className="rounded-xl border border-[#1e3a5f] bg-[#112236] px-2.5 pt-2 pb-1.5
                     focus-within:border-[#60a5fa] transition-colors"
        >
          {/* Attached image thumbnails */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {images.map((url, i) => (
                <div
                  key={i}
                  className="relative w-12 h-12 rounded-md overflow-hidden border border-[#1e3a5f] group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Attachment ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    title="Remove image"
                    className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded-full
                               bg-[#0d1b2a]/90 text-[#94a3b8] hover:text-white hover:bg-[#ef4444] transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            onPaste={async e => {
              const files = Array.from(e.clipboardData.items)
                .filter(item => item.type.startsWith('image/'))
                .map(item => item.getAsFile())
                .filter((f): f is File => f !== null)
              if (files.length > 0) {
                e.preventDefault()
                await addImages(files)
              }
            }}
            placeholder={
              !canEdit
                ? 'View-only — you cannot edit this hub'
                : 'Describe the goal — agent reads slides, reasons, edits & verifies…'
            }
            disabled={isLoading || !canEdit}
            className="w-full resize-none bg-transparent border-0 px-1 py-1 text-sm
                       text-white placeholder-[#475569] outline-none focus:ring-0
                       disabled:opacity-50 leading-snug max-h-40"
          />

          {/* Bottom bar: mode dropdown (left) · image + send (right) */}
          <div className="flex items-center justify-between gap-2 mt-1">
            <div className="flex items-center min-w-0">
              {onRunAgent ? (
                <div className="relative" ref={modeMenuRef}>
                  <button
                    type="button"
                    onClick={() => setModeMenuOpen(o => !o)}
                    disabled={isLoading || !canEdit}
                    title="Select how the AI handles your request"
                    className="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-xs text-[#cbd5e1]
                               hover:bg-[#1e3a5f] disabled:opacity-40 transition-colors"
                  >
                    {(() => {
                      const cur = MODE_OPTIONS.find(o => o.id === mode)!
                      return (
                        <>
                          <cur.Icon className="w-3.5 h-3.5 text-[#a78bfa]" />
                          <span className="font-medium">{cur.label}</span>
                          <ChevronDown className="w-3.5 h-3.5 text-[#64748b]" />
                        </>
                      )
                    })()}
                  </button>
                  {modeMenuOpen && (
                    <div
                      className="absolute bottom-full left-0 mb-1.5 w-52 rounded-lg border border-[#1e3a5f]
                                 bg-[#0d1b2a] shadow-xl shadow-black/40 overflow-hidden z-20 py-1"
                    >
                      {MODE_OPTIONS.map(({ id, Icon, label, title }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setMode(id)
                            setModeMenuOpen(false)
                          }}
                          title={title}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                            mode === id
                              ? 'bg-[#1e3a5f] text-white'
                              : 'text-[#cbd5e1] hover:bg-[#13243a]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 flex-shrink-0 text-[#a78bfa]" />
                          <span className="font-medium">{label}</span>
                          {mode === id && <Check className="w-3.5 h-3.5 ml-auto text-[#4ade80]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-xs text-[#475569] pl-1.5">Single-shot</span>
              )}
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || !canEdit || images.length >= MAX_IMAGES}
                title={images.length >= MAX_IMAGES ? `Up to ${MAX_IMAGES} images` : 'Attach images'}
                className="p-1.5 rounded-md text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f]
                           disabled:opacity-40 transition-colors"
              >
                <ImagePlus className="w-4 h-4" />
              </button>
              {isLoading ? (
                <button
                  onClick={() => onStopAgent?.()}
                  title="Stop generating"
                  className="flex items-center justify-center w-7 h-7 rounded-full bg-[#60a5fa] text-[#0d1b2a]
                             hover:bg-[#93c5fd] transition-colors"
                >
                  <Square className="w-3 h-3 fill-current" />
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={(!text.trim() && images.length === 0) || !canEdit}
                  title="Send (Enter)"
                  className="flex items-center justify-center w-7 h-7 rounded-full bg-[#60a5fa] text-[#0d1b2a]
                             disabled:opacity-40 disabled:hover:bg-[#60a5fa] hover:bg-[#93c5fd] transition-colors"
                >
                  <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

type AgentStep = NonNullable<DisplayMessage['agentStep']>

type ChatRenderItem =
  | { kind: 'single'; index: number; msg: DisplayMessage }
  | { kind: 'process'; index: number; steps: AgentStep[] }

function buildChatRenderItems(display: DisplayMessage[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = []
  let i = 0
  while (i < display.length) {
    const msg = display[i]
    if (msg.role === 'assistant' && msg.agentStep?.processSection) {
      const start = i
      const steps: AgentStep[] = []
      while (i < display.length && display[i].agentStep?.processSection) {
        const step = display[i].agentStep
        if (step) steps.push(step)
        i++
      }
      items.push({ kind: 'process', index: start, steps })
      continue
    }
    items.push({ kind: 'single', index: i, msg })
    i++
  }
  return items
}

function AssistantAnswerBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] bg-[#112236] border border-[#1e3a5f] rounded-lg rounded-tl-none px-3 py-3">
        <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">{text}</p>
      </div>
    </div>
  )
}

function AgentProcessPanel({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState(true)
  const reasoning = steps.filter(s => s.processSection === 'reasoning')
  const activity = steps.filter(s => s.processSection === 'activity')
  if (reasoning.length === 0 && activity.length === 0) return null

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] w-full bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-[#13243a] transition-colors"
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#64748b] flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#64748b] flex-shrink-0" />
          )}
          <Brain className="w-3.5 h-3.5 text-[#818cf8] flex-shrink-0" />
          <span className="text-[10px] font-bold tracking-wider text-[#818cf8]">
            REASONING & STEPS
          </span>
          <span className="text-[10px] text-[#64748b] ml-auto">
            {reasoning.length} thought{reasoning.length !== 1 ? 's' : ''}
            {activity.length > 0 ? ` · ${activity.length} step${activity.length !== 1 ? 's' : ''}` : ''}
          </span>
        </button>
        {open && (
          <div className="px-2.5 pb-2 space-y-2 border-t border-[#1e3a5f]">
            {reasoning.map((step, idx) => (
              <p key={`r-${idx}`} className="text-xs text-[#a5b4fc] italic whitespace-pre-wrap leading-relaxed pt-2">
                {step.label}
              </p>
            ))}
            {activity.map((step, idx) => (
              <div key={`a-${idx}`} className="text-xs text-[#94a3b8]">
                <span className="text-[#60a5fa] font-medium">
                  {step.kind === 'render' ? 'Rendered' : 'Read'}
                </span>
                {' — '}
                {step.label}
                {step.image && (
                  <div className="mt-1.5 rounded-md overflow-hidden border border-[#1e3a5f]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={step.image} alt="Rendered slide" className="w-full block" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AgentStepBubble({
  step,
  canEdit,
  onContinue,
  onNewRequest,
}: {
  step: NonNullable<DisplayMessage['agentStep']>
  canEdit?: boolean
  onContinue?: () => void
  onNewRequest?: () => void
}) {
  const limitReached = step.limitReached ?? parseAgentLimitError(step.label)
  if (limitReached && step.kind === 'error') {
    return (
      <AgentLimitReachedBox
        info={limitReached}
        canEdit={canEdit}
        onContinue={onContinue}
        onNewRequest={onNewRequest}
      />
    )
  }

  const meta = {
    read: { Icon: Search, color: '#60a5fa', tag: 'INSPECT' },
    render: { Icon: Camera, color: '#2dd4bf', tag: 'RENDER' },
    apply: { Icon: Pencil, color: '#a78bfa', tag: 'EDIT' },
    note: { Icon: Bot, color: '#94a3b8', tag: 'AGENT' },
    thinking: { Icon: Brain, color: '#818cf8', tag: 'THINKING' },
    done: { Icon: Check, color: '#34d399', tag: 'DONE' },
    error: { Icon: AlertTriangle, color: '#f87171', tag: 'ERROR' },
    plan: { Icon: Brain, color: '#fbbf24', tag: 'PLAN' },
    review: { Icon: AlertTriangle, color: '#fb923c', tag: 'REVIEW' },
  }[step.kind]
  const { Icon, color, tag } = meta
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full bg-[#0d1b2a] border border-[#1e3a5f] rounded-lg px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
          <span className="text-[10px] font-bold tracking-wider" style={{ color }}>
            {tag}
          </span>
          <span
            className={`text-xs whitespace-pre-wrap ${
              step.kind === 'thinking' ? 'text-[#a5b4fc] italic' : 'text-[#cbd5e1]'
            }`}
          >
            {step.label}
          </span>
        </div>
        {step.image && (
          <div className="mt-1.5 rounded-md overflow-hidden border border-[#1e3a5f]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={step.image} alt="Rendered slide" className="w-full block" />
          </div>
        )}
      </div>
    </div>
  )
}

function AgentLimitReachedBox({
  info,
  canEdit,
  onContinue,
  onNewRequest,
}: {
  info: AgentLimitReached
  canEdit?: boolean
  onContinue?: () => void
  onNewRequest?: () => void
}) {
  const title =
    info.type === 'step_limit'
      ? `${info.stepLimit ?? '?'} step limit — paused`
      : info.type === 'apply_limit'
        ? `${info.applyLimit ?? '?'} edit limit — paused`
        : info.type === 'oscillation'
          ? 'Edit loop detected — paused'
          : info.type === 'no_tool_call'
            ? 'Agent stalled — paused'
            : info.type === 'spacing_limit'
              ? 'Spacing/balance limit — paused'
              : info.type === 'overloaded'
                ? 'API overloaded — paused'
                : info.type === 'rate_limit'
                  ? 'Rate limit — paused'
                  : 'Step timed out'
  const intro =
    info.type === 'step_limit'
      ? `The agent hit the ${info.stepLimit ?? '?'} step limit. Context is saved — Continue resumes from the exact step.`
      : info.type === 'apply_limit'
        ? `This segment hit the ${info.applyLimit ?? '?'} apply_changes limit. Context is saved — Continue adds more batches without restarting.`
        : info.type === 'oscillation'
          ? 'The agent repeated an identical edit. Context is saved — Continue resumes the pipeline.'
          : info.type === 'no_tool_call'
            ? 'The agent stopped without calling a tool. Context is saved — Continue resumes.'
            : info.type === 'spacing_limit'
              ? 'Spacing/balance review hit its segment limit with issues still open. Context is saved — Continue resumes fixes.'
              : info.type === 'overloaded'
                ? 'Anthropic is temporarily overloaded. Context is saved — wait ~30s, then Continue resumes from the exact step.'
                : info.type === 'rate_limit'
                  ? 'Anthropic rate limit hit. Context is saved — wait ~60s, then Continue resumes from the exact step.'
                  : 'This agent step took too long (server limit). Earlier steps in the run are kept.'

  const totalModified = info.modifiedSlideIds.length + (info.modifiedOverflow ?? 0)
  const slideList = info.modifiedSlideIds.join(', ')
  const slideSuffix = info.modifiedOverflow ? ` +${info.modifiedOverflow} more` : ''

  const footer = info.hasChanges
    ? 'Changes are live on the canvas — use Accept / Decline in the bar above.'
    : info.type === 'timeout'
      ? 'No changes were applied. Narrow scope or retry with fewer slides.'
      : 'No slides were modified in this run.'

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full rounded-lg border border-amber-500/40 bg-[#1a1408] px-3 py-2.5">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold tracking-wider text-amber-400 uppercase">
              {title}
            </p>
            <p className="mt-1 text-xs text-[#e2e8f0] leading-relaxed">{intro}</p>
            <ul className="mt-2 space-y-1 text-[11px] text-[#cbd5e1]">
              {info.applyBatches ? (
                <li>· {info.applyBatches} apply batch(es) completed</li>
              ) : null}
              {totalModified > 0 ? (
                <li>
                  · Slides modified ({totalModified}): {slideList}
                  {slideSuffix}
                </li>
              ) : (
                <li>· No slides were modified before the stop</li>
              )}
              {info.lastAction ? <li>· Last action: {info.lastAction}</li> : null}
            </ul>
            <p className="mt-2 text-[11px] text-[#94a3b8] leading-relaxed">{footer}</p>
            {canEdit && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onContinue}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold bg-[#60a5fa] text-[#0d1b2a]
                             hover:bg-[#93c5fd] transition-colors"
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={onNewRequest}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold border border-[#334155] text-[#cbd5e1]
                             hover:border-[#60a5fa] hover:text-[#60a5fa] transition-colors"
                >
                  New request
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function UserBubble({
  text,
  imageUrl,
  imageUrls,
  userName,
  userImage,
  onRevert,
  onResend,
}: {
  text: string
  imageUrl?: string
  imageUrls?: string[]
  userName?: string
  userImage?: string | null
  onRevert?: () => void
  onResend?: () => void
}) {
  const label = userName?.trim() || 'You'
  return (
    <div className="flex justify-end items-start gap-1.5 group">
      {(onResend || onRevert) && (
        <div className="mt-1 flex flex-col gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {onResend && (
            <button
              onClick={onResend}
              title="Resend this message to the AI"
              className="p-1 rounded text-[#475569] hover:text-[#60a5fa] hover:bg-[#1e3a5f] transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {onRevert && (
            <button
              onClick={onRevert}
              title="Revert deck to before this message and edit it"
              className="p-1 rounded text-[#475569] hover:text-[#60a5fa] hover:bg-[#1e3a5f] transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="max-w-[85%] bg-[#1e3a5f] rounded-lg rounded-tr-none px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          {userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userImage} alt="" className="w-4 h-4 rounded-full object-cover" />
          ) : (
            <span className="w-4 h-4 rounded-full bg-[#0d1b2a] text-[8px] font-bold flex items-center justify-center text-[#60a5fa]">
              {label.charAt(0).toUpperCase()}
            </span>
          )}
          <p className="text-xs font-bold text-[#60a5fa] truncate">{label}</p>
        </div>
        {imageUrl && (
          <div className="mb-2 rounded-md overflow-hidden border border-[#fb7185]/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Annotated slide" className="w-full block" />
            <p className="text-[9px] text-[#fb7185] bg-[#3a1a22] px-1.5 py-0.5">✦ annotated slide attached</p>
          </div>
        )}
        {imageUrls && imageUrls.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5 mb-2">
            {imageUrls.map((url, i) => (
              <div key={i} className="rounded-md overflow-hidden border border-[#60a5fa]/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Attachment ${i + 1}`} className="w-full block" />
              </div>
            ))}
          </div>
        )}
        {text && <p className="text-sm text-white whitespace-pre-wrap">{text}</p>}
      </div>
    </div>
  )
}

function AssistantBubble({
  response,
  onPickOption,
  onSubmitAnswers,
  patchStatus,
  isLivePending,
  slides,
  liveChanges,
  liveSummary,
  onApproveProposal,
  onDeclineProposal,
  onOpenProposal,
}: {
  response: ClaudeResponse
  onPickOption: (opt: ClarificationOption) => void
  onSubmitAnswers?: (text: string) => void
  patchStatus?: 'pending' | 'approved' | 'declined'
  isLivePending?: boolean
  slides?: SlideData[]
  liveChanges?: Change[]
  liveSummary?: string
  onApproveProposal?: () => void
  onDeclineProposal?: () => void
  onOpenProposal?: () => void
}) {
  if (response.type === 'patch') {
    // Live, unresolved proposal → interactive widget with a proposed-slide
    // thumbnail and Approve / Decline. Otherwise a compact resolved card.
    if (isLivePending && slides && liveChanges) {
      return (
        <ProposalWidget
          slides={slides}
          changes={liveChanges}
          summary={liveSummary ?? response.summary}
          onApprove={onApproveProposal}
          onDecline={onDeclineProposal}
          onOpen={onOpenProposal}
        />
      )
    }
    const resolved = patchStatus === 'approved' || patchStatus === 'declined'
    const declined = patchStatus === 'declined'
    return (
      <div className="flex justify-start">
        <div
          className={`max-w-[90%] rounded-lg rounded-tl-none px-3 py-2.5 border ${
            declined
              ? 'bg-[#1a1212] border-[#4b1d1d]'
              : 'bg-[#0f2a1a] border-[#16a34a]'
          }`}
        >
          <p
            className={`text-xs font-bold mb-1 ${declined ? 'text-[#f87171]' : 'text-[#4ade80]'}`}
          >
            {declined ? 'AI · DECLINED' : resolved ? 'AI · APPLIED ✓' : 'AI ✦ READY TO APPLY'}
          </p>
          <p className="text-sm text-white">{response.summary}</p>
          <p className="text-xs text-[#64748b] mt-1">
            {response.changes.length} change{response.changes.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    )
  }

  // needs_agent is handled by the app (it hands off to the agent) and isn't shown
  // here as a bubble; guard so TypeScript narrows the rest to a clarification.
  if (response.type === 'needs_agent') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] bg-[#1a1733] border border-[#4338ca] rounded-lg rounded-tl-none px-3 py-2.5">
          <p className="text-xs font-bold text-[#a5b4fc] mb-1">AI · HANDING OFF TO AGENT</p>
          <p className="text-sm text-white">{response.reason}</p>
        </div>
      </div>
    )
  }

  // clarification — structured multi-question form
  if (response.questions && response.questions.length > 0) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[92%] bg-[#112236] border border-[#1e3a5f] rounded-lg rounded-tl-none px-3 py-3">
          <p className="text-xs font-bold text-[#2dd4bf] mb-2">AI · A FEW QUESTIONS</p>
          {response.question && (
            <p className="text-sm text-white mb-3 whitespace-pre-wrap">{response.question}</p>
          )}
          <ClarificationForm
            questions={response.questions}
            onSubmit={onSubmitAnswers}
          />
        </div>
      </div>
    )
  }

  // clarification — single question / free-form
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] bg-[#112236] border border-[#1e3a5f] rounded-lg rounded-tl-none px-3 py-3">
        <p className="text-xs font-bold text-[#2dd4bf] mb-2">AI</p>
        <p className="text-sm text-white mb-3 whitespace-pre-wrap">{response.question}</p>
        {response.options && response.options.length > 0 && (
          <div className="space-y-1.5">
            {response.options.map(opt => (
              <button
                key={opt.id}
                onClick={() => onPickOption(opt)}
                className="w-full text-left flex items-start gap-2.5 px-3 py-2 rounded
                           bg-[#1e3a5f] hover:bg-[#2a4a6f] border border-[#2a4a6f]
                           hover:border-[#60a5fa] transition-all group"
              >
                <span className="text-xs font-bold text-[#60a5fa] mt-0.5 w-4 flex-shrink-0">
                  {opt.id}
                </span>
                <span className="text-sm text-[#cbd5e1] group-hover:text-white transition-colors leading-snug">
                  {opt.label}
                  {opt.description && (
                    <span className="block text-xs text-[#64748b] mt-0.5">{opt.description}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Structured multi-question clarification: each question renders option buttons
// (single- or multi-select) plus an optional free-form answer field. Answers are
// collected locally and submitted as one consolidated reply to the AI.
function ClarificationForm({
  questions,
  onSubmit,
}: {
  questions: ClarificationQuestion[]
  onSubmit?: (text: string) => void
}) {
  const [picks, setPicks] = useState<Record<string, Set<string>>>({})
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [sent, setSent] = useState(false)

  const toggle = (q: ClarificationQuestion, optId: string) => {
    setPicks(prev => {
      const cur = new Set(prev[q.id] ?? [])
      if (q.allowMultiple) {
        cur.has(optId) ? cur.delete(optId) : cur.add(optId)
      } else {
        cur.clear()
        cur.add(optId)
      }
      return { ...prev, [q.id]: cur }
    })
  }

  const answeredCount = questions.filter(q => {
    const hasPick = (picks[q.id]?.size ?? 0) > 0
    const hasText = (texts[q.id] ?? '').trim().length > 0
    return hasPick || hasText
  }).length

  const submit = () => {
    if (sent || !onSubmit) return
    const lines = questions.map((q, i) => {
      const picked = Array.from(picks[q.id] ?? [])
        .map(id => q.options?.find(o => o.id === id)?.label ?? id)
      const free = (texts[q.id] ?? '').trim()
      const parts = [...picked]
      if (free) parts.push(free)
      const answer = parts.length > 0 ? parts.join('; ') : '(no preference — you decide)'
      return `${i + 1}. ${q.question}\n   → ${answer}`
    })
    setSent(true)
    onSubmit(`Here are my answers:\n\n${lines.join('\n')}`)
  }

  return (
    <div className="space-y-3">
      {questions.map((q, qi) => {
        const picked = picks[q.id] ?? new Set<string>()
        return (
          <div key={q.id} className="rounded-lg border border-[#1e3a5f] bg-[#0d1b2a]/60 p-2.5">
            <p className="text-sm text-white font-medium mb-2 leading-snug">
              <span className="text-[#2dd4bf] font-bold mr-1.5">{qi + 1}.</span>
              {q.question}
            </p>
            {q.options && q.options.length > 0 && (
              <div className="space-y-1.5">
                {q.options.map(opt => {
                  const active = picked.has(opt.id)
                  return (
                    <button
                      key={opt.id}
                      disabled={sent}
                      onClick={() => toggle(q, opt.id)}
                      className={`w-full text-left flex items-start gap-2.5 px-3 py-2 rounded border transition-all
                        ${active
                          ? 'bg-[#0e3a5f] border-[#60a5fa]'
                          : 'bg-[#1e3a5f] hover:bg-[#2a4a6f] border-[#2a4a6f] hover:border-[#60a5fa]'}
                        ${sent ? 'opacity-60 cursor-default' : ''}`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center border text-[10px] font-bold
                          ${q.allowMultiple ? 'rounded-sm' : 'rounded-full'}
                          ${active ? 'border-[#60a5fa] bg-[#60a5fa] text-[#0b1526]' : 'border-[#475569] text-transparent'}`}
                      >
                        {active ? '✓' : ''}
                      </span>
                      <span className="text-sm text-[#cbd5e1] leading-snug">
                        {opt.label}
                        {opt.description && (
                          <span className="block text-xs text-[#64748b] mt-0.5">{opt.description}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            {(q.allowText || !q.options || q.options.length === 0) && (
              <input
                type="text"
                disabled={sent}
                value={texts[q.id] ?? ''}
                onChange={e => setTexts(prev => ({ ...prev, [q.id]: e.target.value }))}
                placeholder={q.options && q.options.length > 0 ? 'Or type your own answer…' : 'Type your answer…'}
                className="mt-2 w-full rounded border border-[#2a4a6f] bg-[#0b1526] px-2.5 py-1.5 text-sm text-white
                           placeholder:text-[#475569] focus:border-[#60a5fa] focus:outline-none disabled:opacity-60"
              />
            )}
          </div>
        )
      })}
      <button
        onClick={submit}
        disabled={sent || !onSubmit || answeredCount === 0}
        className="w-full rounded-lg bg-[#2dd4bf] px-3 py-2 text-sm font-semibold text-[#06231f]
                   transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
      >
        {sent
          ? 'Answers sent'
          : answeredCount < questions.length
            ? `Send answers (${answeredCount}/${questions.length})`
            : 'Send answers'}
      </button>
    </div>
  )
}

// ── Phase 1 Planner output ─────────────────────────────────────────────────────
// Shows the structured deck plan produced by the Planner agent before any slides
// are built. The user can approve it (triggers Phase 2 content build) or give
// revision feedback (replanner session).

const LAYOUT_ICON: Record<string, string> = {
  cover: '🎯',
  'section-header': '📌',
  bullets: '📋',
  'two-column': '⬜⬜',
  chart: '📊',
  'image-text': '🖼',
  quote: '💬',
  timeline: '📅',
  grid: '⊞',
  closing: '✔',
}

function PhaseCompleteBubble({
  slideCount,
  onRunLayoutPass,
}: {
  slideCount: number
  onRunLayoutPass?: () => void
}) {
  const [triggered, setTriggered] = useState(false)

  const handle = () => {
    if (triggered) return
    setTriggered(true)
    onRunLayoutPass?.()
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[96%] w-full bg-[#0d1b2a] border border-[#2dd4bf]/30 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2dd4bf]/15 bg-[#0a1f2e]">
          <Check className="w-3.5 h-3.5 text-[#2dd4bf] flex-shrink-0" />
          <span className="text-[10px] font-bold tracking-wider text-[#2dd4bf]">PHASE 2 COMPLETE</span>
          <span className="text-[10px] text-[#64748b] ml-auto">{slideCount} slides built</span>
        </div>
        <div className="px-3 py-2.5 flex items-center justify-between gap-3">
          <p className="text-xs text-[#94a3b8] leading-snug">
            Content is done. A layout pass fixes spacing, overlaps, and visual balance across all slides.
          </p>
          <button
            onClick={handle}
            disabled={triggered}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
              triggered
                ? 'bg-[#1e3a5f] text-[#64748b] cursor-default'
                : 'bg-[#2dd4bf]/15 text-[#2dd4bf] border border-[#2dd4bf]/40 hover:bg-[#2dd4bf]/25'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            {triggered ? 'Running…' : 'Refine layout'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeckPlanBubble({
  plan,
  onApprove,
  onRevise,
}: {
  plan: DeckPlan
  onApprove?: () => void
  onRevise?: (feedback: string) => void
}) {
  const [reviseMode, setReviseMode] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [approved, setApproved] = useState(false)

  const handleApprove = () => {
    setApproved(true)
    onApprove?.()
  }

  const handleRevise = () => {
    if (!feedback.trim()) return
    onRevise?.(feedback.trim())
    setReviseMode(false)
    setFeedback('')
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[96%] w-full bg-[#0d1b2a] border border-[#818cf8]/40 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#818cf8]/20 bg-[#13243a]">
          <Layers className="w-3.5 h-3.5 text-[#818cf8] flex-shrink-0" />
          <span className="text-[10px] font-bold tracking-wider text-[#818cf8]">DECK PLAN</span>
          <span className="text-[10px] text-[#64748b] ml-auto">
            {plan.slides.length} slides · {plan.scope} · {plan.tone}
          </span>
        </div>

        <div className="px-3 py-2.5 space-y-2">
          {/* Title + one-liner */}
          <div>
            <p className="text-sm font-semibold text-white leading-snug">{plan.title}</p>
            <p className="text-xs text-[#94a3b8] mt-0.5 leading-snug">{plan.oneLiner}</p>
          </div>

          {/* Audience + tone */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: plan.audience, color: 'text-[#2dd4bf] border-[#2dd4bf]/30 bg-[#2dd4bf]/10' },
              { label: plan.tone, color: 'text-[#a78bfa] border-[#a78bfa]/30 bg-[#a78bfa]/10' },
            ].map(({ label, color }) => (
              <span
                key={label}
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${color}`}
              >
                {label}
              </span>
            ))}
          </div>

          {/* Slide outline */}
          <div className="space-y-0.5">
            {plan.slides.map(slide => (
              <div
                key={slide.index}
                className="flex items-start gap-2 px-2 py-1.5 rounded bg-[#112236] text-xs"
              >
                <span className="text-[#64748b] w-5 flex-shrink-0 font-mono text-[10px] mt-px">
                  {slide.index}
                </span>
                <span className="flex-shrink-0 mt-px text-[11px]">
                  {LAYOUT_ICON[slide.layout] ?? '·'}
                </span>
                <div className="min-w-0">
                  <p className="text-white font-medium leading-snug truncate">{slide.title}</p>
                  <p className="text-[#64748b] text-[10px] leading-snug mt-0.5 line-clamp-2">
                    {slide.contentBrief}
                  </p>
                </div>
                <span className="ml-auto text-[9px] text-[#475569] flex-shrink-0 mt-px bg-[#1e3a5f] px-1 py-0.5 rounded">
                  {slide.layout}
                </span>
              </div>
            ))}
          </div>

          {/* Knowledge gaps warning */}
          {plan.knowledgeGaps && plan.knowledgeGaps.length > 0 && (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5">
              <p className="text-[10px] font-bold text-amber-400 mb-1">DATA GAPS — provide before building</p>
              <ul className="space-y-0.5">
                {plan.knowledgeGaps.map((gap, i) => (
                  <li key={i} className="text-[10px] text-amber-200/80">· {gap}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          {!approved ? (
            reviseMode ? (
              <div className="space-y-2">
                <textarea
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  placeholder="Describe what to change in the plan…"
                  rows={2}
                  className="w-full rounded border border-[#1e3a5f] bg-[#112236] px-2.5 py-1.5 text-xs text-white
                             placeholder:text-[#475569] focus:border-[#818cf8] focus:outline-none resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleRevise}
                    disabled={!feedback.trim()}
                    className="flex-1 py-1.5 text-xs font-semibold rounded bg-[#818cf8] text-[#0d1b2a]
                               hover:bg-[#a5b4fc] disabled:opacity-40 transition-colors"
                  >
                    Send revision
                  </button>
                  <button
                    onClick={() => { setReviseMode(false); setFeedback('') }}
                    className="px-3 py-1.5 text-xs rounded border border-[#1e3a5f] text-[#94a3b8]
                               hover:border-[#475569] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setReviseMode(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-[#1e3a5f]
                             text-[#94a3b8] hover:border-[#818cf8] hover:text-[#818cf8] transition-colors"
                >
                  <MessageSquare className="w-3 h-3" /> Revise plan
                </button>
                <button
                  onClick={handleApprove}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold
                             rounded bg-[#818cf8] text-[#0d1b2a] hover:bg-[#a5b4fc] transition-colors"
                >
                  <Check className="w-3.5 h-3.5" /> Approve & build
                </button>
              </div>
            )
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-[#4ade80]">
              <Check className="w-3.5 h-3.5" />
              <span>Plan approved — building deck…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Inline proposal widget: a clickable thumbnail of the proposed slide design plus
// Approve / Decline. Clicking the thumbnail opens the full preview overlay.
const WIDGET_SCALE = 0.23
function ProposalWidget({
  slides,
  changes,
  summary,
  headline = 'AI ✦ PROPOSED CHANGES',
  onApprove,
  onDecline,
  onOpen,
}: {
  slides: SlideData[]
  changes: Change[]
  summary: string
  headline?: string
  onApprove?: () => void
  onDecline?: () => void
  onOpen?: () => void
}) {
  const changedIds = Array.from(new Set(changes.map(c => c.slideId).filter((x): x is string => !!x)))
  const firstId = changedIds[0]
  const deletedSlideIds = getDeletedSlideIds(changes)
  const isSlideDelete = firstId ? deletedSlideIds.includes(firstId) : false
  const proposed = (() => {
    if (!firstId || isSlideDelete) return null
    try {
      return applyChangesToSlides(slides, changes).find(s => s.id === firstId) ?? null
    } catch {
      return null
    }
  })()

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] w-full bg-[#0f2a1a] border border-[#16a34a] rounded-lg rounded-tl-none p-2.5">
        <p className="text-xs font-bold text-[#4ade80] mb-1.5">{headline}</p>
        <p className="text-sm text-white mb-2 leading-snug">{summary}</p>

        {/* Clickable proposed-slide preview */}
        <button
          onClick={onOpen}
          title="Open full preview with change highlights"
          className="group relative block w-full rounded-md overflow-hidden border border-[#16a34a]/40
                     hover:border-[#4ade80] transition-colors"
        >
          {isSlideDelete ? (
            <div className="flex flex-col items-center justify-center bg-[#1a1212] py-6">
              <Trash2 className="w-6 h-6 text-[#f87171] mb-1.5" />
              <span className="text-xs text-[#fca5a5]">Slide will be deleted</span>
            </div>
          ) : proposed ? (
            <div className="flex justify-center bg-[#060d1a]">
              <SlideCanvas slide={proposed} scale={WIDGET_SCALE} interactive={false} showShadow={false} />
            </div>
          ) : (
            <div className="flex items-center justify-center bg-[#060d1a] py-6 text-xs text-[#64748b]">
              Preview unavailable — open to review
            </div>
          )}
          <span
            className="absolute inset-0 flex items-center justify-center bg-[#040912]/0 group-hover:bg-[#040912]/45
                       transition-colors"
          >
            <span
              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-semibold text-white
                         bg-[#16a34a] px-2.5 py-1 rounded-full flex items-center gap-1"
            >
              <Maximize2 className="w-3 h-3" /> Open preview
            </span>
          </span>
        </button>

        <p className="text-[10px] text-[#64748b] mt-1.5 mb-2">
          {changes.length} change{changes.length !== 1 ? 's' : ''}
          {changedIds.length > 1 ? ` across ${changedIds.length} slides` : ''} · click preview to see
          before/after & highlights
        </p>

        {/* Approve / Decline */}
        <div className="flex items-center gap-2">
          <button
            onClick={onDecline}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded
                       bg-[#1a1212] text-[#fca5a5] border border-[#4b1d1d] hover:bg-[#2a1515]
                       hover:text-[#fecaca] transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Decline
          </button>
          <button
            onClick={onApprove}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded
                       bg-[#16a34a] text-white font-semibold hover:bg-[#15803d] transition-colors"
          >
            <Check className="w-3.5 h-3.5" /> Approve
          </button>
        </div>
      </div>
    </div>
  )
}
