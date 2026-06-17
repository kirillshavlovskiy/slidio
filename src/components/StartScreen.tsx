'use client'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Plus,
  FileText,
  Clock,
  LogOut,
  Pencil,
  Trash2,
  X,
  GitBranch,
  Check,
  Upload,
  Palette,
  Brain,
  Sparkles,
  Zap,
  Loader2,
  Users,
} from 'lucide-react'
import { KnowledgeBranch, PresentationSummary } from '@/lib/types'
import ShareHubDialog from '@/components/ShareHubDialog'
import { IMPORT_ACCEPT } from '@/lib/importDeck'
import {
  PLANS,
  PLAN_ORDER,
  SHARED_FEATURES,
  approxEdits,
  formatTokens,
  tokensForPlan,
  type BillingInterval,
  type PlanId,
} from '@/lib/billing/plans'
import { startCheckout, openBillingPortal } from '@/lib/billing/client'

interface BillingUsage {
  tokensUsed: number
  tokenLimit: number
  tokensRemaining: number
  periodKey: string
}

export interface ImportJob {
  id: string
  name: string
  status: 'loading' | 'error'
  error?: string
}

interface Props {
  branches: KnowledgeBranch[]
  presentations: PresentationSummary[]
  userName?: string | null
  loading?: boolean
  onOpen: (presentationId: string) => void
  onCreate: (opts: { name: string; branchId?: string; newBranchName?: string }) => void
  /** Create a brand-new, empty knowledge branch (hub) with its own layers. */
  onCreateBranch?: (name: string) => Promise<void> | void
  onImportFile?: (file: File, branchId?: string) => Promise<void> | void
  /** In-progress / failed background imports, shown as pending cards. */
  importJobs?: ImportJob[]
  onDismissImportJob?: (id: string) => void
  onRenameBranch: (id: string, name: string) => void
  onDeleteBranch: (id: string) => void
  onDeletePresentation?: (id: string) => void
  /** Rename a presentation in place. */
  onRenamePresentation?: (id: string, name: string) => void
  /** Open the shared Knowledge layers panel scoped to a hub. */
  onOpenKnowledge?: (branchId: string) => void
  /** Open the shared Design System panel scoped to a hub. */
  onOpenDesign?: (branchId: string) => void
  onSignOut: () => void
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!t) return ''
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(t).toLocaleDateString()
}

export default function StartScreen({
  branches,
  presentations,
  userName,
  loading,
  onOpen,
  onCreate,
  onCreateBranch,
  onImportFile,
  importJobs,
  onDismissImportJob,
  onRenameBranch,
  onDeleteBranch,
  onDeletePresentation,
  onRenamePresentation,
  onOpenKnowledge,
  onOpenDesign,
  onSignOut,
}: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [showCreateBranch, setShowCreateBranch] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [sharingHub, setSharingHub] = useState<{ id: string; name: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Current tariff (plan) for the header badge + upgrade/manage button.
  const [plan, setPlan] = useState<PlanId>('free')
  const [usage, setUsage] = useState<BillingUsage | null>(null)
  const [planLimits, setPlanLimits] = useState<Record<PlanId, number> | null>(null)
  const [showPlans, setShowPlans] = useState(false)
  const [showUsage, setShowUsage] = useState(false)
  const usagePopoverRef = useRef<HTMLDivElement>(null)

  const refreshBillingState = () =>
    fetch('/api/billing/state')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return
        if (data.plan) setPlan(data.plan as PlanId)
        if (data.usage) setUsage(data.usage as BillingUsage)
      })
      .catch(() => {})

  useEffect(() => {
    void refreshBillingState()
    fetch('/api/billing/plans')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.limits) setPlanLimits(data.limits as Record<PlanId, number>)
      })
      .catch(() => {})
  }, [])

  // Refresh when the usage popover or upgrade dialog opens.
  useEffect(() => {
    if (!showPlans && !showUsage) return
    void refreshBillingState()
  }, [showPlans, showUsage])

  // Close usage popover on outside click.
  useEffect(() => {
    if (!showUsage) return
    const onDoc = (e: Event) => {
      if (usagePopoverRef.current && !usagePopoverRef.current.contains(e.target as Node)) {
        setShowUsage(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [showUsage])

  // Free/Pro can move up a tier; Max manages its existing subscription.
  const canUpgrade = plan !== 'max'
  // Which branch a click on an "Import" button targets (set just before opening
  // the shared hidden file input).
  const importBranchRef = useRef<string | undefined>(undefined)

  const handleImport = async (file: File) => {
    if (!onImportFile) return
    setImportError(null)
    setImporting(true)
    try {
      await onImportFile(file, importBranchRef.current)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import presentation.')
    } finally {
      setImporting(false)
    }
  }

  const byBranch = useMemo(() => {
    const map = new Map<string, PresentationSummary[]>()
    for (const p of presentations) {
      const key = p.branchId || '__none__'
      const list = map.get(key) || []
      list.push(p)
      map.set(key, list)
    }
    return map
  }, [presentations])

  const orphans = byBranch.get('__none__') || []

  return (
    <div className="h-screen overflow-auto bg-[#060d1a] text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-4 bg-[#060d1a]/90 backdrop-blur border-b border-[#13243a]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0d1b2a] border border-[#1e3a5f] flex items-center justify-center">
            <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">Slidio</h1>
            <p className="text-[11px] text-[#64748B] leading-tight">
              {userName ? `Signed in as ${userName}` : 'Your presentation portfolio'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Current plan badge — shows usage popover; upgrade opens full plan picker */}
          <div ref={usagePopoverRef} className="relative">
            <button
              type="button"
              onClick={() => setShowUsage(v => !v)}
              title="View token usage this period"
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                showUsage
                  ? 'text-white border-[#1e3a5f] bg-[#0d1b2a]'
                  : plan === 'max'
                    ? 'text-violet-300 border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20'
                    : plan === 'pro'
                      ? 'text-blue-300 border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20'
                      : 'text-[#94a3b8] border-[#1e3a5f] hover:text-white hover:bg-[#0d1b2a]'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {PLANS[plan].name} plan
            </button>
            {showUsage && (
              <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-[#1e3a5f] bg-[#0a0f1a] p-4 shadow-2xl">
                <p className="text-sm font-semibold text-white">{PLANS[plan].name} plan</p>
                <p className="mt-0.5 text-xs text-slate-500">Token usage this billing period</p>
                {usage ? (
                  <UsageMeter usage={usage} className="mt-3" />
                ) : (
                  <p className="mt-3 text-xs text-slate-500">Loading usage…</p>
                )}
                {canUpgrade && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowUsage(false)
                      setShowPlans(true)
                    }}
                    className="mt-3 w-full rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Upgrade plan
                  </button>
                )}
              </div>
            )}
          </div>
          {canUpgrade && (
            <button
              type="button"
              onClick={() => {
                setShowUsage(false)
                setShowPlans(true)
              }}
              title="See upgrade options"
              className="group inline-flex rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 p-px transition-opacity hover:opacity-90"
            >
              <span className="inline-flex items-center gap-1.5 rounded-[7px] bg-[#060d1a] px-3.5 py-2 text-sm font-semibold">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                  Upgrade
                </span>
              </span>
            </button>
          )}
          {onImportFile && (
            <input
              ref={importInputRef}
              type="file"
              accept={IMPORT_ACCEPT}
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void handleImport(f)
                e.target.value = ''
              }}
            />
          )}
          <button
            onClick={() => (onCreateBranch ? setShowCreateBranch(true) : setShowCreate(true))}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-3.5 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> New knowledge branch
          </button>
          <button
            onClick={onSignOut}
            title="Sign out"
            className="flex items-center gap-1.5 text-[#64748B] hover:text-white text-xs px-2.5 py-2 rounded-lg hover:bg-[#0d1b2a] transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {importError && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <X className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{importError}</span>
            <button
              onClick={() => setImportError(null)}
              className="ml-auto text-red-300/70 hover:text-red-200"
            >
              Dismiss
            </button>
          </div>
        )}
        {importJobs && importJobs.length > 0 && (
          <div className="mb-6 space-y-2">
            {importJobs.map(job => (
              <div
                key={job.id}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
                  job.status === 'error'
                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                    : 'border-violet-500/30 bg-violet-500/10 text-violet-200'
                }`}
              >
                {job.status === 'loading' ? (
                  <span className="w-4 h-4 border-2 border-violet-300 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : (
                  <X className="w-4 h-4 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="font-medium truncate">{job.name}</div>
                  <div className="text-[11px] opacity-80">
                    {job.status === 'error'
                      ? job.error
                      : "Importing… you can keep working or open another deck — it'll appear here when ready."}
                  </div>
                </div>
                {job.status === 'error' && onDismissImportJob && (
                  <button
                    onClick={() => onDismissImportJob(job.id)}
                    className="ml-auto shrink-0 text-red-300/70 hover:text-red-200"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mb-6">
          <h2 className="text-lg font-semibold">Knowledge Hub</h2>
          <p className="text-xs text-[#64748B] mt-1">
            A Knowledge Hub is a shared workspace — like a Git repo for presentations.
            Decks in a hub share its knowledge, design system, and history, so a team can
            read, edit, and build on the same context together.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-7 h-7 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {branches.map(branch => {
              const decks = byBranch.get(branch.id) || []
              const isOwner = branch.isOwner || branch.role === 'owner'
              const canWriteHub = branch.role !== 'viewer'
              return (
                <section
                  key={branch.id}
                  className="rounded-2xl border border-[#13243a] bg-[#0a1525] overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#13243a] bg-[#0d1b2a]/60">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <GitBranch className="w-4 h-4 text-violet-400 shrink-0" />
                      {renamingId === branch.id ? (
                        <form
                          onSubmit={e => {
                            e.preventDefault()
                            if (renameValue.trim()) onRenameBranch(branch.id, renameValue.trim())
                            setRenamingId(null)
                          }}
                          className="flex items-center gap-1.5"
                        >
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            className="bg-[#060d1a] border border-[#1e3a5f] rounded px-2 py-1 text-sm text-white outline-none focus:border-violet-500"
                          />
                          <button type="submit" className="text-green-400 hover:text-green-300">
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            className="text-[#64748B] hover:text-white"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </form>
                      ) : (
                        <>
                          <h3 className="text-sm font-semibold truncate">{branch.name}</h3>
                          <span className="text-[11px] text-[#64748B] shrink-0">
                            {decks.length} deck{decks.length !== 1 ? 's' : ''}
                          </span>
                          {isOwner && (
                            <button
                              onClick={() => {
                                setRenamingId(branch.id)
                                setRenameValue(branch.name)
                              }}
                              className="text-[#475569] hover:text-white transition-colors"
                              title="Rename hub"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {branch.role && branch.role !== 'owner' && (
                        <span className="text-[10px] text-[#64748B] border border-[#1e3a5f] rounded px-1.5 py-0.5 capitalize">
                          {branch.role}
                        </span>
                      )}
                      <button
                        onClick={() => setSharingHub({ id: branch.id, name: branch.name })}
                        className="flex items-center gap-1 text-xs text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f]/50 px-2 py-1 rounded transition-colors"
                        title="Share hub"
                      >
                        <Users className="w-3.5 h-3.5" /> Share
                      </button>
                      {onOpenDesign && (
                        <button
                          onClick={() => onOpenDesign(branch.id)}
                          title="Open the Design System for this hub"
                          className="flex items-center gap-1 p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
                        >
                          <Palette className="w-4 h-4" />
                          <span className="text-[10px] font-mono text-[#64748B]">
                            {(branch.knowledgeLayers || []).filter(l => l.type === 'style').length}
                          </span>
                        </button>
                      )}
                      {onOpenKnowledge && (
                        <button
                          onClick={() => onOpenKnowledge(branch.id)}
                          title="Open the Knowledge layers for this hub"
                          className="flex items-center gap-1 p-1.5 text-[#94a3b8] rounded hover:bg-[#1e3a5f] hover:text-white transition-colors"
                        >
                          <Brain className="w-4 h-4" />
                          <span className="text-[10px] font-mono text-[#64748B]">
                            {(branch.knowledgeLayers || []).filter(l => l.enabled).length}
                          </span>
                        </button>
                      )}
                      <div className="w-px h-5 bg-[#1e3a5f] mx-0.5" />
                      {onImportFile && canWriteHub && (
                        <button
                          onClick={() => {
                            importBranchRef.current = branch.id
                            importInputRef.current?.click()
                          }}
                          disabled={importing}
                          title="Import a .pptx or .pdf into this branch"
                          className="flex items-center gap-1 text-xs text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f]/50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          {importing ? (
                            <span className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5" />
                          )}
                          Import
                        </button>
                      )}
                      {canWriteHub && (
                        <button
                          onClick={() => onCreate({ name: '', branchId: branch.id })}
                          className="flex items-center gap-1 text-xs text-violet-300 hover:text-white hover:bg-[#1e3a5f]/50 px-2 py-1 rounded transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" /> New deck
                        </button>
                      )}
                      {decks.length === 0 && isOwner && (
                        <button
                          onClick={() => onDeleteBranch(branch.id)}
                          className="text-[#475569] hover:text-red-400 px-1.5 py-1 rounded transition-colors"
                          title="Delete empty hub"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {decks.length === 0 ? (
                    <div className="px-5 py-6 text-center text-xs text-[#475569]">
                      No presentations yet — create one to populate this hub.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                      {decks.map(deck => (
                        <DeckCard
                          key={deck.id}
                          deck={deck}
                          withIcon
                          onOpen={onOpen}
                          onDelete={onDeletePresentation}
                          onRename={onRenamePresentation}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}

            {orphans.length > 0 && (
              <section className="rounded-2xl border border-[#13243a] bg-[#0a1525] p-4">
                <h3 className="text-sm font-semibold mb-3 px-1">Unassigned presentations</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {orphans.map(deck => (
                    <DeckCard
                      key={deck.id}
                      deck={deck}
                      onOpen={onOpen}
                      onDelete={onDeletePresentation}
                      onRename={onRenamePresentation}
                    />
                  ))}
                </div>
              </section>
            )}

            {branches.length === 0 && orphans.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#1e3a5f] py-16 text-center">
                <p className="text-sm text-[#64748B]">No presentations yet.</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-3 inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" /> Create your first presentation
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {showCreate && (
        <CreateDialog
          branches={branches}
          onClose={() => setShowCreate(false)}
          onCreate={opts => {
            onCreate(opts)
            setShowCreate(false)
          }}
        />
      )}

      {showCreateBranch && onCreateBranch && (
        <BranchDialog
          existingNames={branches.map(b => b.name)}
          onClose={() => setShowCreateBranch(false)}
          onCreate={async name => {
            await onCreateBranch(name)
            setShowCreateBranch(false)
          }}
        />
      )}

      {showPlans && (
        <PlanDialog
          currentPlan={plan}
          usage={usage}
          planLimits={planLimits}
          onClose={() => setShowPlans(false)}
        />
      )}

      {sharingHub && (
        <ShareHubDialog
          hubId={sharingHub.id}
          hubName={sharingHub.name}
          onClose={() => setSharingHub(null)}
        />
      )}

    </div>
  )
}

// Dedicated "create a new knowledge branch" view: a single name field plus a
// short description of what a branch is. Mirrors the "Create a new hub" option
// from the presentation dialog, but as its own focused flow.
function BranchDialog({
  existingNames,
  onClose,
  onCreate,
}: {
  existingNames: string[]
  onClose: () => void
  onCreate: (name: string) => Promise<void> | void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()
  const duplicate = existingNames.some(n => n.trim().toLowerCase() === trimmed.toLowerCase())
  const canSubmit = !!trimmed && !duplicate && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      await onCreate(trimmed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#1e3a5f] bg-[#0d1b2a] p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-white">Create new branch</h3>
          <button onClick={onClose} className="text-[#64748B] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[12px] text-[#64748B] mb-4">
          A knowledge branch is a shared workspace with its own knowledge layers and design system.
          Decks inside it give the AI better context for on-brand edits.
        </p>

        <label className="block text-xs text-[#94a3b8] mb-1.5">Branch name</label>
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#1e3a5f] bg-[#060d1a] px-3 py-2 focus-within:border-violet-500">
          <GitBranch className="w-4 h-4 text-violet-400 shrink-0" />
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void submit()
            }}
            placeholder="e.g. Acme Q3, Sales playbook, Product launch"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-[#475569]"
          />
        </div>
        {duplicate && (
          <p className="mb-2 text-[11px] text-amber-400">A branch with this name already exists.</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg text-sm text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f]/40 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Create branch
          </button>
        </div>
      </div>
    </div>
  )
}

function UsageMeter({ usage, className = '' }: { usage: BillingUsage; className?: string }) {
  return (
    <div className={`rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 ${className}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-emerald-300">This period</span>
        <span className="text-slate-400">
          {formatTokens(usage.tokensUsed)} / {formatTokens(usage.tokenLimit)}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#0a0f1a]">
        <div
          className={`h-full rounded-full transition-all ${
            usage.tokensRemaining <= 0
              ? 'bg-red-500'
              : usage.tokensUsed / usage.tokenLimit >= 0.85
                ? 'bg-amber-400'
                : 'bg-emerald-400'
          }`}
          style={{
            width: `${Math.min(100, Math.round((usage.tokensUsed / usage.tokenLimit) * 100))}%`,
          }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {usage.tokensRemaining <= 0 ? (
          <span className="text-red-400">Limit reached — upgrade or wait for reset</span>
        ) : (
          <>
            <span className="text-slate-300">{formatTokens(usage.tokensRemaining)}</span> remaining
            {' · '}
            ≈ {approxEdits(usage.tokensRemaining).toLocaleString()} edits left
          </>
        )}
      </p>
    </div>
  )
}

function PlanDialog({
  currentPlan,
  usage,
  planLimits,
  onClose,
}: {
  currentPlan: PlanId
  usage: BillingUsage | null
  planLimits: Record<PlanId, number> | null
  onClose: () => void
}) {
  const [interval, setInterval] = useState<BillingInterval>('monthly')
  const [busy, setBusy] = useState<PlanId | 'portal' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSelect = async (planId: PlanId) => {
    setError(null)
    setBusy(planId)
    try {
      await startCheckout(planId, interval)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
      setBusy(null)
    }
  }

  const handleManage = async () => {
    setError(null)
    setBusy('portal')
    try {
      await openBillingPortal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open billing portal.')
      setBusy(null)
    }
  }

  const currentRank = PLAN_ORDER.indexOf(currentPlan)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl border border-[#1e3a5f] bg-[#0a0f1a] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h2 className="text-xl font-bold text-white">Choose your plan</h2>
            <p className="mt-1 text-sm text-slate-400">
              Same features on every plan — only the monthly token budget changes.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#64748B] hover:text-white hover:bg-[#0d1b2a] transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 flex items-center justify-center gap-3">
          <span className={`text-sm font-medium ${interval === 'monthly' ? 'text-white' : 'text-slate-500'}`}>
            Monthly
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={interval === 'yearly'}
            onClick={() => setInterval(i => (i === 'monthly' ? 'yearly' : 'monthly'))}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              interval === 'yearly' ? 'bg-gradient-to-r from-violet-500 to-blue-500' : 'bg-[#1e3a5f]'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                interval === 'yearly' ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span className={`text-sm font-medium ${interval === 'yearly' ? 'text-white' : 'text-slate-500'}`}>
            Yearly <span className="text-emerald-400">(2 months free)</span>
          </span>
        </div>

        <div className="grid gap-4 px-6 py-6 lg:grid-cols-3">
          {PLAN_ORDER.map(planId => {
            const plan = PLANS[planId]
            const monthlyTokens = tokensForPlan(planId, planLimits)
            const price = interval === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice
            const priceLabel =
              plan.monthlyPrice === 0
                ? '$0'
                : interval === 'yearly'
                  ? `$${Math.round(price / 12)}`
                  : `$${Number.isInteger(price) ? price : price.toFixed(2)}`
            const isCurrent = planId === currentPlan
            const rank = PLAN_ORDER.indexOf(planId)

            return (
              <div
                key={plan.id}
                className={`flex flex-col rounded-2xl border bg-[#0d1b2a] p-5 ${
                  isCurrent
                    ? 'border-emerald-500/60 ring-1 ring-emerald-500/30'
                    : plan.highlighted
                      ? 'border-violet-500/60 ring-1 ring-violet-500/40'
                      : 'border-[#1e3a5f]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                  {isCurrent ? (
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                      Current
                    </span>
                  ) : plan.highlighted ? (
                    <span className="rounded-full bg-gradient-to-r from-violet-500 to-blue-500 px-2.5 py-1 text-xs font-semibold text-white">
                      Most popular
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-400">{plan.tagline}</p>

                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight text-white">{priceLabel}</span>
                  {plan.monthlyPrice > 0 && <span className="text-sm text-slate-400">/mo</span>}
                </div>
                {plan.paid && interval === 'yearly' && (
                  <p className="mt-1 text-xs text-slate-500">Billed ${plan.yearlyPrice}/year</p>
                )}

                <div className="mt-4 rounded-xl bg-[#0a0f1a] p-3">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-400" />
                    <span className="text-lg font-bold text-white">{formatTokens(monthlyTokens)}</span>
                    <span className="text-sm text-slate-400">tokens / mo</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    ≈ {approxEdits(monthlyTokens).toLocaleString()} AI edits
                  </p>
                </div>

                {isCurrent && usage && <UsageMeter usage={usage} className="mt-3" />}

                <ul className="mt-4 space-y-2 text-sm">
                  {SHARED_FEATURES.map(feature => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span className="text-slate-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6">
                  {isCurrent ? (
                    plan.paid ? (
                      <button
                        type="button"
                        onClick={handleManage}
                        disabled={busy !== null}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-[#1e3a5f] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-[#11233b] disabled:opacity-50"
                      >
                        {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Manage billing'}
                      </button>
                    ) : (
                      <div className="inline-flex w-full items-center justify-center rounded-xl border border-[#1e3a5f] px-4 py-2.5 text-sm font-semibold text-slate-500">
                        Your current plan
                      </div>
                    )
                  ) : !plan.paid ? (
                    <button
                      type="button"
                      onClick={handleManage}
                      disabled={busy !== null}
                      className="inline-flex w-full items-center justify-center rounded-xl border border-[#1e3a5f] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-[#11233b] disabled:opacity-50"
                    >
                      {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Downgrade'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSelect(planId)}
                      disabled={busy !== null}
                      className={`inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 ${
                        plan.highlighted || rank > currentRank
                          ? 'bg-gradient-to-r from-violet-500 to-blue-500 text-white'
                          : 'border border-[#1e3a5f] text-slate-200 hover:bg-[#11233b]'
                      }`}
                    >
                      {busy === planId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : rank > currentRank ? (
                        `Upgrade to ${plan.name}`
                      ) : (
                        `Switch to ${plan.name}`
                      )}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {error && <p className="px-6 pb-4 text-center text-sm text-red-400">{error}</p>}
        <p className="px-6 pb-6 text-center text-xs text-slate-500">
          A token is one unit of AI work (input + output) across a single edit. Simple element-level
          commands are cheap; deck-wide edits use more.
        </p>
      </div>
    </div>
  )
}

// A single deck tile with an inline delete affordance. The delete button is a
// sibling of the clickable card (not nested) so we don't nest <button> elements.
function DeckCard({
  deck,
  withIcon,
  onOpen,
  onDelete,
  onRename,
}: {
  deck: PresentationSummary
  withIcon?: boolean
  onOpen: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(deck.name)

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation()
    const ok = window.confirm(
      `Delete "${deck.name || 'Untitled Presentation'}"? This removes the deck and its history. The hub's shared knowledge and design layers are kept.`
    )
    if (ok) onDelete?.(deck.id)
  }

  const startRename = (e: MouseEvent) => {
    e.stopPropagation()
    setValue(deck.name)
    setEditing(true)
  }

  const commitRename = () => {
    const next = value.trim()
    setEditing(false)
    if (next && next !== deck.name) onRename?.(deck.id, next)
  }

  // How much right padding the title needs so it clears the hover action buttons.
  const actionCount = (onRename ? 1 : 0) + (onDelete ? 1 : 0)
  const titlePad = actionCount >= 2 ? 'pr-14' : actionCount === 1 ? 'pr-7' : ''

  return (
    <div className="group relative">
      <button
        onClick={() => onOpen(deck.id)}
        className="w-full text-left rounded-xl border border-[#13243a] bg-[#0d1b2a] hover:border-violet-500/60 hover:bg-[#11203a] transition-colors p-4"
      >
        <div className="flex items-start gap-2.5">
          {withIcon && (
            <div className="w-9 h-9 rounded-lg bg-[#13243a] group-hover:bg-violet-600/20 flex items-center justify-center shrink-0 transition-colors">
              <FileText className="w-4 h-4 text-violet-300" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                autoFocus
                value={value}
                onChange={e => setValue(e.target.value)}
                onClick={e => {
                  e.stopPropagation()
                  e.preventDefault()
                }}
                onKeyDown={e => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditing(false)
                }}
                onBlur={commitRename}
                placeholder="Presentation name"
                className="w-full bg-[#060d1a] border border-violet-500 rounded px-2 py-1 text-sm text-white outline-none mb-1"
              />
            ) : (
              <div className={`text-sm font-medium truncate ${titlePad}`}>{deck.name}</div>
            )}
            <div className="flex items-center gap-1 text-[11px] text-[#64748B] mt-1">
              <Clock className="w-3 h-3" /> {timeAgo(deck.updatedAt)}
            </div>
          </div>
        </div>
      </button>
      {!editing && onRename && (
        <button
          onClick={startRename}
          title="Rename presentation"
          className={`absolute top-2.5 ${onDelete ? 'right-9' : 'right-2.5'} rounded-md p-1.5 text-[#475569] opacity-0 group-hover:opacity-100 hover:text-violet-300 hover:bg-violet-500/10 transition-all focus:opacity-100`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      {!editing && onDelete && (
        <button
          onClick={handleDelete}
          title="Delete presentation"
          className="absolute top-2.5 right-2.5 rounded-md p-1.5 text-[#475569] opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all focus:opacity-100"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

function CreateDialog({
  branches,
  onClose,
  onCreate,
}: {
  branches: KnowledgeBranch[]
  onClose: () => void
  onCreate: (opts: { name: string; branchId?: string; newBranchName?: string }) => void
}) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'existing' | 'new'>(branches.length > 0 ? 'existing' : 'new')
  const [branchId, setBranchId] = useState(branches[0]?.id || '')
  const [newBranchName, setNewBranchName] = useState('')

  const canSubmit = mode === 'existing' ? !!branchId : !!newBranchName.trim()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#1e3a5f] bg-[#0d1b2a] p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">New presentation</h3>
          <button onClick={onClose} className="text-[#64748B] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block text-xs text-[#94a3b8] mb-1.5">Presentation name</label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Untitled Presentation"
          className="w-full bg-[#060d1a] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-violet-500 mb-4"
        />

        <label className="block text-xs text-[#94a3b8] mb-1.5">Knowledge & design system</label>
        <div className="space-y-2 mb-4">
          <button
            type="button"
            onClick={() => setMode('existing')}
            disabled={branches.length === 0}
            className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-40 ${
              mode === 'existing'
                ? 'border-violet-500 bg-violet-600/10'
                : 'border-[#1e3a5f] hover:border-[#2a4a6f]'
            }`}
          >
            <div className="flex items-center gap-2 text-sm text-white">
              <GitBranch className="w-4 h-4 text-violet-400" /> Join an existing hub
            </div>
            <p className="text-[11px] text-[#64748B] mt-1 ml-6">
              Shares the hub&apos;s knowledge layers and design system.
            </p>
            {mode === 'existing' && branches.length > 0 && (
              <select
                value={branchId}
                onChange={e => setBranchId(e.target.value)}
                onClick={e => e.stopPropagation()}
                className="mt-2 ml-6 w-[calc(100%-1.5rem)] bg-[#060d1a] border border-[#1e3a5f] rounded px-2 py-1.5 text-sm text-white outline-none focus:border-violet-500"
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.presentationCount})
                  </option>
                ))}
              </select>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMode('new')}
            className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
              mode === 'new'
                ? 'border-violet-500 bg-violet-600/10'
                : 'border-[#1e3a5f] hover:border-[#2a4a6f]'
            }`}
          >
            <div className="flex items-center gap-2 text-sm text-white">
              <Plus className="w-4 h-4 text-violet-400" /> Create a new hub
            </div>
            <p className="text-[11px] text-[#64748B] mt-1 ml-6">
              A fresh shared workspace with its own knowledge and design system.
            </p>
            {mode === 'new' && (
              <input
                autoFocus
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                onClick={e => e.stopPropagation()}
                placeholder="New hub name"
                className="mt-2 ml-6 w-[calc(100%-1.5rem)] bg-[#060d1a] border border-[#1e3a5f] rounded px-2 py-1.5 text-sm text-white outline-none focus:border-violet-500"
              />
            )}
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg text-sm text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f]/40 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={() =>
              onCreate({
                name: name.trim(),
                branchId: mode === 'existing' ? branchId : undefined,
                newBranchName: mode === 'new' ? newBranchName.trim() : undefined,
              })
            }
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
