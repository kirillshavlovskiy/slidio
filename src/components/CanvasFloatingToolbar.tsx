'use client'

import { RefObject, useCallback, useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  FoldVertical,
  BarChart3,
  Bold,
  ClipboardPaste,
  Combine,
  Copy,
  Eraser,
  GripVertical,
  Italic,
  LayoutGrid,
  List,
  ListOrdered,
  Minus,
  MousePointer2,
  Pen,
  Pencil,
  Plus,
  Sparkles,
  SplitSquareHorizontal,
  SquareSplitHorizontal,
  Table,
  Trash2,
  Undo2,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { SlideElement, ElementStyle, SlideGradient } from '@/lib/types'
import { elementFillHex, elementTextHex, isFillElement } from '@/lib/elementStyle'
import { gradientCss, GRADIENT_PRESETS } from '@/lib/slideBackground'
import { QuickAction, QuickActionContext } from '@/lib/quickActions'
import { listState, toggleListMode } from '@/lib/textLists'
import FontFamilySelect from '@/components/FontFamilySelect'

// Icons for the AI smart-action rows (resolved by the action's `icon` name).
const ACTION_ICONS: Record<string, LucideIcon> = {
  SplitSquareHorizontal,
  Combine,
  LayoutGrid,
  Sparkles,
  BarChart3,
  Table,
}

export type AlignMode =
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vmiddle'
  | 'bottom'
  | 'distribute-h'
  | 'distribute-v'

const PEN_COLORS = ['#FB3B5C', '#FBBF24', '#4ADE80', '#60A5FA'] as const
const FILL_PRESETS = ['F87171', 'F59E0B', '60A5FA', '4ADE80', 'FFFFFF', '64748B', '112236'] as const
// Richer text palette (light → accent → dark) shown in the floating toolbar.
const TEXT_PRESETS = [
  'FFFFFF', 'CBD5E1', '94A3B8', '64748B', '1E293B', '0F172A',
  'F87171', 'FB7185', 'FBBF24', 'FACC15', '4ADE80', '34D399',
  '60A5FA', '38BDF8', 'A78BFA', 'F472B6',
] as const
// Common slide background colors (dark decks + light decks + brand-ish tones).
const SLIDE_BG_PRESETS = [
  '0D1B2A', '0F172A', '1B3A6B', '111827', '000000', '1E293B',
  'FFFFFF', 'F8FAFC', 'F1F5F9', 'FEF3C7', 'ECFDF5', 'EFF6FF',
] as const

const normHex = (hex: string) => `#${hex.replace('#', '').toUpperCase()}`

interface Props {
  containerRef: RefObject<HTMLElement | null>
  annotationMode: boolean
  onAnnotationModeChange: (draw: boolean) => void
  annotationColor: string
  onAnnotationColorChange: (color: string) => void
  strokesCount: number
  onUndoStroke: () => void
  onClearStrokes: () => void
  selectedElements: SlideElement[]
  onUpdateElement: (id: string, patch: { content?: string; style?: Partial<ElementStyle> }) => void
  onDeleteElements: () => void
  onCopyElements: () => void
  onPasteElements: () => void
  clipboardCount: number
  onAlignElements: (mode: AlignMode) => void
  onStartEditing: (id: string) => void
  editingElementId: string | null
  selectedSlideCount: number
  canDeleteSlides: boolean
  canMergeSlides: boolean
  onDeleteSlides: () => void
  onDuplicateSlides: () => void
  onAddSlide: () => void
  onSplitSlide: () => void
  onMergeSlides: () => void
  slideBg: string
  onUpdateSlideBg: (hex: string) => void
  slideGradient: SlideGradient | null
  onUpdateSlideGradient: (g: SlideGradient | null) => void
  quickActions: QuickAction[]
  quickActionCtx: QuickActionContext
  onRunQuickAction: (action: QuickAction) => void
  quickActionsDisabled: boolean
}

function ToolBtn({
  active,
  title,
  onClick,
  disabled,
  children,
  accent,
  danger,
}: {
  active?: boolean
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  accent?: 'blue' | 'red'
  danger?: boolean
}) {
  const activeClass = danger
    ? 'text-[#f87171] hover:bg-[#2a1515] hover:text-[#fca5a5]'
    : accent === 'red'
      ? 'bg-[#fb3b5c] text-white'
      : accent === 'blue' || active
        ? 'bg-[#1e3a5f] text-white'
        : 'text-[#94a3b8] hover:bg-[#1e3a5f] hover:text-white'

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors disabled:opacity-30 ${activeClass}`}
    >
      {children}
    </button>
  )
}

function IconBtn({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={`p-1 rounded transition-colors ${
        active
          ? 'bg-[#60a5fa] text-white'
          : 'text-[#94a3b8] hover:bg-[#1e3a5f] hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="w-px h-5 bg-[#1e3a5f] flex-shrink-0" />
}

// A swatch that opens the OS-native color picker for any custom color.
function CustomColorButton({
  value,
  onChange,
  title,
  round,
}: {
  value: string | undefined
  onChange: (hex: string) => void
  title: string
  round?: boolean
}) {
  return (
    <label
      title={title}
      onMouseDown={e => e.preventDefault()}
      className={`relative w-4 h-4 flex-shrink-0 cursor-pointer border border-[#334155] transition-transform hover:scale-110 ${
        round ? 'rounded-full' : 'rounded-sm'
      }`}
      style={{
        background:
          'conic-gradient(from 0deg, #f87171, #fbbf24, #4ade80, #60a5fa, #a78bfa, #f472b6, #f87171)',
      }}
    >
      <input
        type="color"
        value={normHex(value || '000000')}
        onChange={e => onChange(e.target.value.replace('#', '').toUpperCase())}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </label>
  )
}

// A compact color control: shows just the current color as one swatch, and
// reveals the full palette (passed as children) in a popover only when clicked.
function ColorPopover({
  label,
  title,
  previewColor,
  previewGradient,
  round,
  children,
}: {
  label?: string
  title: string
  previewColor?: string
  previewGradient?: string
  round?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex items-center gap-1 flex-shrink-0">
      {label && (
        <span className="text-[10px] text-[#64748b] pr-0.5 flex-shrink-0">{label}</span>
      )}
      <button
        type="button"
        title={title}
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(o => !o)}
        className={`w-5 h-5 flex-shrink-0 border transition-transform hover:scale-110 ${
          round ? 'rounded-full' : 'rounded-sm'
        } ${open ? 'border-[#60a5fa] ring-1 ring-[#60a5fa]' : 'border-[#334155]'}`}
        style={
          previewGradient
            ? { backgroundImage: previewGradient }
            : { backgroundColor: `#${(previewColor || 'FFFFFF').replace('#', '')}` }
        }
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-50 mt-1.5 flex w-[164px] flex-wrap items-center gap-1 rounded-lg border border-[#1e3a5f] bg-[#0b1526] p-2 shadow-2xl"
            onMouseDown={e => e.preventDefault()}
          >
            {children}
          </div>
        </>
      )}
    </div>
  )
}

function selectionLabel(elements: SlideElement[]): string {
  if (elements.length === 0) return 'Slide'
  if (elements.length > 1) return `${elements.length} elements`
  const el = elements[0]
  const preview = el.content?.replace(/\s+/g, ' ').trim().slice(0, 28)
  if (preview) return preview + (el.content!.length > 28 ? '…' : '')
  return el.type.charAt(0).toUpperCase() + el.type.slice(1)
}

export default function CanvasFloatingToolbar({
  containerRef,
  annotationMode,
  onAnnotationModeChange,
  annotationColor,
  onAnnotationColorChange,
  strokesCount,
  onUndoStroke,
  onClearStrokes,
  selectedElements,
  onUpdateElement,
  onDeleteElements,
  onCopyElements,
  onPasteElements,
  clipboardCount,
  onAlignElements,
  onStartEditing,
  editingElementId,
  selectedSlideCount,
  canDeleteSlides,
  canMergeSlides,
  onDeleteSlides,
  onDuplicateSlides,
  onAddSlide,
  onSplitSlide,
  onMergeSlides,
  slideBg,
  onUpdateSlideBg,
  slideGradient,
  onUpdateSlideGradient,
  quickActions,
  quickActionCtx,
  onRunQuickAction,
  quickActionsDisabled,
}: Props) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [pos, setPos] = useState({ x: 12, y: 12 })
  const [toolbarMaxW, setToolbarMaxW] = useState<number>()
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  )

  useEffect(() => {
    try {
      const raw = localStorage.getItem('canvas-toolbar-pos')
      if (raw) {
        const { x, y } = JSON.parse(raw) as { x: number; y: number }
        if (typeof x === 'number' && typeof y === 'number') setPos({ x, y })
      }
    } catch {
      // ignore
    }
  }, [])

  const clampPosition = useCallback((x: number, y: number) => {
    const container = containerRef.current
    const toolbar = toolbarRef.current
    if (!container || !toolbar) return { x, y }
    const maxX = Math.max(0, container.clientWidth - toolbar.offsetWidth)
    const maxY = Math.max(0, container.clientHeight - toolbar.offsetHeight)
    return {
      x: Math.min(maxX, Math.max(0, x)),
      y: Math.min(maxY, Math.max(0, y)),
    }
  }, [containerRef])

  useEffect(() => {
    localStorage.setItem('canvas-toolbar-pos', JSON.stringify(pos))
  }, [pos])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const sync = () => {
      setPos(p => clampPosition(p.x, p.y))
      setToolbarMaxW(Math.max(160, container.clientWidth - pos.x - 12))
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(container)
    return () => ro.disconnect()
  }, [containerRef, clampPosition, pos.x])

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    }

    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return
      const dx = ev.clientX - dragState.current.startX
      const dy = ev.clientY - dragState.current.startY
      setPos(
        clampPosition(dragState.current.origX + dx, dragState.current.origY + dy)
      )
    }

    const onUp = () => {
      dragState.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const single = selectedElements.length === 1 ? selectedElements[0] : null
  const isTextEl = single?.type === 'text' || single?.type === 'chip'
  const isFillEl = single ? isFillElement(single) : false
  const textSelected = selectedElements.filter(el => el.type === 'text' || el.type === 'chip')

  const applyStyleToSelection = (patch: Partial<ElementStyle>) => {
    const targets = textSelected.length > 0 ? textSelected : selectedElements
    targets.forEach(el => onUpdateElement(el.id, { style: patch }))
  }

  const applyFill = (hex: string) => {
    if (!single || !isFillEl) return
    const patch: Partial<ElementStyle> = { bg: hex, bgGradient: undefined }
    if (single.type === 'bar') patch.color = hex
    onUpdateElement(single.id, { style: patch })
  }

  const textListMode = single?.type === 'text' ? listState(single.content ?? '') : 'none'
  const toggleList = (mode: 'bullet' | 'number') => {
    if (!single) return
    onUpdateElement(single.id, { content: toggleListMode(single.content ?? '', mode) })
  }

  return (
    <div
      ref={toolbarRef}
      className="absolute z-40 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-xl border border-[#1e3a5f]/80 bg-[#0d1b2a]/95 backdrop-blur-md shadow-2xl pointer-events-auto"
      style={{ left: pos.x, top: pos.y, maxWidth: toolbarMaxW }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex w-max flex-nowrap items-center gap-x-1.5 px-1.5 py-1.5">
      <button
        type="button"
        title="Drag toolbar"
        onMouseDown={onDragStart}
        className="flex items-center justify-center w-6 h-7 rounded-md text-[#475569] hover:text-[#94a3b8] hover:bg-[#1e3a5f] cursor-grab active:cursor-grabbing flex-shrink-0"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      <Divider />

      <span className="text-[10px] text-[#64748b] max-w-[88px] truncate px-1 flex-shrink-0" title={selectionLabel(selectedElements)}>
        {selectionLabel(selectedElements)}
      </span>

      <Divider />

      {/* Mode: Select / Draw */}
      <div className="flex items-center gap-1 bg-[#060d1a] rounded-md p-0.5 flex-shrink-0">
        <ToolBtn
          title="Select elements"
          active={!annotationMode}
          onClick={() => onAnnotationModeChange(false)}
        >
          <MousePointer2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Draw annotations for AI"
          active={annotationMode}
          accent="red"
          onClick={() => onAnnotationModeChange(true)}
        >
          <Pen className="w-3.5 h-3.5" />
        </ToolBtn>
      </div>

      {/* Smart AI actions — contextual to the current slide/element selection */}
      {!annotationMode && (
        <>
          <Divider />
          <div className="relative flex-shrink-0">
            <button
              type="button"
              title="Smart AI actions for this selection"
              onMouseDown={e => e.preventDefault()}
              onClick={() => setAiOpen(o => !o)}
              disabled={quickActionsDisabled}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors disabled:opacity-30 ${
                aiOpen
                  ? 'bg-[#2a1f4f] text-violet-200'
                  : 'text-violet-300 hover:bg-[#2a1f4f] hover:text-violet-200'
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">AI</span>
            </button>
            {aiOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAiOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-lg border border-[#2a1f4f] bg-[#0b1526] shadow-2xl">
                  <p className="border-b border-[#16263b] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#7c6bb0]">
                    Smart AI actions
                  </p>
                  <div className="py-1">
                    {quickActions.map(action => {
                      const available = action.isAvailable(quickActionCtx)
                      const Icon = ACTION_ICONS[action.icon] ?? Wand2
                      return (
                        <button
                          key={action.id}
                          type="button"
                          disabled={!available || quickActionsDisabled}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setAiOpen(false)
                            onRunQuickAction(action)
                          }}
                          className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#1a1338] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-300" />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-slate-100">
                              {action.label}
                            </span>
                            <span className="block text-[11px] leading-snug text-slate-400">
                              {!available && action.unavailableHint
                                ? action.unavailableHint
                                : action.description}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Slide quick actions — only when no element is selected (element tools take over otherwise) */}
      {!annotationMode && selectedElements.length === 0 && (
        <>
          <Divider />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <ToolBtn title="Add new slide" onClick={onAddSlide}>
              <Plus className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn
              title={
                selectedSlideCount > 1
                  ? `Duplicate ${selectedSlideCount} slides`
                  : 'Duplicate slide'
              }
              onClick={onDuplicateSlides}
            >
              <Copy className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn title="Split slide into two" onClick={onSplitSlide}>
              <SquareSplitHorizontal className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn
              title={
                canMergeSlides
                  ? `Merge ${selectedSlideCount} selected slides`
                  : 'Select multiple slides to merge'
              }
              onClick={onMergeSlides}
              disabled={!canMergeSlides}
            >
              <Combine className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn
              title={
                canDeleteSlides
                  ? selectedSlideCount > 1
                    ? `Delete ${selectedSlideCount} slides`
                    : 'Delete slide'
                  : 'Keep at least one slide in the deck'
              }
              onClick={onDeleteSlides}
              disabled={!canDeleteSlides}
              danger
            >
              <Trash2 className="w-3.5 h-3.5" />
            </ToolBtn>
          </div>
          <Divider />
          {/* Slide background color (collapsed to one swatch; opens on click) */}
          <ColorPopover
            label={selectedSlideCount > 1 ? `BG ×${selectedSlideCount}` : 'BG'}
            title={
              selectedSlideCount > 1
                ? `Background applies to all ${selectedSlideCount} selected slides`
                : 'Slide background'
            }
            previewColor={slideGradient ? undefined : slideBg}
            previewGradient={slideGradient ? gradientCss(slideGradient) : undefined}
          >
            {SLIDE_BG_PRESETS.map(hex => (
              <button
                key={hex}
                type="button"
                title={`Slide background #${hex}`}
                onClick={() => onUpdateSlideBg(hex)}
                className={`w-4 h-4 rounded-sm border transition-transform hover:scale-110 ${
                  slideBg.replace('#', '').toUpperCase() === hex
                    ? 'border-[#60a5fa] ring-1 ring-[#60a5fa]'
                    : 'border-[#334155]'
                }`}
                style={{ backgroundColor: `#${hex}` }}
              />
            ))}
            <CustomColorButton
              title="Custom slide background"
              value={slideBg}
              onChange={onUpdateSlideBg}
            />
            <span className="w-full h-px bg-[#1e3a5f] my-0.5" />
            {GRADIENT_PRESETS.slice(0, 6).map((preset, i) => {
              const active =
                slideGradient?.from === preset.from &&
                slideGradient?.to === preset.to &&
                (slideGradient?.type ?? 'linear') === (preset.type ?? 'linear')
              return (
                <button
                  key={i}
                  type="button"
                  title="Gradient background"
                  onClick={() => onUpdateSlideGradient(preset)}
                  className={`w-4 h-4 rounded-sm border transition-transform hover:scale-110 ${
                    active ? 'border-[#60a5fa] ring-1 ring-[#60a5fa]' : 'border-[#334155]'
                  }`}
                  style={{ backgroundImage: gradientCss(preset) }}
                />
              )
            })}
          </ColorPopover>
        </>
      )}

      {/* Copy / paste / delete selected element(s) */}
      {!annotationMode && (selectedElements.length > 0 || clipboardCount > 0) && (
        <>
          <Divider />
          {selectedElements.length > 0 && (
            <ToolBtn
              title={
                selectedElements.length > 1
                  ? `Copy ${selectedElements.length} elements (Ctrl+C)`
                  : 'Copy element (Ctrl+C)'
              }
              onClick={onCopyElements}
            >
              <Copy className="w-3.5 h-3.5" />
            </ToolBtn>
          )}
          {clipboardCount > 0 && (
            <ToolBtn
              title={
                selectedSlideCount > 1
                  ? `Paste ${clipboardCount} element(s) onto ${selectedSlideCount} slides at same position (Ctrl+V)`
                  : `Paste ${clipboardCount} element(s) at same position (Ctrl+V)`
              }
              onClick={onPasteElements}
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
            </ToolBtn>
          )}
          {selectedElements.length > 0 && (
            <ToolBtn
              title={
                selectedElements.length > 1
                  ? `Delete ${selectedElements.length} selected elements (Del)`
                  : 'Delete selected element (Del)'
              }
              onClick={onDeleteElements}
              danger
            >
              <Trash2 className="w-3.5 h-3.5" />
            </ToolBtn>
          )}
        </>
      )}

      {/* Draw tools */}
      {annotationMode && (
        <>
          <Divider />
          <div className="flex items-center gap-1">
            {PEN_COLORS.map(c => (
              <button
                key={c}
                type="button"
                title={`Pen ${c}`}
                onClick={() => onAnnotationColorChange(c)}
                className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-110 ${
                  annotationColor === c ? 'border-white' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <Divider />
          <ToolBtn title="Undo stroke" onClick={onUndoStroke} disabled={strokesCount === 0}>
            <Undo2 className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn title="Clear annotations" onClick={onClearStrokes} disabled={strokesCount === 0}>
            <Eraser className="w-3.5 h-3.5" />
          </ToolBtn>
          {strokesCount > 0 && (
            <span className="text-[10px] text-[#fb7185] whitespace-nowrap">
              {strokesCount} mark{strokesCount !== 1 ? 's' : ''}
            </span>
          )}
        </>
      )}

      {/* Text element controls */}
      {!annotationMode && isTextEl && single && (
        <>
          <Divider />
          <FontFamilySelect
            value={single.style.fontFace}
            onChange={fontFace => onUpdateElement(single.id, { style: { fontFace } })}
          />
          <Divider />
          <IconBtn
            title="Bold"
            active={!!single.style.bold}
            onClick={() => onUpdateElement(single.id, { style: { bold: !single.style.bold } })}
          >
            <Bold className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn
            title="Italic"
            active={!!single.style.italic}
            onClick={() => onUpdateElement(single.id, { style: { italic: !single.style.italic } })}
          >
            <Italic className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn
            title="Align left"
            active={single.style.align === 'left' || !single.style.align}
            onClick={() => onUpdateElement(single.id, { style: { align: 'left' } })}
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn
            title="Align center"
            active={single.style.align === 'center'}
            onClick={() => onUpdateElement(single.id, { style: { align: 'center' } })}
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn
            title="Align right"
            active={single.style.align === 'right'}
            onClick={() => onUpdateElement(single.id, { style: { align: 'right' } })}
          >
            <AlignRight className="w-3.5 h-3.5" />
          </IconBtn>
          <Divider />
          <IconBtn
            title="Align text top"
            active={single.style.valign === 'top'}
            onClick={() => onUpdateElement(single.id, { style: { valign: 'top' } })}
          >
            <ArrowUpToLine className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn
            title="Align text middle"
            active={(single.style.valign ?? 'middle') === 'middle'}
            onClick={() => onUpdateElement(single.id, { style: { valign: 'middle' } })}
          >
            <FoldVertical className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn
            title="Align text bottom"
            active={single.style.valign === 'bottom'}
            onClick={() => onUpdateElement(single.id, { style: { valign: 'bottom' } })}
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
          </IconBtn>
          {single.type === 'text' && (
            <>
              <Divider />
              <IconBtn
                title="Bulleted list"
                active={textListMode === 'bullet'}
                onClick={() => toggleList('bullet')}
              >
                <List className="w-3.5 h-3.5" />
              </IconBtn>
              <IconBtn
                title="Numbered list"
                active={textListMode === 'number'}
                onClick={() => toggleList('number')}
              >
                <ListOrdered className="w-3.5 h-3.5" />
              </IconBtn>
            </>
          )}
          <Divider />
          <IconBtn
            title="Smaller text"
            onClick={() =>
              onUpdateElement(single.id, {
                style: { fontSize: Math.max(6, (single.style.fontSize ?? 12) - 2) },
              })
            }
          >
            <Minus className="w-3.5 h-3.5" />
          </IconBtn>
          <span className="text-[10px] text-[#64748b] font-mono w-4 text-center">
            {single.style.fontSize ?? 12}
          </span>
          <IconBtn
            title="Larger text"
            onClick={() =>
              onUpdateElement(single.id, {
                style: { fontSize: Math.min(96, (single.style.fontSize ?? 12) + 2) },
              })
            }
          >
            <Plus className="w-3.5 h-3.5" />
          </IconBtn>
          <Divider />
          <IconBtn
            title="Tighter letter spacing"
            onClick={() =>
              onUpdateElement(single.id, {
                style: { charSpacing: Math.max(0, (single.style.charSpacing ?? 0) - 0.5) },
              })
            }
          >
            <span className="text-[10px] font-bold px-0.5">A←</span>
          </IconBtn>
          <span className="text-[10px] text-[#64748b] font-mono w-5 text-center">
            {(single.style.charSpacing ?? 0).toFixed(1)}
          </span>
          <IconBtn
            title="Wider letter spacing"
            onClick={() =>
              onUpdateElement(single.id, {
                style: { charSpacing: Math.min(10, (single.style.charSpacing ?? 0) + 0.5) },
              })
            }
          >
            <span className="text-[10px] font-bold px-0.5">A→</span>
          </IconBtn>
          {editingElementId !== single.id && (
            <>
              <Divider />
              <ToolBtn title="Edit text" onClick={() => onStartEditing(single.id)}>
                <Pencil className="w-3.5 h-3.5" />
              </ToolBtn>
            </>
          )}
        </>
      )}

      {/* Group alignment (multi-select) */}
      {!annotationMode && selectedElements.length > 1 && (
        <>
          <Divider />
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <IconBtn title="Align left edges" onClick={() => onAlignElements('left')}>
              <AlignStartVertical className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Align horizontal centers" onClick={() => onAlignElements('hcenter')}>
              <AlignCenterVertical className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Align right edges" onClick={() => onAlignElements('right')}>
              <AlignEndVertical className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Align top edges" onClick={() => onAlignElements('top')}>
              <AlignStartHorizontal className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Align vertical centers" onClick={() => onAlignElements('vmiddle')}>
              <AlignCenterHorizontal className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Align bottom edges" onClick={() => onAlignElements('bottom')}>
              <AlignEndHorizontal className="w-3.5 h-3.5" />
            </IconBtn>
            {selectedElements.length > 2 && (
              <>
                <IconBtn
                  title="Distribute horizontally"
                  onClick={() => onAlignElements('distribute-h')}
                >
                  <AlignHorizontalDistributeCenter className="w-3.5 h-3.5" />
                </IconBtn>
                <IconBtn
                  title="Distribute vertically"
                  onClick={() => onAlignElements('distribute-v')}
                >
                  <AlignVerticalDistributeCenter className="w-3.5 h-3.5" />
                </IconBtn>
              </>
            )}
          </div>
        </>
      )}

      {/* Multi-select text batch */}
      {!annotationMode && selectedElements.length > 1 && textSelected.length > 0 && (
        <>
          <Divider />
          <FontFamilySelect
            value={textSelected[0]?.style.fontFace}
            onChange={fontFace => applyStyleToSelection({ fontFace })}
          />
          <IconBtn
            title="Bold all selected text"
            onClick={() => applyStyleToSelection({ bold: true })}
          >
            <Bold className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn
            title="Align center"
            onClick={() => applyStyleToSelection({ align: 'center' })}
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </IconBtn>
        </>
      )}

      {/* Shape fill controls */}
      {!annotationMode && single && isFillEl && single.type !== 'chip' && (
        <>
          <Divider />
          <ColorPopover title="Fill color" previewColor={elementFillHex(single)}>
            {FILL_PRESETS.map(hex => (
              <button
                key={hex}
                type="button"
                title={`Fill #${hex}`}
                onClick={() => applyFill(hex)}
                className={`w-4 h-4 rounded-sm border transition-transform hover:scale-110 ${
                  elementFillHex(single) === hex
                    ? 'border-[#60a5fa] ring-1 ring-[#60a5fa]'
                    : 'border-[#334155]'
                }`}
                style={{ backgroundColor: `#${hex}` }}
              />
            ))}
            <CustomColorButton
              title="Custom fill color"
              value={elementFillHex(single)}
              onChange={applyFill}
            />
          </ColorPopover>
        </>
      )}

      {/* Chip: text color + fill */}
      {!annotationMode && single?.type === 'chip' && (
        <>
          <Divider />
          <ColorPopover title="Chip fill" previewColor={single.style.bg ?? 'FFFFFF'}>
            {FILL_PRESETS.map(hex => (
              <button
                key={hex}
                type="button"
                title={`Chip fill #${hex}`}
                onClick={() => onUpdateElement(single.id, { style: { bg: hex, bgGradient: undefined } })}
                className={`w-4 h-4 rounded-sm border transition-transform hover:scale-110 ${
                  single.style.bg === hex ? 'border-[#60a5fa] ring-1 ring-[#60a5fa]' : 'border-[#334155]'
                }`}
                style={{ backgroundColor: `#${hex}` }}
              />
            ))}
            <CustomColorButton
              title="Custom chip fill"
              value={single.style.bg ?? 'FFFFFF'}
              onChange={hex => onUpdateElement(single.id, { style: { bg: hex, bgGradient: undefined } })}
            />
          </ColorPopover>
        </>
      )}

      {/* Text color for single text (not chip) */}
      {!annotationMode && single?.type === 'text' && (
        <>
          <Divider />
          <ColorPopover title="Text color" round previewColor={elementTextHex(single)}>
            {TEXT_PRESETS.map(hex => (
              <button
                key={hex}
                type="button"
                title={`Text #${hex}`}
                onClick={() => onUpdateElement(single.id, { style: { color: hex } })}
                className={`w-4 h-4 rounded-full border transition-transform hover:scale-110 ${
                  elementTextHex(single) === hex ? 'border-[#60a5fa]' : 'border-[#334155]'
                }`}
                style={{ backgroundColor: `#${hex}` }}
              />
            ))}
            <CustomColorButton
              title="Custom text color"
              round
              value={elementTextHex(single)}
              onChange={hex => onUpdateElement(single.id, { style: { color: hex } })}
            />
          </ColorPopover>
        </>
      )}
      </div>
    </div>
  )
}
