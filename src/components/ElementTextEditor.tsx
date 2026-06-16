'use client'

import { useEffect, useRef, useState } from 'react'
import { SlideElement, ElementStyle } from '@/lib/types'
import { elementTextHex } from '@/lib/elementStyle'
import { fontFamilyCss } from '@/lib/fonts'

interface Props {
  element: SlideElement
  onUpdate: (patch: { content?: string; style?: Partial<ElementStyle> }) => void
  onEnd: () => void
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

  // Keep the draft in sync when the content is changed from the floating
  // toolbar (e.g. toggling a bulleted/numbered list) while editing.
  useEffect(() => {
    setDraft(element.content ?? '')
  }, [element.content])

  const commit = () => {
    if (draft !== (element.content ?? '')) {
      onUpdate({ content: draft })
    }
    onEnd()
  }

  const fontSize = s.fontSize ?? 12

  return (
    <div className="absolute inset-0 z-50 flex flex-col" onClick={e => e.stopPropagation()}>
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
        className="w-full h-full resize-none bg-transparent border-2 border-[#60a5fa] rounded-sm outline-none p-1"
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
