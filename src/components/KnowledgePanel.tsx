'use client'

import { useRef, useState } from 'react'
import {
  Brain, Palette, BookOpen, Users, Lightbulb, Database,
  Plus, Pencil, Trash2, X, Check, FileText, Bot, PenLine, Upload, Paperclip, Loader2,
} from 'lucide-react'
import type { KnowledgeLayer, KnowledgeLayerType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { parseDocumentToText } from '@/lib/parseDocumentClient'

interface Props {
  layers: KnowledgeLayer[]
  onChange: (layers: KnowledgeLayer[]) => void
  onClose: () => void
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
    placeholder: 'Define key terms and abbreviations…\ne.g. "NOP = Net Open Position. FCY = Foreign Currency."',
  },
  stakeholder: {
    label: 'Stakeholder Profile',
    Icon: Users,
    accentClass: 'text-teal-400',
    accentHex: '#2DD4BF',
    placeholder: 'Audience, tone, communication preferences…\ne.g. "Senior executives. Direct, no jargon. Max 3 bullets per slide."',
  },
  workspace: {
    label: 'Workspace Intelligence',
    Icon: Brain,
    accentClass: 'text-violet-400',
    accentHex: '#A78BFA',
    placeholder: 'Recurring patterns, rejected patterns, density preferences…\ne.g. "Always include a ROOT CAUSE banner on problem slides."',
  },
  custom: {
    label: 'Knowledge Base',
    Icon: Database,
    accentClass: 'text-green-400',
    accentHex: '#4ADE80',
    placeholder: 'Any additional context for Claude…',
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

export default function KnowledgePanel({ layers, onChange, onClose }: Props) {
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editName, setEditName]     = useState('')
  const [addingType, setAddingType] = useState<KnowledgeLayerType | null>(null)
  const [newName, setNewName]       = useState('')
  const [newContent, setNewContent] = useState('')

  // Document upload → knowledge layer
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadTypeRef = useRef<KnowledgeLayerType>('custom')
  const [uploadingType, setUploadingType] = useState<KnowledgeLayerType | null>(null)
  const [uploadError, setUploadError]     = useState<string | null>(null)

  const triggerUpload = (type: KnowledgeLayerType) => {
    uploadTypeRef.current = type
    setUploadError(null)
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-uploading the same file
    if (!file) return
    const type = uploadTypeRef.current
    setUploadingType(type)
    setUploadError(null)
    try {
      // Parse in the browser so large files don't hit the serverless body-size
      // limit (which rejected big DOCX/PDF uploads with HTTP 413).
      const data = await parseDocumentToText(file)
      const layer: KnowledgeLayer = {
        id: `${type}-${Date.now()}`,
        type,
        name: data.name || file.name,
        content: data.text,
        enabled: true,
        source: 'document',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      onChange([...layers, layer])
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to parse document')
    } finally {
      setUploadingType(null)
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
    onChange(layers.map(l =>
      l.id === editingId ? { ...l, content: editContent, name: editName, updatedAt: Date.now() } : l
    ))
    setEditingId(null)
  }

  const addLayer = () => {
    if (!addingType || !newName.trim() || !newContent.trim()) return
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

  // 'style' is managed in the dedicated Design System panel, so it's hidden here.
  const grouped = (Object.keys(LAYER_META) as KnowledgeLayerType[])
    .filter(type => type !== 'style')
    .map(type => ({
      type,
      meta: LAYER_META[type],
      items: layers.filter(l => l.type === type),
    }))

  const enabledCount = layers.filter(l => l.enabled).length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/60 backdrop-blur-sm">
      <div className="w-[700px] max-h-[88vh] bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e3a5f] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/30">
              <Brain className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Knowledge Manager</p>
              <p className="text-xs text-[#64748B] mt-0.5">
                Context layers sent to Claude ·{' '}
                <span className="text-violet-400 font-semibold">{enabledCount}</span>
                <span className="text-[#334155]">/{layers.length} enabled</span>
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <input
          ref={fileInputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={handleFileSelected}
        />
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {uploadError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              <X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span className="flex-1">{uploadError}</span>
              <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-200">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {grouped.map(({ type, meta, items }) => {
            const { Icon, label, accentClass, accentHex, placeholder } = meta
            return (
              <div key={type}>
                {/* Section header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={cn('w-3.5 h-3.5', accentClass)} />
                    <span className="text-[11px] font-bold tracking-wider uppercase" style={{ color: accentHex }}>
                      {label}
                    </span>
                    <Badge variant="muted">{items.length}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => triggerUpload(type)}
                      disabled={uploadingType !== null}
                      title="Upload a document (PDF, DOCX, TXT, MD, CSV, JSON…)"
                    >
                      {uploadingType === type ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Upload className="w-3 h-3" />
                      )}
                      Upload
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setAddingType(type); setNewName(''); setNewContent('') }}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </Button>
                  </div>
                </div>

                {/* Existing layers */}
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
                          onChange={e => setEditContent(e.target.value)}
                          rows={6}
                          className="w-full bg-[#162C44] border border-[#1e3a5f] rounded px-2 py-1.5 text-xs text-[#CBD5E1] outline-none focus:border-[#60a5fa] resize-none font-mono"
                        />
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
                        {/* Toggle switch */}
                        <Switch
                          checked={layer.enabled}
                          onCheckedChange={() => toggle(layer.id)}
                          className="mt-0.5 flex-shrink-0"
                          style={layer.enabled ? { backgroundColor: accentHex } : {}}
                        />

                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{layer.name}</p>
                          <p className="text-[10px] text-[#475569] mt-0.5 line-clamp-2 font-mono leading-relaxed">
                            {layer.content.slice(0, 120)}{layer.content.length > 120 ? '…' : ''}
                          </p>
                          {layer.source && (
                            <span className="inline-flex items-center gap-1 text-[9px] text-[#334155] mt-1">
                              {SOURCE_ICONS[layer.source]}
                            </span>
                          )}
                        </div>

                        <div className="flex gap-0.5 flex-shrink-0">
                          <Button variant="ghost" size="icon" onClick={() => startEdit(layer)} title="Edit">
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => remove(layer.id)} title="Delete"
                            className="hover:text-[#F87171]">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add new layer form */}
                {addingType === type && (
                  <div
                    className="mb-2 p-3 rounded-lg border border-dashed space-y-2"
                    style={{ borderColor: accentHex + '50' }}
                  >
                    <input
                      autoFocus
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      className="w-full bg-[#112236] border border-[#1e3a5f] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#60a5fa]"
                      placeholder="Layer name"
                    />
                    <textarea
                      value={newContent}
                      onChange={e => setNewContent(e.target.value)}
                      rows={4}
                      className="w-full bg-[#112236] border border-[#1e3a5f] rounded px-2 py-1.5 text-xs text-[#CBD5E1] outline-none focus:border-[#60a5fa] resize-none font-mono"
                      placeholder={placeholder}
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => setAddingType(null)}>
                        <X className="w-3 h-3" /> Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={addLayer}
                        disabled={!newName.trim() || !newContent.trim()}
                        className="text-[#0d1b2a] font-bold"
                        style={{ backgroundColor: accentHex }}
                      >
                        <Plus className="w-3 h-3" /> Add Layer
                      </Button>
                    </div>
                  </div>
                )}

                {items.length === 0 && addingType !== type && (
                  <p className="text-[10px] text-[#334155] italic pl-1 pb-1">
                    No layers yet — click Add to create one
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-[#1e3a5f] flex-shrink-0 flex justify-between items-center">
          <p className="text-[10px] text-[#334155]">
            Only enabled layers are included in Claude&apos;s context.
          </p>
          <Button variant="default" size="md" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
