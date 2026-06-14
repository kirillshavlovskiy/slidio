'use client'

import { useState } from 'react'
import {
  History, GitBranch, Tag, RotateCcw, CheckCircle2, XCircle,
  Clock, ChevronRight, ChevronDown, Bot, X, AlertTriangle,
  Layers, Milestone,
} from 'lucide-react'
import type { SlideVersion, DecisionRecord, SlideData, VersionBranch } from '@/lib/types'
import { summarizeDeckChanges } from '@/lib/versionDiff'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const MAIN_BRANCH_ID = 'main'

interface Props {
  versions: SlideVersion[]
  decisions: DecisionRecord[]
  currentSlides: SlideData[]
  activeSlideId: string
  branches?: VersionBranch[]
  currentBranchId?: string
  currentVersionId?: string | null
  onSwitchBranch?: (branchId: string) => void
  onRestoreVersion: (v: SlideVersion) => void
  onRestoreSlide: (slideId: string, fromVersion: SlideVersion) => void
  onNameVersion: (id: string, label: string) => void
  onClose: () => void
}

export default function VersionPanel({
  versions,
  decisions,
  currentSlides,
  activeSlideId,
  branches = [],
  currentBranchId = MAIN_BRANCH_ID,
  currentVersionId = null,
  onSwitchBranch,
  onRestoreVersion,
  onRestoreSlide,
  onNameVersion,
  onClose,
}: Props) {
  const [tab, setTab]               = useState<'versions' | 'decisions'>('versions')
  const [namingId, setNamingId]     = useState<string | null>(null)
  const [nameInput, setNameInput]   = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmId, setConfirmId]   = useState<string | null>(null)

  const decisionsSorted  = [...decisions].reverse()
  const acceptedCount    = decisions.filter(d => d.status === 'accepted').length

  // ── Branch grouping ──
  const branchOf = (v: SlideVersion) => v.branchId ?? MAIN_BRANCH_ID
  // Branch list: prefer the supplied list; otherwise derive from the versions.
  const branchList: VersionBranch[] =
    branches.length > 0
      ? branches
      : Array.from(new Set(versions.map(branchOf))).map(id => ({
          id,
          name: id === MAIN_BRANCH_ID ? 'Main' : 'Branch',
          createdAt: 0,
          forkedFromVersionId: null,
        }))
  // Only branches that actually have snapshots (Main always shown).
  const visibleBranches = branchList.filter(
    b => b.id === MAIN_BRANCH_ID || versions.some(v => branchOf(v) === b.id)
  )
  // The latest (head) snapshot on the active branch.
  const latestOnCurrent = [...versions].reverse().find(v => branchOf(v) === currentBranchId)?.id ?? null
  // The version the deck ACTUALLY reflects right now (restore moves this back).
  const effectiveCurrentId = currentVersionId ?? latestOnCurrent
  // True when we're viewing a restored older version (current ≠ latest).
  const viewingOlder = !!effectiveCurrentId && !!latestOnCurrent && effectiveCurrentId !== latestOnCurrent
  // Human label (v-number within branch) for a version id, for the remark.
  const labelFor = (vid: string | null) => {
    if (!vid) return ''
    const onBranch = versions.filter(v => branchOf(v) === currentBranchId)
    const i = onBranch.findIndex(v => v.id === vid)
    return i >= 0 ? `v${i + 1}` : ''
  }

  // The snapshot a version was built on top of — its explicit parent, else the
  // previous snapshot on the same branch. Used to compute the per-version diff.
  const parentSlidesOf = (v: SlideVersion): SlideData[] | null => {
    if (v.parentVersionId) {
      const p = versions.find(x => x.id === v.parentVersionId)
      if (p) return p.slides
    }
    const sameBranch = versions.filter(x => branchOf(x) === branchOf(v))
    const idx = sameBranch.findIndex(x => x.id === v.id)
    return idx > 0 ? sameBranch[idx - 1].slides : null
  }

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })

  const decisionBadge = (s: DecisionRecord['status']) => {
    if (s === 'accepted') return <Badge variant="success"><CheckCircle2 className="w-2.5 h-2.5" />ACCEPTED</Badge>
    if (s === 'rejected') return <Badge variant="danger"><XCircle className="w-2.5 h-2.5" />REJECTED</Badge>
    return <Badge variant="warning"><Clock className="w-2.5 h-2.5" />PENDING</Badge>
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/60 backdrop-blur-sm">
      <div className="w-[740px] max-h-[88vh] bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e3a5f] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30">
              <GitBranch className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Version Control</p>
              <p className="text-xs text-[#64748B] mt-0.5">
                <span className="text-blue-400 font-semibold">{versions.length}</span>
                <span className="text-[#334155]"> snapshot{versions.length !== 1 ? 's' : ''} · </span>
                <span className="text-amber-400 font-semibold">{visibleBranches.length}</span>
                <span className="text-[#334155]"> branch{visibleBranches.length !== 1 ? 'es' : ''} · </span>
                <span className="text-green-400 font-semibold">{acceptedCount}</span>
                <span className="text-[#334155]"> decisions</span>
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex border-b border-[#1e3a5f] flex-shrink-0">
          <button
            onClick={() => setTab('versions')}
            className={cn(
              'flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold transition-colors',
              tab === 'versions'
                ? 'text-white border-b-2 border-blue-400'
                : 'text-[#475569] hover:text-white'
            )}
          >
            <History className="w-3.5 h-3.5" />
            Versions
            <Badge variant={tab === 'versions' ? 'info' : 'muted'}>{versions.length}</Badge>
          </button>
          <button
            onClick={() => setTab('decisions')}
            className={cn(
              'flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold transition-colors',
              tab === 'decisions'
                ? 'text-white border-b-2 border-blue-400'
                : 'text-[#475569] hover:text-white'
            )}
          >
            <Bot className="w-3.5 h-3.5" />
            Decision Memory
            <Badge variant={tab === 'decisions' ? 'info' : 'muted'}>{decisions.length}</Badge>
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* VERSIONS TAB */}
          {tab === 'versions' && (
            <div className="p-4 space-y-4">
              {versions.length === 0 && (
                <div className="text-center py-10">
                  <History className="w-8 h-8 text-[#1e3a5f] mx-auto mb-2" />
                  <p className="text-xs text-[#334155] italic">
                    No versions yet. Apply a change to create your first snapshot.
                  </p>
                </div>
              )}

              {/* Amber remark: we're viewing a RESTORED older version (no new snapshot
                  was created); the latest version is still ahead. */}
              {viewingOlder && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-200 leading-relaxed">
                    Viewing <span className="font-bold">{labelFor(effectiveCurrentId)}</span> (restored) — the
                    latest is still <span className="font-bold">{labelFor(latestOnCurrent)}</span>. No new version
                    was created. Editing from here will continue the timeline from{' '}
                    <span className="font-bold">{labelFor(effectiveCurrentId)}</span>.
                  </p>
                </div>
              )}

              {visibleBranches.map(branch => {
                const branchVersions = [...versions]
                  .reverse()
                  .filter(v => branchOf(v) === branch.id)
                if (branchVersions.length === 0) return null
                const isActiveBranch = branch.id === currentBranchId
                return (
                  <div key={branch.id} className="space-y-2">
                    {/* Branch header */}
                    <div className="flex items-center gap-2">
                      <GitBranch
                        className={cn('w-3.5 h-3.5', isActiveBranch ? 'text-amber-400' : 'text-[#475569]')}
                      />
                      <span
                        className={cn('text-xs font-bold', isActiveBranch ? 'text-amber-300' : 'text-[#94a3b8]')}
                      >
                        {branch.name}
                      </span>
                      <Badge variant="muted">{branchVersions.length}</Badge>
                      {isActiveBranch ? (
                        <Badge variant="info" className="font-bold">ACTIVE</Badge>
                      ) : (
                        onSwitchBranch && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-auto"
                            onClick={() => onSwitchBranch(branch.id)}
                          >
                            <GitBranch className="w-3 h-3" /> Switch
                          </Button>
                        )
                      )}
                    </div>

                    {branchVersions.map((v, idx) => {
                      const isCurrent  = v.id === effectiveCurrentId  // deck reflects this one
                      const isLatest   = v.id === latestOnCurrent     // newest on the branch
                      const isExpanded = expandedId === v.id
                      const isNaming   = namingId === v.id
                      const linked     = decisions.find(d => d.id === v.decisionId)
                      const labelNum   = branchVersions.length - idx

                return (
                  <div
                    key={v.id}
                    className={cn(
                      'rounded-lg border transition-colors',
                      isCurrent
                        ? viewingOlder
                          ? 'border-amber-500/60 bg-[#241c05]'
                          : 'border-blue-500/50 bg-[#0a1e35]'
                        : 'border-[#1e3a5f] bg-[#112236] hover:border-[#2a4a6f]'
                    )}
                  >
                    {/* Main row */}
                    <div
                      className="flex items-start gap-3 p-3 cursor-pointer select-none"
                      onClick={() => setExpandedId(isExpanded ? null : v.id)}
                    >
                      {/* Version number + milestone dot */}
                      <div className="flex-shrink-0 w-9 text-center pt-0.5">
                        <span className={cn('text-xs font-bold tabular-nums', isCurrent ? 'text-blue-400' : 'text-[#334155]')}>
                          v{labelNum}
                        </span>
                        {v.label && (
                          <div className="w-1.5 h-1.5 bg-amber-400 rounded-full mx-auto mt-1" title="Named milestone" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {isNaming ? (
                          <div className="flex gap-2 mb-1" onClick={e => e.stopPropagation()}>
                            <input
                              autoFocus
                              value={nameInput}
                              onChange={e => setNameInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { onNameVersion(v.id, nameInput); setNamingId(null) }
                                if (e.key === 'Escape') setNamingId(null)
                              }}
                              placeholder="Milestone name…"
                              className="flex-1 bg-[#162C44] border border-blue-400/50 rounded px-2 py-0.5 text-xs text-white outline-none"
                            />
                            <Button
                              size="sm"
                              variant="gold"
                              onClick={() => { onNameVersion(v.id, nameInput); setNamingId(null) }}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <p className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                            {v.label && <Milestone className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                            {v.label ? v.label : v.changeLog}
                          </p>
                        )}
                        {v.label && (
                          <p className="text-[10px] text-[#64748B] truncate">{v.changeLog}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="flex items-center gap-1 text-[10px] text-[#334155]">
                            <Clock className="w-2.5 h-2.5" />{fmt(v.timestamp)}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] text-[#334155]">
                            <Layers className="w-2.5 h-2.5" />{v.slideCount} slides
                          </span>
                          {v.changedSlideIds.length > 0 && (
                            <Badge variant="info">
                              {v.changedSlideIds.length} changed
                            </Badge>
                          )}
                          {linked && (
                            <Badge variant="success">
                              <Bot className="w-2.5 h-2.5" /> AI edit
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        {/* When viewing a restored older version, the current marker is
                            amber to signal "this isn't the latest". */}
                        {isCurrent && (
                          <Badge variant={viewingOlder ? 'warning' : 'info'} className="font-bold">
                            CURRENT
                          </Badge>
                        )}
                        {isLatest && !isCurrent && (
                          <Badge variant="info">LATEST</Badge>
                        )}
                        {!isCurrent && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Name milestone"
                              onClick={() => { setNamingId(v.id); setNameInput(v.label ?? '') }}
                              className="hover:text-amber-400"
                            >
                              <Tag className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmId(v.id)}
                            >
                              <RotateCcw className="w-3 h-3" /> Restore
                            </Button>
                          </>
                        )}
                        {v.changedSlideIds.length > 0 && (
                          isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5 text-[#475569]" />
                            : <ChevronRight className="w-3.5 h-3.5 text-[#475569]" />
                        )}
                      </div>
                    </div>

                    {/* Confirm restore */}
                    {confirmId === v.id && (
                      <div className="px-3 pb-3 pt-2 flex items-center gap-3 border-t border-[#1e3a5f]">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                        <p className="text-xs text-amber-300 flex-1">
                          Restore this version? Current state will be saved first.
                        </p>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                          Cancel
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => { onRestoreVersion(v); setConfirmId(null) }}
                        >
                          <RotateCcw className="w-3 h-3" /> Restore
                        </Button>
                      </div>
                    )}

                    {/* Expanded: per-slide restore */}
                    {/* Commit-style change summary (what changed vs the previous snapshot) */}
                    {isExpanded && !v.isBranchRoot && (() => {
                      const parent = parentSlidesOf(v)
                      if (!parent) return null
                      const diff = summarizeDeckChanges(parent, v.slides)
                      if (diff.slides.length === 0) return null
                      const kindColor: Record<string, string> = {
                        added: 'text-green-400', removed: 'text-[#F87171]', updated: 'text-amber-400',
                      }
                      const sign: Record<string, string> = { added: '+', removed: '−', updated: '~' }
                      return (
                        <div className="px-3 pb-3 border-t border-[#1e3a5f] pt-2">
                          <p className="text-[10px] font-semibold text-[#94a3b8] mb-1.5 flex items-center gap-1">
                            <Layers className="w-2.5 h-2.5" /> Changes · {diff.text}
                          </p>
                          <div className="space-y-1.5">
                            {diff.slides.map(sl => (
                              <div key={sl.slideId} className="rounded bg-[#0a1220] border border-[#1e3a5f] p-1.5">
                                <p className="text-[10px] text-[#CBD5E1] font-medium">
                                  Slide {sl.slideIndex}
                                  <span className="text-[#475569]"> · {sl.title}</span>
                                  {sl.kind === 'added' && <span className="text-green-400"> (new slide)</span>}
                                  {sl.kind === 'removed' && <span className="text-[#F87171]"> (removed slide)</span>}
                                  {sl.bgChanged && <span className="text-amber-400"> · background</span>}
                                </p>
                                {sl.elements.length > 0 && (
                                  <ul className="mt-0.5 space-y-0.5">
                                    {sl.elements.map(el => (
                                      <li key={el.id} className="text-[10px] text-[#64748B] flex items-start gap-1 font-mono">
                                        <span className={cn('font-bold', kindColor[el.kind])}>{sign[el.kind]}</span>
                                        <span className="text-[#475569]">{el.type}</span>
                                        <span className="text-[#94a3b8] truncate">{el.label}</span>
                                        {el.fields && el.fields.length > 0 && (
                                          <span className="text-amber-300/70">({el.fields.join(', ')})</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    {isExpanded && v.changedSlideIds.length > 0 && (
                      <div className="px-3 pb-3 border-t border-[#1e3a5f] pt-2">
                        <p className="text-[10px] text-[#475569] mb-2">
                          Changed slides — restore individually:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {v.changedSlideIds.map(sid => {
                            const slideNum = v.slides.findIndex(s => s.id === sid) + 1
                            const isActive = sid === activeSlideId
                            return (
                              <Button
                                key={sid}
                                variant={isActive ? 'blue' : 'outline'}
                                size="sm"
                                onClick={() => onRestoreSlide(sid, v)}
                              >
                                Slide {slideNum}
                              </Button>
                            )
                          })}
                        </div>
                        {linked && (
                          <div className="mt-2 p-2 rounded bg-[#0a1220] border border-[#1e3a5f]">
                            <p className="flex items-center gap-1 text-[10px] text-green-400 mb-0.5">
                              <Bot className="w-2.5 h-2.5" /> AI Instruction
                            </p>
                            <p className="text-[10px] text-[#CBD5E1] italic">
                              &ldquo;{linked.instruction}&rdquo;
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {/* DECISIONS TAB */}
          {tab === 'decisions' && (
            <div className="p-4 space-y-2">
              {decisionsSorted.length === 0 && (
                <div className="text-center py-10">
                  <Bot className="w-8 h-8 text-[#1e3a5f] mx-auto mb-2" />
                  <p className="text-xs text-[#334155] italic">
                    No decisions recorded yet. Accept or discard an AI patch to start building decision memory.
                  </p>
                </div>
              )}

              {decisionsSorted.map(d => (
                <div key={d.id} className="rounded-lg border border-[#1e3a5f] bg-[#112236] p-3">
                  <div className="flex items-start gap-3">
                    {decisionBadge(d.status)}

                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">
                        &ldquo;{d.instruction}&rdquo;
                      </p>
                      <p className="text-[10px] text-[#64748B] mt-0.5">{d.proposedSummary}</p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="flex items-center gap-1 text-[9px] text-[#334155]">
                          <Clock className="w-2 h-2" />{fmt(d.timestamp)}
                        </span>
                        <span className="text-[9px] text-[#334155]">
                          {d.proposedChanges.length} change{d.proposedChanges.length !== 1 ? 's' : ''}
                        </span>
                        {d.selectedElementIds.length > 0 && (
                          <span className="text-[9px] text-[#334155]">
                            {d.selectedElementIds.length} element{d.selectedElementIds.length !== 1 ? 's' : ''} selected
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-[#1e3a5f] flex-shrink-0 flex justify-between items-center">
          <p className="text-[10px] text-[#334155]">
            Decision memory shapes Claude&apos;s future suggestions.
          </p>
          <Button variant="default" size="md" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
