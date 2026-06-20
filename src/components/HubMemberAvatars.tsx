'use client'

import type { HubMemberSummary } from '@/lib/types'
import { actorDisplayName } from '@/lib/actorInfo'
import { cn } from '@/lib/utils'

interface Props {
  members: HubMemberSummary[]
  max?: number
  size?: 'sm' | 'md'
  className?: string
}

function Avatar({
  member,
  size,
  style,
}: {
  member: HubMemberSummary
  size: 'sm' | 'md'
  style?: React.CSSProperties
}) {
  const label = actorDisplayName(member.name, member.email)
  const dim = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-xs'
  if (member.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.image}
        alt={label}
        title={`${label} · ${member.role}`}
        className={cn(dim, 'rounded-full border-2 border-[#0d1b2a] object-cover shrink-0')}
        style={style}
      />
    )
  }
  return (
    <div
      title={`${label} · ${member.role}`}
      className={cn(
        dim,
        'rounded-full border-2 border-[#0d1b2a] bg-violet-500/25 text-violet-200 font-bold flex items-center justify-center shrink-0'
      )}
      style={style}
    >
      {label.charAt(0).toUpperCase()}
    </div>
  )
}

/** Overlapping collaborator avatars for a Knowledge Hub. */
export default function HubMemberAvatars({ members, max = 5, size = 'sm', className }: Props) {
  if (members.length === 0) return null
  const shown = members.slice(0, max)
  const overflow = members.length - shown.length

  return (
    <div className={cn('flex items-center', className)}>
      <div className="flex items-center -space-x-2">
        {shown.map((m, i) => (
          <Avatar key={m.userId} member={m} size={size} style={{ zIndex: shown.length - i }} />
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-1.5 text-[10px] text-[#64748B] tabular-nums">+{overflow}</span>
      )}
    </div>
  )
}
