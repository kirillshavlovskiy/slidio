'use client'
import { useState } from 'react'
import {
  Wand2, SplitSquareHorizontal, Combine, LayoutGrid, Layers, Sparkles, BarChart3, Table,
  type LucideIcon,
} from 'lucide-react'
import { QuickAction, QuickActionContext } from '@/lib/quickActions'

// Icons used by the action menu rows (separate from the on-slide icon catalog).
const ACTION_ICONS: Record<string, LucideIcon> = {
  SplitSquareHorizontal,
  Combine,
  LayoutGrid,
  Layers,
  Sparkles,
  BarChart3,
  Table,
}

interface Props {
  actions: QuickAction[]
  ctx: QuickActionContext
  disabled?: boolean
  onRun: (action: QuickAction) => void
}

export default function QuickActionsMenu({ actions, ctx, disabled, onRun }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title="Quick AI actions (split, merge, tidy…)"
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[#1e3a5f] text-violet-300 rounded hover:bg-[#2a4a6f] hover:text-violet-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Wand2 className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Actions</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-[#1e3a5f] bg-[#0b1526] shadow-2xl">
            <p className="border-b border-[#16263b] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#64748b]">
              Quick AI actions
            </p>
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {actions.map(action => {
                const available = action.isAvailable(ctx)
                const Icon = ACTION_ICONS[action.icon] ?? Wand2
                return (
                  <button
                    key={action.id}
                    disabled={!available || disabled}
                    onClick={() => {
                      setOpen(false)
                      onRun(action)
                    }}
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#11243b] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-300" />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-slate-100">{action.label}</span>
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
  )
}
