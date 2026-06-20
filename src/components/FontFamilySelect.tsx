'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  DEFAULT_FONT,
  FONT_GROUPS,
  extraFontsForPicker,
  fontFamilyCss,
} from '@/lib/fonts'
import { useDesignTokens } from '@/components/DesignTokensProvider'
import AnchoredMenuPanel from '@/components/AnchoredMenuPanel'

interface Props {
  value?: string
  onChange: (fontFace: string) => void
  className?: string
  /** Render the menu in a body portal so it escapes overflow-hidden ancestors. */
  menuPortal?: boolean
  /** Additional families to surface (e.g. fonts already used on the deck). */
  deckFonts?: string[]
}

// A custom dropdown (not a native <select>) so each option renders in its own
// typeface — native option elements ignore font-family on most platforms.
export default function FontFamilySelect({
  value,
  onChange,
  className = '',
  menuPortal = false,
  deckFonts = [],
}: Props) {
  const current = value || DEFAULT_FONT
  const tokens = useDesignTokens()
  const dsFonts = tokens?.fonts ?? []
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const inDeckOnly = useMemo(
    () => extraFontsForPicker(Object.values(FONT_GROUPS).flat(), deckFonts, dsFonts, value ? [value] : []),
    [deckFonts, dsFonts, value]
  )

  useEffect(() => {
    if (!open || menuPortal) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, menuPortal])

  const Item = (font: string) => (
    <button
      key={font}
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={() => {
        onChange(font)
        setOpen(false)
      }}
      className={`block w-full truncate text-left px-2 py-1.5 text-[12px] transition-colors ${
        font === current ? 'bg-[#152a45] text-[#93c5fd]' : 'text-[#e2e8f0] hover:bg-[#1e3a5f]'
      }`}
      style={{ fontFamily: fontFamilyCss(font) }}
      title={font}
    >
      {font}
    </button>
  )

  const menuBody = (
    <>
      {dsFonts.length > 0 && (
        <>
          <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-400/80">
            Design System
          </p>
          {dsFonts.map(Item)}
          <div className="my-1 h-px bg-[#16263b]" />
        </>
      )}
      {inDeckOnly.length > 0 && (
        <>
          <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400/80">
            In deck
          </p>
          {inDeckOnly.map(Item)}
          <div className="my-1 h-px bg-[#16263b]" />
        </>
      )}
      {Object.entries(FONT_GROUPS).map(([group, fonts]) => (
        <div key={group}>
          <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#475569]">
            {group}
          </p>
          {fonts.map(Item)}
        </div>
      ))}
    </>
  )

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        title="Font family"
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(o => !o)}
        className="h-7 w-full flex items-center justify-between gap-1 rounded-md border border-[#1e3a5f] bg-[#060d1a] px-1.5 text-[11px] text-[#e2e8f0] outline-none hover:border-[#60a5fa]"
        style={{ fontFamily: fontFamilyCss(current) }}
      >
        <span className="truncate">{current}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0 text-[#64748b]" />
      </button>

      {open &&
        (menuPortal ? (
          <AnchoredMenuPanel
            anchorRef={ref}
            open={open}
            onClose={() => setOpen(false)}
            className="max-h-72 min-w-[180px] overflow-y-auto rounded-md border border-[#1e3a5f] bg-[#0d1b2a] py-1 shadow-2xl"
          >
            {menuBody}
          </AnchoredMenuPanel>
        ) : (
          <div className="absolute left-0 z-[60] mt-1 max-h-72 min-w-[180px] w-full overflow-y-auto rounded-md border border-[#1e3a5f] bg-[#0d1b2a] py-1 shadow-2xl">
            {menuBody}
          </div>
        ))}
    </div>
  )
}
