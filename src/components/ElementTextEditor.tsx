'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Minus,
  Plus,
} from 'lucide-react'
import { SlideElement, ElementStyle } from '@/lib/types'
import { elementTextHex } from '@/lib/elementStyle'
import { fontFamilyCss } from '@/lib/fonts'
import FontFamilySelect from '@/components/FontFamilySelect'

interface Props {
  element: SlideElement
  onUpdate: (patch: { content?: string; style?: Partial<ElementStyle> }) => void
  onEnd: () => void
}

function ToolbarButton({
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

export default function ElementTextEditor({ element, onUpdate, onEnd }: Props) {
  const [draft, setDraft] = useState(element.content ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const s = element.style

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.focus()
    ta.select()
  }, [])

  const commit = () => {
    if (draft !== (element.content ?? '')) {
      onUpdate({ content: draft })
    }
    onEnd()
  }

  const fontSize = s.fontSize ?? 12

  return (
    <div className="absolute inset-0 z-50 flex flex-col" onClick={e => e.stopPropagation()}>
      <div
        className="absolute bottom-full left-0 mb-1 flex items-center gap-0.5 rounded-md border border-[#1e3a5f] bg-[#0d1b2a] px-1 py-0.5 shadow-lg"
        onMouseDown={e => e.preventDefault()}
      >
        <ToolbarButton
          title="Bold"
          active={!!s.bold}
          onClick={() => onUpdate({ style: { bold: !s.bold } })}
        >
          <Bold className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Italic"
          active={!!s.italic}
          onClick={() => onUpdate({ style: { italic: !s.italic } })}
        >
          <Italic className="w-3.5 h-3.5" />
        </ToolbarButton>
        <span className="w-px h-4 bg-[#1e3a5f] mx-0.5" />
        <FontFamilySelect
          value={s.fontFace}
          onChange={fontFace => onUpdate({ style: { fontFace } })}
        />
        <span className="w-px h-4 bg-[#1e3a5f] mx-0.5" />
        <ToolbarButton
          title="Align left"
          active={s.align === 'left' || !s.align}
          onClick={() => onUpdate({ style: { align: 'left' } })}
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Align center"
          active={s.align === 'center'}
          onClick={() => onUpdate({ style: { align: 'center' } })}
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Align right"
          active={s.align === 'right'}
          onClick={() => onUpdate({ style: { align: 'right' } })}
        >
          <AlignRight className="w-3.5 h-3.5" />
        </ToolbarButton>
        <span className="w-px h-4 bg-[#1e3a5f] mx-0.5" />
        <ToolbarButton
          title="Decrease font size"
          onClick={() => onUpdate({ style: { fontSize: Math.max(6, fontSize - 2) } })}
        >
          <Minus className="w-3.5 h-3.5" />
        </ToolbarButton>
        <span className="text-[10px] text-[#64748b] font-mono w-5 text-center">{fontSize}</span>
        <ToolbarButton
          title="Increase font size"
          onClick={() => onUpdate({ style: { fontSize: Math.min(96, fontSize + 2) } })}
        >
          <Plus className="w-3.5 h-3.5" />
        </ToolbarButton>
      </div>

      <textarea
        ref={textareaRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            onEnd()
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            commit()
          }
        }}
        className="w-full h-full resize-none bg-[#0d1b2a]/90 border-2 border-[#60a5fa] rounded-sm outline-none p-1"
        style={{
          fontSize: fontSize * 1.2,
          fontFamily: fontFamilyCss(s.fontFace),
          fontWeight: s.fontWeight ?? (s.bold ? 700 : 400),
          fontStyle: s.italic ? 'italic' : 'normal',
          color: `#${elementTextHex(element)}`,
          textAlign: s.align || 'left',
          letterSpacing: s.charSpacing ? `${s.charSpacing * 0.06}em` : undefined,
          lineHeight: s.lineHeight ?? 1.25,
        }}
      />
    </div>
  )
}
