'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MessageSquare, X, Send, CheckCircle2, Trash2, Loader2, Filter, MapPin,
} from 'lucide-react'
import type { DeckComment, SlideData } from '@/lib/types'
import type { CommentPinDraft } from '@/lib/commentPins'
import { MAX_COMMENT_CHARS } from '@/lib/comments'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type FilterMode = 'all' | 'open' | 'slide'

interface Props {
  comments: DeckComment[]
  slides: SlideData[]
  activeSlideId: string
  selectedSlideIds: string[]
  selectedElementIds: string[]
  loading?: boolean
  busy?: boolean
  /** Pin chosen on the slide — compose a comment at that spot. */
  pendingPin?: CommentPinDraft | null
  highlightId?: string | null
  onAdd: (
    content: string,
    scope: {
      slideId?: string | null
      elementId?: string | null
      pinX?: number | null
      pinY?: number | null
    }
  ) => void | Promise<void>
  onToggleResolved: (id: string, resolved: boolean) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onClose: () => void
  onCancelCompose?: () => void
}

function slideTitle(slides: SlideData[], slideId: string | null | undefined): string {
  if (!slideId) return 'Whole deck'
  const idx = slides.findIndex(s => s.id === slideId)
  if (idx < 0) return slideId
  const title =
    slides[idx].elements.find(e => e.type === 'text' && e.content?.trim())?.content?.slice(0, 40) ??
    'Untitled'
  return `Slide ${idx + 1}: ${title}`
}

export default function CommentsPanel({
  comments,
  slides,
  activeSlideId,
  selectedSlideIds,
  selectedElementIds,
  loading = false,
  busy = false,
  pendingPin = null,
  highlightId = null,
  onAdd,
  onToggleResolved,
  onDelete,
  onClose,
  onCancelCompose,
}: Props) {
  const [text, setText] = useState('')
  const [filter, setFilter] = useState<FilterMode>('open')
  const [scopeDeck, setScopeDeck] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composeMode = !!pendingPin

  useEffect(() => {
    if (composeMode) {
      setText('')
      textareaRef.current?.focus()
    }
  }, [composeMode, pendingPin?.pinX, pendingPin?.pinY])

  const defaultSlideId =
    selectedSlideIds.length === 1
      ? selectedSlideIds[0]
      : selectedSlideIds.length === 0
        ? activeSlideId
        : null
  const defaultElementId =
    selectedElementIds.length === 1 && defaultSlideId ? selectedElementIds[0] : null

  const scopeSlideId = composeMode ? pendingPin!.slideId : scopeDeck ? null : defaultSlideId
  const scopeElementId = composeMode ? pendingPin!.elementId : scopeDeck ? null : defaultElementId
  const scopePinX = composeMode ? pendingPin!.pinX : null
  const scopePinY = composeMode ? pendingPin!.pinY : null

  const openCount = comments.filter(c => !c.resolved).length

  const visible = useMemo(() => {
    let list = [...comments].reverse()
    if (filter === 'open') list = list.filter(c => !c.resolved)
    if (filter === 'slide' && activeSlideId) {
      list = list.filter(c => !c.slideId || c.slideId === activeSlideId)
    }
    return list
  }, [comments, filter, activeSlideId])

  const submit = async () => {
    const content = text.trim()
    if (!content || busy) return
    await onAdd(content, {
      slideId: scopeSlideId,
      elementId: scopeElementId,
      pinX: scopePinX,
      pinY: scopePinY,
    })
    setText('')
  }

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] max-h-[85vh] bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e3a5f] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-500/15 border border-teal-500/30">
              <MessageSquare className="w-4 h-4 text-teal-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Comments</p>
              <p className="text-xs text-[#64748B] mt-0.5">
                {composeMode
                  ? 'Write your note for the pin you placed on the slide'
                  : 'Team feedback — wired into AI context as a knowledge layer'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {openCount > 0 && <Badge variant="info">{openCount} open</Badge>}
            <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>

        {!composeMode && (
        <div className="flex items-center gap-1.5 px-5 py-2 border-b border-[#1e3a5f] flex-shrink-0">
          <Filter className="w-3 h-3 text-[#64748B]" />
          {(['open', 'slide', 'all'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilter(mode)}
              className={cn(
                'px-2 py-1 rounded text-[10px] font-semibold capitalize transition-colors',
                filter === mode
                  ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                  : 'text-[#64748B] hover:text-white'
              )}
            >
              {mode === 'slide' ? 'This slide' : mode}
            </button>
          ))}
        </div>
        )}

        {composeMode && (
          <div className="px-5 py-2 border-b border-teal-500/30 bg-teal-500/10 flex-shrink-0">
            <p className="text-[11px] text-teal-200 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              Placed on {slideTitle(slides, pendingPin!.slideId)}
              {pendingPin!.elementId ? ' · on selected element' : ''}
            </p>
          </div>
        )}

        {!composeMode && (
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-[#64748B]">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading comments…
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-8 h-8 text-[#1e3a5f] mx-auto mb-2" />
              <p className="text-xs text-[#475569] italic">
                No comments yet. Add feedback for your team — the AI reads open comments when editing.
              </p>
            </div>
          ) : (
            visible.map(c => (
              <div
                key={c.id}
                className={cn(
                  'rounded-lg border p-3',
                  c.id === highlightId && 'ring-1 ring-teal-400/60',
                  c.resolved
                    ? 'border-[#1e3a5f]/60 bg-[#0a1220] opacity-60'
                    : 'border-[#1e3a5f] bg-[#112236]'
                )}
              >
                <div className="flex items-start gap-2">
                  {c.authorImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.authorImage} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-teal-500/20 text-teal-200 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {(c.authorName || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-white truncate">
                        {c.authorName}{c.isMe && <span className="text-[#64748B] font-normal"> (you)</span>}
                      </span>
                      <Badge variant="muted" className="text-[9px] py-0">
                        {slideTitle(slides, c.slideId)}
                      </Badge>
                      {c.resolved && <Badge variant="success" className="text-[9px] py-0">Resolved</Badge>}
                    </div>
                    <p className="text-xs text-[#CBD5E1] mt-1 whitespace-pre-wrap">{c.content}</p>
                    <p className="text-[9px] text-[#475569] mt-1">{fmt(c.createdAt)}</p>
                  </div>
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={c.resolved ? 'Reopen' : 'Mark resolved'}
                      className={cn('h-7 w-7', c.resolved ? 'text-[#64748B]' : 'text-teal-400')}
                      onClick={() => onToggleResolved(c.id, !c.resolved)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </Button>
                    {c.isMe && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        className="h-7 w-7 hover:text-[#F87171]"
                        onClick={() => onDelete(c.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        )}

        <div className={cn('px-5 py-3 border-t border-[#1e3a5f] flex-shrink-0 space-y-2', !composeMode && 'hidden')}>
          {composeMode ? null : (
          <div className="flex items-center gap-2 flex-wrap text-[10px] text-[#64748B]">
            <span>Attach to:</span>
            <button
              type="button"
              onClick={() => setScopeDeck(v => !v)}
              className={cn(
                'px-2 py-0.5 rounded border transition-colors',
                scopeDeck
                  ? 'border-teal-500/50 bg-teal-500/10 text-teal-300'
                  : 'border-[#1e3a5f] hover:border-[#334155]'
              )}
            >
              Whole deck
            </button>
            {!scopeDeck && scopeSlideId && (
              <span className="text-teal-300/90 truncate max-w-[220px]">
                {slideTitle(slides, scopeSlideId)}
                {scopeElementId ? ' · selected element' : ''}
              </span>
            )}
          </div>
          )}
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value.slice(0, MAX_COMMENT_CHARS))}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
              }}
              placeholder={composeMode ? 'What should change here?' : 'Leave feedback for the team or AI…'}
              rows={composeMode ? 3 : 2}
              className="flex-1 bg-[#112236] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm text-white placeholder-[#475569] outline-none focus:border-teal-500 resize-none"
            />
            <Button
              onClick={() => void submit()}
              disabled={busy || !text.trim()}
              variant="default"
              size="md"
              className="self-end"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] text-[#475569]">
              {text.length}/{MAX_COMMENT_CHARS} · ⌘/Ctrl+Enter to post
            </p>
            {composeMode && onCancelCompose && (
              <button
                type="button"
                onClick={onCancelCompose}
                className="text-[10px] text-[#64748B] hover:text-white"
              >
                Reposition pin
              </button>
            )}
          </div>
        </div>

        {!composeMode && (
        <div className="px-5 py-3 border-t border-[#1e3a5f] flex-shrink-0">
          <p className="text-[10px] text-[#64748B] text-center">
            Click the comment button, then click the slide to add a pinned comment.
          </p>
        </div>
        )}
      </div>
    </div>
  )
}
