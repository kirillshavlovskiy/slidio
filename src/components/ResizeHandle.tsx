'use client'

import { useCallback } from 'react'

interface Props {
  side: 'left' | 'right'
  onResize: (delta: number) => void
}

export default function ResizeHandle({ side, onResize }: Props) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      let lastX = e.clientX

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - lastX
        lastX = ev.clientX
        onResize(side === 'left' ? delta : -delta)
      }

      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [side, onResize]
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize slide panel' : 'Resize chat panel'}
      onMouseDown={onMouseDown}
      className="w-1.5 flex-shrink-0 cursor-col-resize relative z-10 bg-[#1e3a5f]/40 hover:bg-[#60a5fa]/40 active:bg-[#60a5fa]/60 transition-colors"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  )
}
