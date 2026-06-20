'use client'

import { Bot, PenLine } from 'lucide-react'
import { actorDisplayName } from '@/lib/actorInfo'
import { cn } from '@/lib/utils'

interface Props {
  name?: string | null
  email?: string | null
  image?: string | null
  kind: 'ai' | 'manual'
  className?: string
}

/** Small attribution chip: who initiated a change and whether it was AI or manual. */
export default function ActorAttribution({ name, email, image, kind, className }: Props) {
  const label = actorDisplayName(name, email)
  const KindIcon = kind === 'ai' ? Bot : PenLine
  const kindLabel = kind === 'ai' ? 'AI' : 'Manual'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium',
        kind === 'ai'
          ? 'border-green-500/30 bg-green-500/10 text-green-300'
          : 'border-blue-500/30 bg-blue-500/10 text-blue-300',
        className
      )}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
      ) : (
        <span className="w-3.5 h-3.5 rounded-full bg-[#1e3a5f] text-[8px] font-bold flex items-center justify-center text-[#94a3b8]">
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="text-[#CBD5E1] max-w-[72px] truncate">{label}</span>
      <KindIcon className="w-2.5 h-2.5 opacity-80" />
      <span>{kindLabel}</span>
    </span>
  )
}
