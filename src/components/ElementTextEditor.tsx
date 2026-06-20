'use client'

import { useEffect, useRef, useState } from 'react'
import { SlideElement, ElementStyle } from '@/lib/types'
import { elementTextHex } from '@/lib/elementStyle'
import { fontFamilyCss } from '@/lib/fonts'
import { CANVAS_PX_PER_IN } from '@/lib/slideDimensions'
import {
  displayTextContent,
  effectiveLineHeight,
  effectiveTextValign,
  fittedCanvasFontSizePx,
  textInnerPaddingPx,
  canvasFontSizePx,
} from '@/lib/textRender'

interface Props {
  element: SlideElement
  onUpdate: (patch: { content?: string; style?: Partial<ElementStyle> }) => void
  onEnd: () => void
}

export default function ElementTextEditor({ element, onUpdate, onEnd }: Props) {
  const [draft, setDraft] = useState(element.content ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const s = element.style ?? {}

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.focus()
    ta.select()
  }, [])

  useEffect(() => {
    setDraft(element.content ?? '')
  }, [element.content])

  const commit = () => {
    if (draft !== (element.content ?? '')) {
      onUpdate({ content: draft })
    }
    onEnd()
  }

  const displayed = displayTextContent(draft)
  const basePx = canvasFontSizePx(s.fontSize ?? 12)
  const innerPad = textInnerPaddingPx(element, s, basePx)
  const innerW = Math.max(1, element.w * CANVAS_PX_PER_IN - innerPad.left - innerPad.right)
  const innerH = Math.max(1, element.h * CANVAS_PX_PER_IN - innerPad.top - innerPad.bottom)
  const fontSizePx = fittedCanvasFontSizePx(s, innerW, innerH, displayed)
  const lineCount = Math.max(1, displayed.split('\n').length)
  const valign = effectiveTextValign(element, s)
  const justify =
    valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center'

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col"
      style={{ justifyContent: justify, overflow: 'visible' }}
      onClick={e => e.stopPropagation()}
    >
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
        className="w-full h-full resize-none bg-transparent border-2 border-[#60a5fa] rounded-sm outline-none"
        style={{
          boxSizing: 'border-box',
          padding: `${innerPad.top}px ${innerPad.right}px ${innerPad.bottom}px ${innerPad.left}px`,
          fontSize: fontSizePx,
          fontFamily: fontFamilyCss(s.fontFace),
          fontWeight: s.fontWeight ?? (s.bold ? 700 : 400),
          fontStyle: s.italic ? 'italic' : 'normal',
          color: `#${elementTextHex(element)}`,
          textAlign: s.align || 'left',
          letterSpacing: s.charSpacing ? `${s.charSpacing * 0.06}em` : undefined,
          lineHeight: effectiveLineHeight(s, lineCount),
          textWrap: lineCount >= 2 ? 'balance' : undefined,
          wordBreak: 'normal',
          overflowWrap: 'break-word',
          overflow: 'visible',
        }}
      />
    </div>
  )
}
