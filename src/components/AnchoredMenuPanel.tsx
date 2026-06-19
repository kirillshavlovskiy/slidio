'use client'

import { createPortal } from 'react-dom'
import { RefObject, useCallback, useLayoutEffect, useState } from 'react'

export function useAnchoredMenuStyle(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  gap = 6
) {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })

  const update = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setStyle({
      position: 'fixed',
      top: rect.bottom + gap,
      left: rect.left,
      minWidth: rect.width,
      zIndex: 60,
      visibility: 'visible',
    })
  }, [anchorRef, gap])

  useLayoutEffect(() => {
    if (!open) return
    update()
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [open, update])

  return style
}

interface AnchoredMenuPanelProps {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
  gap?: number
}

export default function AnchoredMenuPanel({
  anchorRef,
  open,
  onClose,
  children,
  className = '',
  gap = 6,
}: AnchoredMenuPanelProps) {
  const style = useAnchoredMenuStyle(anchorRef, open, gap)

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose} />
      <div
        className={className}
        style={style}
        onMouseDown={e => e.preventDefault()}
      >
        {children}
      </div>
    </>,
    document.body
  )
}
