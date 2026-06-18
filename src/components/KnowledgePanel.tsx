'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Brain, Palette, BookOpen, Users, Database,
  Plus, Pencil, Trash2, X, Check, FileText, Bot, PenLine, Upload, Paperclip, Loader2,
  Network, FolderOpen, Sparkles, Link2,
} from 'lucide-react'
import type { KnowledgeLayer, KnowledgeLayerType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import ExtractionProgressBar, { parseBatchProgress } from '@/components/knowledge/ExtractionProgressBar'
import KnowledgeGraphViz from '@/components/knowledge/KnowledgeGraphViz'
import { KB_TEXT_LAYER_TYPES, TEXT_LAYER_MAX_CHARS } from '@/lib/knowledge'
import { fileTypeFromName, parseDocumentToText } from '@/lib/parseDocumentClient'

type PanelTab = 'layers' | 'sources' | 'graph'

async function readJsonResponse<T extends Record<string, unknown>>(
  res: Response
): Promise<T> {
  const text = await res.text()
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    if (res.status === 413 || /^Request Entity/i.test(text)) {
      throw new Error(
        'File is too large to upload as a raw document. Use a smaller file or export as .txt/.md.'
      )
    }
    if (res.status === 504 || /FUNCTION_INVOCATION_TIMEOUT|timed out/i.test(text)) {
      throw new Error('Mapping timed out — try again; large decks map one slide at a time.')
    }
    throw new Error(text.slice(0, 240) || `Request failed (HTTP ${res.status})`)
  }
}

type SourceDocument = {
  id: string
  title: string
  fileType: string
  status: string
  error?: string | null
  createdAt: number
}

type GraphNodeRow = {
  id: string
  type: string
  name: string
  description?: string | null
  status: string
  confidence: number
  sourceDocumentId?: string | null
  properties?: Record<string, unknown>
}

type DeckMappingRow = {
  edgeType: string
  slideId: string
  elementId: string
  elementName: string
  knowledgeNodeId: string
  knowledgeName: string
  knowledgeType: string
  confidence: number
  evidenceText?: string | null
}

type DeckMappingSummary = {
  presentationId: string
  slideCount?: number
  elementCount?: number
  mappingCount: number
  mappings: DeckMappingRow[]
  slideTopics?: { slideId: string; slideName: string; topicName: string; confidence: number }[]
}

type GraphEdgeRow = {
  id: string
  fromNodeId: string
  toNodeId: string
  type: string
  evidenceText?: string | null
}

interface Props {
  layers: KnowledgeLayer[]
  onChange: (layers: KnowledgeLayer[]) => void
  onClose: () => void
  branchId?: string | null
  hubName?: string | null
  presentationId?: string | null
  presentationName?: string | null
  readOnly?: boolean
  /** Which tab to open on — defaults to Sources when a hub is scoped. */
  initialTab?: PanelTab
}

type LayerMeta = {
  label: string
  Icon: React.ComponentType<{ className?: string }>
  accentClass: string
  accentHex: string
  placeholder: string
}

const LAYER_META: Record<KnowledgeLayerType, LayerMeta> = {
  style: {
    label: 'Style System',
    Icon: Palette,
    accentClass: 'text-amber-400',
    accentHex: '#F59E0B',
    placeholder: 'Define colors, fonts, layout rules…\ne.g. "Use #0D1B2A for backgrounds. Gold #F59E0B for headlines."',
  },
  terminology: {
    label: 'Terminology',
    Icon: BookOpen,
    accentClass: 'text-blue-400',
    accentHex: '#60A5FA',
    placeholder: 'Key terms, acronyms, product names…\ne.g. "NOP = Net Open Position. Q3 FY26 = Jul–Sep 2026."',
  },
  stakeholder: {
    label: 'Audience & Tone',
    Icon: Users,
    accentClass: 'text-teal-400',
    accentHex: '#2DD4BF',
    placeholder: 'Target audience, tone, reporting context…\ne.g. "CFO and board. Formal tone. Focus on Q3 2026 metrics."',
  },
  workspace: {
    label: 'Workspace Intelligence',
    Icon: Brain,
    accentClass: 'text-violet-400',
    accentHex: '#A78BFA',
    placeholder: 'Recurring patterns, rejected patterns, density preferences…',
  },
  custom: {
    label: 'Other Facts',
    Icon: Database,
    accentClass: 'text-green-400',
    accentHex: '#4ADE80',
    placeholder: 'Company, department, reporting period, general constraints…\ne.g. "Firewallets B2B unit. Reporting period: Q1 2026. EU entity."',
  },
}

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  template: <><FileText className="w-2.5 h-2.5" /><span>from template</span></>,
  inferred: <><Bot className="w-2.5 h-2.5" /><span>inferred</span></>,
  manual:   <><PenLine className="w-2.5 h-2.5" /><span>manual</span></>,
  document: <><Paperclip className="w-2.5 h-2.5" /><span>from document</span></>,
}

const UPLOAD_ACCEPT =
  '.pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.html,.htm,.xml,.log,.rst,.ini,.toml,text/*'

const STATUS_COLORS: Record<string, string> = {
  registered: 'bg-slate-500/20 text-slate-300',
  parsed: 'bg-blue-500/20 text-blue-300',
  extracted: 'bg-green-500/20 text-green-300',
  extracting: 'bg-violet-500/20 text-violet-300',
  failed: 'bg-red-500/20 text-red-300',
  candidate: 'bg-amber-500/20 text-amber-300',
}

export default function KnowledgePanel({
  layers,
  onChange,
  onClose,
  branchId,
  hubName,
  presentationId,
  presentationName,
  readOnly = false,
  initialTab,
}: Props) {
  const [activeTab, setActiveTab] = useState<PanelTab>(
    initialTab ?? (branchId ? 'sources' : 'layers')
  )
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editName, setEditName]     = useState('')
  const [addingType, setAddingType] = useState<KnowledgeLayerType | null>(null)
  const [newName, setNewName]       = useState('')
  const [newContent, setNewContent] = useState('')

  const sourceInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadError, setUploadError]     = useState<string | null>(null)

  const [sources, setSources] = useState<SourceDocument[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourceUploading, setSourceUploading] = useState(false)
  const [ingestingId, setIngestingId] = useState<string | null>(null)
  const [ingestProgress, setIngestProgress] = useState<{
    batch: number
    total: number
    knowledgeNodes: number
    structureNodes: number
  } | null>(null)
  const [batchInFlight, setBatchInFlight] = useState(false)

  const [graphNodes, setGraphNodes] = useState<GraphNodeRow[]>([])
  const [graphEdges, setGraphEdges] = useState<GraphEdgeRow[]>([])
  const [graphLoading, setGraphLoading] = useState(false)
  const [deckMapping, setDeckMapping] = useState<DeckMappingSummary | null>(null)
  const [deckMappingLoading, setDeckMappingLoading] = useState(false)
  const [deckMappingRunning, setDeckMappingRunning] = useState(false)
  const [deckMapProgress, setDeckMapProgress] = useState<{
    slide: number
    total: number
    mappingCount: number
  } | null>(null)

  const loadSources = useCallback(async () => {
    if (!branchId) return
    setSourcesLoading(true)
    try {
      const res = await fetch(`/api/graph/sources?branchId=${branchId}`)
      if (res.ok) setSources(await res.json())
    } finally {
      setSourcesLoading(false)
    }
  }, [branchId])

  const loadGraph = useCallback(async () => {
    if (!branchId) return
    setGraphLoading(true)
    try {
      const [nodesRes, edgesRes] = await Promise.all([
        fetch(`/api/graph/nodes?branchId=${branchId}`),
        fetch(`/api/graph/edges?branchId=${branchId}`),
      ])
      if (nodesRes.ok) setGraphNodes(await nodesRes.json())
      if (edgesRes.ok) setGraphEdges(await edgesRes.json())
    } finally {
      setGraphLoading(false)
    }
  }, [branchId])

  const loadDeckMapping = useCallback(async () => {
    if (!presentationId) {
      setDeckMapping(null)
      return
    }
    setDeckMappingLoading(true)
    try {
      const res = await fetch(`/api/graph/map/deck/${presentationId}`)
      if (res.ok) setDeckMapping(await res.json())
    } finally {
      setDeckMappingLoading(false)
    }
  }, [presentationId])

  const runDeckMapping = async () => {
    if (!presentationId || readOnly) return
    setDeckMappingRunning(true)
    setUploadError(null)
    setDeckMapProgress(null)
    const MAP_SLIDE_PAUSE_MS = 1500

    const postMap = async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/graph/map/deck/${presentationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await readJsonResponse<{ error?: string } & Record<string, unknown>>(res)
      if (!res.ok) throw new Error(data.error || 'Deck mapping failed')
      return data
    }

    try {
      const prep = await postMap({ phase: 'prepare' })
      const totalSlides = Number(prep.totalSlides ?? 0)
      if (totalSlides < 1) throw new Error('Deck has no slides to map')
      if (Number(prep.knowledgeCount ?? 0) < 1) {
        throw new Error('No extracted knowledge in this hub — run Extract on documents first.')
      }

      setDeckMapProgress({ slide: 0, total: totalSlides, mappingCount: 0 })
      await loadGraph()
      setActiveTab('graph')

      for (let i = 0; i < totalSlides; i++) {
        if (i > 0) {
          setDeckMapProgress(prev => (prev ? { ...prev, slide: i } : prev))
          await new Promise(r => setTimeout(r, MAP_SLIDE_PAUSE_MS))
        }
        const batch = await postMap({ phase: 'batch', slideIndex: i })
        setDeckMapProgress({
          slide: i + 1,
          total: totalSlides,
          mappingCount: Number(batch.mappingCount ?? 0),
        })
        await loadGraph()
      }

      await postMap({ phase: 'finalize' })
      await loadDeckMapping()
      await loadGraph()
      setActiveTab('graph')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Deck mapping failed')
      await loadDeckMapping()
      await loadGraph()
    } finally {
      setDeckMappingRunning(false)
      setDeckMapProgress(null)
    }
  }

  useEffect(() => {
    if (branchId) setActiveTab(initialTab ?? 'sources')
  }, [branchId, initialTab])

  useEffect(() => {
    if (!branchId) return
    void loadSources()
    void loadGraph()
    void loadDeckMapping()
  }, [branchId, loadSources, loadGraph, loadDeckMapping])

  useEffect(() => {
    if (activeTab === 'sources') void loadSources()
    if (activeTab === 'graph') {
      void loadGraph()
      void loadDeckMapping()
    }
  }, [activeTab, loadSources, loadGraph, loadDeckMapping])

  const handleSourceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !branchId) return
    setSourceUploading(true)
    setUploadError(null)
    try {
      const parsed = await parseDocumentToText(file)
      const fileType = fileTypeFromName(file.name)
      if (fileType === 'unknown') {
        throw new Error(
          'Unsupported file type. Use PDF, DOCX, TXT, MD, CSV, JSON, YAML, HTML or XML.'
        )
      }
      const res = await fetch('/api/graph/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          title: parsed.name,
          fileType,
          text: parsed.text,
          originalFilename: file.name,
        }),
      })
      const data = await readJsonResponse<SourceDocument & { error?: string }>(res)
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setSources(prev => [data, ...prev])
      setActiveTab('sources')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setSourceUploading(false)
    }
  }

  const runIngest = async (sourceId: string) => {
    setIngestingId(sourceId)
    setUploadError(null)
    setIngestProgress(null)
    setBatchInFlight(false)
    const BATCH_PAUSE_MS = 7000

    try {
      setBatchInFlight(true)
      const prepRes = await fetch(`/api/graph/ingest/${sourceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'prepare' }),
      })
      const prep = await readJsonResponse<{ error?: string; totalBatches?: number; structureNodeCount?: number }>(prepRes)
      if (!prepRes.ok) throw new Error(prep.error || 'Prepare failed')
      const totalBatches = prep.totalBatches ?? 0
      if (totalBatches < 1) throw new Error('Prepare returned no extraction batches')

      setBatchInFlight(false)
      setIngestProgress({
        batch: 0,
        total: totalBatches,
        knowledgeNodes: 0,
        structureNodes: prep.structureNodeCount ?? 0,
      })
      await loadGraph()
      setActiveTab('graph')

      for (let i = 0; i < totalBatches; i++) {
        if (i > 0) {
          setIngestProgress(prev => prev ? { ...prev, batch: i } : prev)
          await new Promise(r => setTimeout(r, BATCH_PAUSE_MS))
        }

        setBatchInFlight(true)
        const batchRes = await fetch(`/api/graph/ingest/${sourceId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase: 'batch', batchIndex: i }),
        })
        const batch = await readJsonResponse<{
          error?: string
          totalBatches?: number
          knowledgeNodeCount?: number
          done?: boolean
        }>(batchRes)
        if (!batchRes.ok) throw new Error(batch.error || 'Extraction failed')

        setBatchInFlight(false)
        setIngestProgress({
          batch: i + 1,
          total: batch.totalBatches ?? totalBatches,
          knowledgeNodes: batch.knowledgeNodeCount ?? 0,
          structureNodes: prep.structureNodeCount ?? 0,
        })
        await loadGraph()
        await loadSources()

        if (batch.done) break
      }

      setActiveTab('graph')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Extraction failed')
      await loadSources()
      await loadGraph()
    } finally {
      setIngestingId(null)
      setIngestProgress(null)
      setBatchInFlight(false)
    }
  }

  const removeSource = async (sourceId: string) => {
    setUploadError(null)
    try {
      const res = await fetch(`/api/graph/sources?sourceId=${sourceId}`, { method: 'DELETE' })
      const data = await readJsonResponse<{ error?: string }>(res)
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      setSources(prev => prev.filter(s => s.id !== sourceId))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const toggle = (id: string) =>
    onChange(layers.map(l => l.id === id ? { ...l, enabled: !l.enabled } : l))

  const remove = (id: string) =>
    onChange(layers.filter(l => l.id !== id))

  const startEdit = (layer: KnowledgeLayer) => {
    setEditingId(layer.id)
    setEditContent(layer.content)
    setEditName(layer.name)
  }

  const saveEdit = () => {
    if (!editingId) return
    if (editContent.length > TEXT_LAYER_MAX_CHARS) {
      setUploadError(`Text layer limit is ${TEXT_LAYER_MAX_CHARS} characters (~300 tokens). Shorten or move long docs to Documents tab.`)
      return
    }
    onChange(layers.map(l =>
      l.id === editingId ? { ...l, content: editContent, name: editName, updatedAt: Date.now() } : l
    ))
    setEditingId(null)
  }

  const addLayer = () => {
    if (!addingType || !newName.trim() || !newContent.trim()) return
    if (newContent.length > TEXT_LAYER_MAX_CHARS) {
      setUploadError(`Text layer limit is ${TEXT_LAYER_MAX_CHARS} characters (~300 tokens).`)
      return
    }
    const layer: KnowledgeLayer = {
      id: `${addingType}-${Date.now()}`,
      type: addingType,
      name: newName.trim(),
      content: newContent.trim(),
      enabled: true,
      source: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    onChange([...layers, layer])
    setAddingType(null)
    setNewName('')
    setNewContent('')
  }

  const grouped = KB_TEXT_LAYER_TYPES.map(type => ({
    type,
    meta: LAYER_META[type],
    items: layers.filter(l => l.type === type),
  }))

  const kbTextLayers = layers.filter(l => KB_TEXT_LAYER_TYPES.includes(l.type))

  const graphKnowledge = graphNodes.filter(n =>
    n.type === 'Claim' || n.type === 'Metric' || n.type === 'Topic'
  )
  const graphStructureCount = graphNodes.filter(n =>
    n.type === 'DocumentChunk' || n.type === 'SourceDocument'
  ).length
  const extractedSourceCount = sources.filter(s => s.status === 'extracted').length
  const canRunDeckMap = graphKnowledge.length > 0 || extractedSourceCount > 0

  const deckMappingPanel = branchId ? (
    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-cyan-200 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" />
            Deck ↔ Knowledge links
          </p>
          {presentationId ? (
            <p className="text-[10px] text-cyan-300/70 mt-1">
              <strong className="text-cyan-100">{presentationName || 'Current deck'}</strong> — connect slide text to claims & metrics from your documents.
            </p>
          ) : (
            <p className="text-[10px] text-amber-300/90 mt-1">
              Open a <strong className="text-amber-200">deck in this hub</strong> (from the editor), then reopen Knowledge Manager to see <strong className="text-amber-200">Map deck</strong>.
            </p>
          )}
        </div>
        {presentationId && !readOnly && (
          <Button
            variant="default"
            size="sm"
            className="bg-cyan-600 hover:bg-cyan-500 text-white flex-shrink-0"
            disabled={deckMappingRunning || !canRunDeckMap}
            onClick={() => void runDeckMapping()}
          >
            {deckMappingRunning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Link2 className="w-3 h-3" />
            )}
            Map deck
          </Button>
        )}
      </div>
      {!presentationId && (
        <p className="text-[10px] text-[#64748B]">
          Hub-only view: mapping needs an open presentation. The button appears on the{' '}
          <button type="button" onClick={() => setActiveTab('graph')} className="text-cyan-400 underline">
            Knowledge Graph
          </button>{' '}
          tab once a deck is open.
        </p>
      )}
      {presentationId && !canRunDeckMap && (
        <p className="text-[10px] text-amber-300">
          Extract knowledge from documents first ({' '}
          <button type="button" onClick={() => setActiveTab('sources')} className="underline">
            Documents
          </button>{' '}
          tab → Extract).
        </p>
      )}
      {deckMapProgress && (
        <div className="space-y-1.5">
          <div className="h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
            <div
              className="h-full bg-cyan-500 transition-all duration-300"
              style={{
                width: `${deckMapProgress.total ? (deckMapProgress.slide / deckMapProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-[10px] text-cyan-300/80 tabular-nums">
            Mapping slide {deckMapProgress.slide}/{deckMapProgress.total}
            {deckMapProgress.mappingCount > 0
              ? ` · ${deckMapProgress.mappingCount} link${deckMapProgress.mappingCount === 1 ? '' : 's'} so far`
              : ''}
          </p>
        </div>
      )}
      {presentationId && deckMappingLoading ? (
        <p className="text-[10px] text-[#64748B] flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading deck links…
        </p>
      ) : presentationId && deckMapping && deckMapping.mappingCount > 0 ? (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          <p className="text-[10px] text-cyan-300/80">
            {deckMapping.mappingCount} element link{deckMapping.mappingCount === 1 ? '' : 's'}
            {deckMapping.slideTopics?.length ? ` · ${deckMapping.slideTopics.length} slide topics` : ''}
          </p>
          {deckMapping.mappings.slice(0, 12).map((m, i) => (
            <div key={`${m.elementId}-${i}`} className="text-[10px] border-l-2 border-cyan-500/40 pl-2">
              <span className="text-white">{m.elementName}</span>
              <span className="text-[#64748B]"> → </span>
              <span className="text-cyan-300">{m.knowledgeName}</span>
              <span className="text-[#475569]"> ({m.knowledgeType})</span>
            </div>
          ))}
          {deckMapping.mappingCount > 12 && (
            <p className="text-[9px] text-[#475569]">+{deckMapping.mappingCount - 12} more links</p>
          )}
        </div>
      ) : presentationId && canRunDeckMap ? (
        <p className="text-[10px] text-[#64748B]">
          No links yet — click <strong className="text-cyan-300">Map deck</strong> above.
        </p>
      ) : null}
    </div>
  ) : null

  const tabs: { id: PanelTab; label: string; Icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: 'sources', label: 'Documents', Icon: FolderOpen, badge: sources.length || undefined },
    { id: 'graph', label: 'Knowledge Graph', Icon: Network, badge: graphKnowledge.length || undefined },
    { id: 'layers', label: 'KB Text', Icon: Brain, badge: kbTextLayers.length || undefined },
  ]

  const evidenceForNode = (nodeId: string) => {
    const edge = graphEdges.find(e => e.fromNodeId === nodeId && e.type === 'SUPPORTED_BY')
    return edge?.evidenceText || null
  }

  const nodesBySource = sources.map(src => ({
    source: src,
    nodes: graphKnowledge.filter(n => n.sourceDocumentId === src.id),
  })).filter(g => g.nodes.length > 0)

  const orphanNodes = graphKnowledge.filter(
    n => !n.sourceDocumentId || !sources.some(s => s.id === n.sourceDocumentId)
  )

  const activeExtractSource = ingestingId ? sources.find(s => s.id === ingestingId) : null
  const stuckExtractProgress = activeExtractSource?.status === 'extracting'
    ? parseBatchProgress(activeExtractSource.error)
    : null

  const progressProps = ingestingId && ingestProgress
    ? {
        completedBatches: ingestProgress.batch,
        totalBatches: ingestProgress.total,
        inFlight: batchInFlight,
        preparing: false,
      }
    : ingestingId && !ingestProgress
      ? { completedBatches: 0, totalBatches: 1, inFlight: batchInFlight, preparing: true }
      : stuckExtractProgress
        ? {
            completedBatches: stuckExtractProgress.completed,
            totalBatches: stuckExtractProgress.total,
            inFlight: true,
            preparing: false,
          }
        : null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/60 backdrop-blur-sm">
      <div className="w-[820px] max-h-[88vh] bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl flex flex-col overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e3a5f] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/30">
              <Brain className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <p className="text-lg font-bold text-white truncate">
                {hubName || 'Knowledge Hub'}
              </p>
              <p className="text-xs text-[#64748B] mt-0.5">
                {branchId ? (
                  <>
                    <span className="text-violet-400 font-semibold">{sources.length}</span> documents ·{' '}
                    <span className="text-violet-400 font-semibold">{graphKnowledge.length}</span> graph nodes ·{' '}
                    <span className="text-violet-400 font-semibold">{kbTextLayers.filter(l => l.enabled).length}</span> KB text layers
                  </>
                ) : (
                  <>Select a hub — open from the home screen or a deck in this branch</>
                )}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex gap-2 px-5 pt-3 border-b border-[#1e3a5f] flex-shrink-0 bg-[#0a1220]/50">
          {tabs.map(({ id, label, Icon, badge }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-lg border-b-2 transition-colors',
                activeTab === id
                  ? 'text-white border-violet-400 bg-violet-500/15'
                  : 'text-[#64748B] border-transparent hover:text-[#CBD5E1] hover:bg-[#112236]'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
              {badge !== undefined && badge > 0 && (
                <span className={cn(
                  'min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center',
                  activeTab === id ? 'bg-violet-500 text-white' : 'bg-[#1e3a5f] text-[#94A3B8]'
                )}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <input ref={sourceInputRef} type="file" accept={UPLOAD_ACCEPT} className="hidden" onChange={handleSourceUpload} />

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {!branchId && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              Document uploads and the knowledge graph are scoped to a <strong>Knowledge Hub</strong>.
              Open this panel from the hub card on the home screen, or open a deck that belongs to a hub.
            </div>
          )}
          {progressProps && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-xs text-blue-200">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-blue-400" />
                <span>
                  Extracting knowledge
                  {ingestProgress && ingestProgress.knowledgeNodes > 0 && (
                    <> · {ingestProgress.knowledgeNodes} nodes found</>
                  )}
                </span>
              </div>
              <ExtractionProgressBar {...progressProps} />
              <p className="text-[10px] text-blue-300/70">
                Progress = batches completed ÷ total batches. Graph updates after each batch.
              </p>
            </div>
          )}
          {uploadError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              <X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span className="flex-1">{uploadError}</span>
              <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-200">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {activeTab === 'layers' && (
            <>
              <div className="rounded-lg border border-[#1e3a5f] bg-[#112236] px-4 py-3 space-y-1">
                <p className="text-xs font-semibold text-white">KB text layers — indirect context for Claude</p>
                <p className="text-[11px] text-[#94A3B8] leading-relaxed">
                  Short notes only: target audience, reporting period, terminology, department or company facts.
                  Max <strong className="text-white">{TEXT_LAYER_MAX_CHARS}</strong> characters per layer (~300 tokens).
                  These are <strong className="text-white">not</strong> converted to the knowledge graph — upload full documents under{' '}
                  <button type="button" onClick={() => setActiveTab('sources')} className="text-violet-400 underline">Documents</button>.
                </p>
              </div>
              {grouped.map(({ type, meta, items }) => {
                const { Icon, label, accentClass, accentHex, placeholder } = meta
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('w-3.5 h-3.5', accentClass)} />
                        <span className="text-[11px] font-bold tracking-wider uppercase" style={{ color: accentHex }}>
                          {label}
                        </span>
                        <Badge variant="muted">{items.length}</Badge>
                      </div>
                      {!readOnly && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setAddingType(type); setNewName(''); setNewContent('') }}
                        >
                          <Plus className="w-3 h-3" />
                          Add
                        </Button>
                      )}
                    </div>

                    {items.map(layer => (
                      <div
                        key={layer.id}
                        className={cn(
                          'mb-2 rounded-lg border transition-all',
                          layer.enabled
                            ? 'border-[#1e3a5f] bg-[#112236]'
                            : 'border-[#0f1e30] bg-[#0a1220] opacity-50'
                        )}
                      >
                        {editingId === layer.id ? (
                          <div className="p-3 space-y-2">
                            <input
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="w-full bg-[#162C44] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#60a5fa]"
                              placeholder="Layer name"
                            />
                            <textarea
                              value={editContent}
                              onChange={e => setEditContent(e.target.value.slice(0, TEXT_LAYER_MAX_CHARS + 500))}
                              rows={6}
                              className="w-full bg-[#162C44] border border-[#1e3a5f] rounded px-2 py-1.5 text-xs text-[#CBD5E1] outline-none focus:border-[#60a5fa] resize-none font-mono"
                            />
                            <p className={cn('text-[10px] text-right', editContent.length > TEXT_LAYER_MAX_CHARS ? 'text-red-400' : 'text-[#475569]')}>
                              {editContent.length}/{TEXT_LAYER_MAX_CHARS} chars
                            </p>
                            <div className="flex gap-2 justify-end">
                              <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                <X className="w-3 h-3" /> Cancel
                              </Button>
                              <Button variant="default" size="sm" onClick={saveEdit}>
                                <Check className="w-3 h-3" /> Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3 p-3">
                            <Switch
                              checked={layer.enabled}
                              onCheckedChange={() => toggle(layer.id)}
                              disabled={readOnly}
                              className="mt-0.5 flex-shrink-0"
                              style={layer.enabled ? { backgroundColor: accentHex } : {}}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-white truncate">{layer.name}</p>
                              <p className="text-[10px] text-[#475569] mt-0.5 line-clamp-2 font-mono leading-relaxed">
                                {layer.content.slice(0, 120)}{layer.content.length > 120 ? '…' : ''}
                              </p>
                              {layer.source === 'document' && (
                                <span className="inline-flex items-center gap-1 text-[9px] text-amber-500/90 mt-1">
                                  Legacy full-doc layer — prefer Documents tab for new uploads
                                </span>
                              )}
                              {layer.content.length > TEXT_LAYER_MAX_CHARS && (
                                <span className="inline-flex items-center gap-1 text-[9px] text-red-400 mt-1">
                                  Over limit — Claude will truncate to {TEXT_LAYER_MAX_CHARS} chars
                                </span>
                              )}
                            </div>
                            {!readOnly && (
                              <div className="flex gap-0.5 flex-shrink-0">
                                <Button variant="ghost" size="icon" onClick={() => startEdit(layer)} title="Edit">
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => remove(layer.id)} title="Delete"
                                  className="hover:text-[#F87171]">
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {addingType === type && !readOnly && (
                      <div className="mb-2 p-3 rounded-lg border border-dashed space-y-2" style={{ borderColor: accentHex + '50' }}>
                        <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                          className="w-full bg-[#112236] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#60a5fa]"
                          placeholder="Layer name" />
                        <textarea value={newContent} onChange={e => setNewContent(e.target.value.slice(0, TEXT_LAYER_MAX_CHARS + 500))} rows={4}
                          className="w-full bg-[#112236] border border-[#1e3a5f] rounded px-2 py-1.5 text-xs text-[#CBD5E1] outline-none focus:border-[#60a5fa] resize-none font-mono"
                          placeholder={placeholder} />
                        <p className={cn('text-[10px] text-right', newContent.length > TEXT_LAYER_MAX_CHARS ? 'text-red-400' : 'text-[#475569]')}>
                          {newContent.length}/{TEXT_LAYER_MAX_CHARS} chars
                        </p>
                        <div className="flex gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => setAddingType(null)}>
                            <X className="w-3 h-3" /> Cancel
                          </Button>
                          <Button size="sm" onClick={addLayer}
                            disabled={!newName.trim() || !newContent.trim() || newContent.length > TEXT_LAYER_MAX_CHARS}
                            className="text-[#0d1b2a] font-bold" style={{ backgroundColor: accentHex }}>
                            <Plus className="w-3 h-3" /> Add Layer
                          </Button>
                        </div>
                      </div>
                    )}

                    {items.length === 0 && addingType !== type && (
                      <p className="text-[10px] text-[#334155] italic pl-1 pb-1">No layers yet — click Add to create one</p>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {activeTab === 'sources' && (
            <>
              {deckMappingPanel && (
                <div className="mb-4">{deckMappingPanel}</div>
              )}
              {!branchId ? null : (
                <>
                  <div className="rounded-lg border border-[#1e3a5f] bg-[#112236] px-4 py-3">
                    <p className="text-xs text-[#94A3B8] leading-relaxed">
                      Upload business documents here. After upload, click <strong className="text-white">Extract</strong> to
                      build the knowledge graph (claims, metrics, topics). View results in the{' '}
                      <button type="button" onClick={() => setActiveTab('graph')} className="text-violet-400 underline">
                        Knowledge Graph
                      </button>{' '}
                      tab.
                    </p>
                  </div>
                  {!readOnly && (
                    <div className="flex justify-end">
                      <Button variant="default" size="sm" disabled={sourceUploading}
                        onClick={() => sourceInputRef.current?.click()}>
                        {sourceUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                        Upload document
                      </Button>
                    </div>
                  )}
                  {sourcesLoading ? (
                    <div className="flex items-center gap-2 text-xs text-[#64748B]">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading sources…
                    </div>
                  ) : sources.length === 0 ? (
                    <p className="text-xs text-[#64748B] italic">No sources yet. Upload a PDF, DOCX, or text file to begin.</p>
                  ) : (
                    sources.map(src => (
                      <div key={src.id} className="rounded-lg border border-[#1e3a5f] bg-[#112236] p-3 mb-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">{src.title}</p>
                            <p className="text-[10px] text-[#475569] mt-0.5 uppercase">{src.fileType}</p>
                            {src.error && src.status !== 'extracting' && (
                              <p className="text-[10px] text-red-400 mt-1">{src.error}</p>
                            )}
                            {src.status === 'extracting' && src.error && (
                              <p className="text-[10px] text-violet-300 mt-1">{src.error}</p>
                            )}
                            {src.status === 'extracting' && (() => {
                              const bp = parseBatchProgress(src.error)
                              if (!bp || ingestingId === src.id) return null
                              return (
                                <ExtractionProgressBar
                                  size="sm"
                                  completedBatches={bp.completed}
                                  totalBatches={bp.total}
                                  inFlight
                                  className="mt-2 max-w-xs"
                                />
                              )
                            })()}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={cn('text-[9px] font-bold uppercase px-2 py-0.5 rounded', STATUS_COLORS[src.status] || STATUS_COLORS.registered)}>
                              {src.status}
                            </span>
                            {!readOnly && src.status === 'failed' && (
                              <Button variant="outline" size="sm" onClick={() => removeSource(src.id)}>
                                <Trash2 className="w-3 h-3" />
                                Remove
                              </Button>
                            )}
                            {!readOnly && (src.status === 'parsed' || src.status === 'extracted' || src.status === 'extracting') && (
                              <Button variant="outline" size="sm" disabled={ingestingId !== null}
                                onClick={() => runIngest(src.id)}>
                                {ingestingId === src.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Sparkles className="w-3 h-3" />
                                )}
                                {src.status === 'extracted' ? 'Re-extract' : src.status === 'extracting' ? 'Retry' : 'Extract'}
                              </Button>
                            )}
                            {src.status === 'extracting' && ingestingId !== src.id && (
                              <span className="text-[9px] text-violet-300 flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                in progress
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </>
          )}

          {activeTab === 'graph' && (
            <>
              {!branchId ? null : graphLoading ? (
                <div className="flex items-center gap-2 text-xs text-[#64748B]">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading graph…
                </div>
              ) : (
                <>
                  {deckMappingPanel && (
                    <div className="mb-4">{deckMappingPanel}</div>
                  )}
                  {graphKnowledge.length === 0 ? (
                <div className="space-y-3">
                  {(ingestingId || sources.some(s => s.status === 'extracting')) ? (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2 text-xs text-blue-200">
                          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-blue-400" />
                          <span>Extraction in progress</span>
                        </div>
                        {progressProps ? (
                          <ExtractionProgressBar {...progressProps} />
                        ) : (
                          <ExtractionProgressBar completedBatches={0} totalBatches={1} preparing />
                        )}
                        <p className="text-[10px] text-blue-300/70">
                          {graphStructureCount > 0 && (
                            <>{graphStructureCount} structure nodes created. </>
                          )}
                          Claims, metrics, and topics appear as batches complete.
                        </p>
                      </div>
                      {(graphStructureCount > 0) && (
                        <KnowledgeGraphViz nodes={graphNodes} edges={graphEdges} />
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[#94A3B8]">
                      No graph nodes yet. Upload a document in the{' '}
                      <button type="button" onClick={() => setActiveTab('sources')} className="text-violet-400 underline">
                        Documents
                      </button>{' '}
                      tab, then run <strong className="text-white">Extract</strong>.
                    </p>
                  )}
                  {sources.length > 0 && (
                    <div className="rounded-lg border border-[#1e3a5f] bg-[#112236] p-3 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Your documents</p>
                      {sources.map(src => (
                        <div key={src.id} className="flex items-center justify-between text-xs">
                          <span className="text-white truncate">{src.title}</span>
                          <span className={cn('text-[9px] font-bold uppercase px-2 py-0.5 rounded ml-2 flex-shrink-0', STATUS_COLORS[src.status] || STATUS_COLORS.registered)}>
                            {src.status}
                          </span>
                        </div>
                      ))}
                      {extractedSourceCount === 0 && sources.some(s => s.status === 'parsed') && (
                        <p className="text-[10px] text-violet-300">→ Go to Documents and click Extract on a parsed file.</p>
                      )}
                    </div>
                  )}
                </div>
                  ) : (
                <>
                  {(graphKnowledge.length > 0 || graphStructureCount > 0) && (
                    <KnowledgeGraphViz nodes={graphNodes} edges={graphEdges} />
                  )}

                  {progressProps && graphKnowledge.length === 0 && (
                    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3 space-y-2">
                      <p className="text-xs text-blue-200">
                        {graphStructureCount > 0
                          ? `${graphStructureCount} document chunks ready — waiting for first knowledge batch…`
                          : 'Preparing document…'}
                      </p>
                      <ExtractionProgressBar {...progressProps} />
                    </div>
                  )}

                  {[...nodesBySource, ...(orphanNodes.length ? [{ source: null, nodes: orphanNodes }] : [])].map(({ source, nodes }) => (
                    <div key={source?.id || 'orphan'} className="space-y-2">
                      {source && (
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">{source.title}</p>
                      )}
                      {(['Claim', 'Metric', 'Topic'] as const).map(nodeType => {
                        const typed = nodes.filter(n => n.type === nodeType)
                        if (!typed.length) return null
                        return (
                          <div key={nodeType} className="mb-3">
                            <p className="text-[11px] font-semibold text-violet-300 mb-1.5">{nodeType}s</p>
                            {typed.map(node => (
                              <div key={node.id} className="mb-2 rounded-lg border border-[#1e3a5f] bg-[#0a1220] p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs font-semibold text-white">{node.name}</p>
                                  <div className="flex gap-1 flex-shrink-0">
                                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded', STATUS_COLORS[node.status] || STATUS_COLORS.candidate)}>
                                      {node.status}
                                    </span>
                                    <span className="text-[9px] text-[#64748B]">{Math.round(node.confidence * 100)}%</span>
                                  </div>
                                </div>
                                {node.description && (
                                  <p className="text-[10px] text-[#94A3B8] mt-1">{node.description}</p>
                                )}
                                {evidenceForNode(node.id) && (
                                  <p className="text-[10px] text-[#475569] mt-1.5 font-mono line-clamp-2 border-l-2 border-violet-500/40 pl-2">
                                    {evidenceForNode(node.id)}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#1e3a5f] flex-shrink-0 flex justify-between items-center">
          <p className="text-[10px] text-[#334155]">
            {activeTab === 'sources'
              ? 'Step 1: Upload · Step 2: Extract · Step 3: View in Knowledge Graph tab.'
              : activeTab === 'graph'
                ? `${graphKnowledge.length} knowledge nodes (claims/metrics/topics) · ${graphNodes.length} total incl. chunks`
                : 'Short indirect context for Claude — not part of the knowledge graph.'}
          </p>
          <Button variant="default" size="md" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}
