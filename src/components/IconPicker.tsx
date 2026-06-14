'use client'
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { ICON_GROUPS, ICON_MAP } from '@/lib/icons'

interface Props {
  current?: string
  onSelect: (name: string) => void
  onClose: () => void
}

export default function IconPicker({ current, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ICON_GROUPS
    const matched = ICON_GROUPS.map(g => ({
      label: g.label,
      names: g.names.filter(n => n.toLowerCase().includes(q)),
    })).filter(g => g.names.length > 0)
    return matched
  }, [query])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[#1e3a5f] bg-[#0b1526] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[#1e3a5f] px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Insert icon</h2>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search icons…"
            className="ml-auto w-48 rounded-md border border-[#1e3a5f] bg-[#060d1a] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-[#60a5fa] focus:outline-none"
          />
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-[#1e3a5f] hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {groups.length === 0 && (
            <p className="py-8 text-center text-xs text-slate-500">No icons match “{query}”.</p>
          )}
          {groups.map(group => (
            <div key={group.label} className="mb-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {group.label}
              </p>
              <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
                {group.names.map(name => {
                  const Icon = ICON_MAP[name]
                  if (!Icon) return null
                  const active = name === current
                  return (
                    <button
                      key={name}
                      title={name}
                      onClick={() => onSelect(name)}
                      className={`flex aspect-square items-center justify-center rounded-md border transition-colors ${
                        active
                          ? 'border-[#60a5fa] bg-[#1e3a5f] text-[#93c5fd]'
                          : 'border-transparent bg-[#060d1a] text-slate-300 hover:border-[#1e3a5f] hover:bg-[#11243b] hover:text-white'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
