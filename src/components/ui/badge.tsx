import * as React from 'react'
import { cn } from '@/lib/utils'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'info' | 'muted'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'border-[#1e3a5f] text-[#64748B] bg-[#112236]',
    success: 'border-[#4ADE8040] text-[#4ADE80] bg-[#4ADE8015]',
    danger:  'border-[#F8717140] text-[#F87171] bg-[#F8717115]',
    warning: 'border-[#FCD34D40] text-[#FCD34D] bg-[#FCD34D15]',
    info:    'border-[#60A5FA40] text-[#60A5FA] bg-[#60A5FA15]',
    muted:   'border-[#33415560] text-[#334155] bg-transparent',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold border',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
