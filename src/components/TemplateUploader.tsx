'use client'

import { useRef, useState } from 'react'
import type { TemplateKnowledge } from '@/lib/templateKnowledge'
import { isClientParsableTemplate, parseTemplateClient } from '@/lib/parseTemplateClient'

export type { TemplateKnowledge } from '@/lib/templateKnowledge'

interface Props {
  templates: TemplateKnowledge[]
  onLoadedBatch: (templates: TemplateKnowledge[]) => void
  onRemove: (id: string) => void
  onClearAll: () => void
}

async function parseTemplateFile(file: File): Promise<TemplateKnowledge> {
  // .pptx / .key are parsed in the browser so big files don't hit the
  // serverless body-size limit (HTTP 413). PDFs still use the server route.
  if (isClientParsableTemplate(file.name)) {
    return parseTemplateClient(file)
  }
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/parse-template', { method: 'POST', body: fd })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Failed to parse ${file.name}`)
  }
  return res.json()
}

export default function TemplateUploader({
  templates,
  onLoadedBatch,
  onRemove,
  onClearAll,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [loadingCount, setLoadingCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => {
      const n = f.name.toLowerCase()
      return n.endsWith('.pptx') || n.endsWith('.pdf') || n.endsWith('.key')
    })

    if (list.length === 0) {
      setError('Only .pptx, .key or .pdf template files are supported')
      return
    }

    setLoading(true)
    setLoadingCount(list.length)
    setError(null)

    const results = await Promise.allSettled(list.map(file => parseTemplateFile(file)))
    const loaded = results
      .filter((r): r is PromiseFulfilledResult<TemplateKnowledge> => r.status === 'fulfilled')
      .map(r => r.value)

    const failures = results
      .map((r, i) => (r.status === 'rejected' ? list[i].name : null))
      .filter(Boolean) as string[]

    if (loaded.length > 0) {
      onLoadedBatch(loaded)
    }

    if (failures.length > 0) {
      setError(
        loaded.length > 0
          ? `Loaded ${loaded.length}, failed: ${failures.join(', ')}`
          : `Failed to parse: ${failures.join(', ')}`
      )
    }

    setLoading(false)
    setLoadingCount(0)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="mx-3 mb-2 space-y-2">
      {templates.length > 0 && (
        <>
          <p className="text-[10px] text-[#64748B] px-1">
            {templates.length} template{templates.length !== 1 ? 's' : ''} active
          </p>
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {templates.map(t => {
              const pageLabel = t.source === 'pdf' ? 'pages' : 'slides'
              return (
                <div
                  key={t.id}
                  className="rounded-lg border border-[#F59E0B] bg-[#1a1500] p-2 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#F59E0B] truncate">
                      {t.source === 'pdf' ? '📄' : '📎'} {t.filename}
                    </p>
                    <p className="text-xs text-[#64748B] mt-0.5">
                      {t.slideCount} {pageLabel} · {t.fonts[0] || 'default font'} ·{' '}
                      {t.colors.slice(0, 4).map(c => (
                        <span
                          key={c}
                          title={'#' + c}
                          className="inline-block w-2.5 h-2.5 rounded-sm mr-0.5 align-middle border border-[#1e3a5f]"
                          style={{ background: '#' + c }}
                        />
                      ))}
                    </p>
                  </div>
                  <button
                    onClick={() => onRemove(t.id)}
                    title="Remove template"
                    className="text-[#475569] hover:text-[#F87171] text-xs flex-shrink-0 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
          {templates.length > 1 && (
            <button
              onClick={onClearAll}
              className="text-[10px] text-[#64748B] hover:text-[#F87171] transition-colors px-1"
            >
              Clear all templates
            </button>
          )}
        </>
      )}

      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-lg border border-dashed border-[#1e3a5f] hover:border-[#F59E0B]
                   bg-[#0d1b2a] hover:bg-[#1a1500] transition-all p-2 text-center group"
      >
        {loading ? (
          <p className="text-xs text-[#64748B]">
            Parsing {loadingCount} file{loadingCount !== 1 ? 's' : ''}…
          </p>
        ) : (
          <>
            <p className="text-xs text-[#475569] group-hover:text-[#F59E0B] transition-colors">
              {templates.length > 0
                ? '+ Add more templates'
                : '📎 Drop .pptx / .key / .pdf templates (multiple)'}
            </p>
            <p className="text-[10px] text-[#334155] mt-0.5">
              Select or drop several files at once
            </p>
          </>
        )}
      </div>
      {error && <p className="text-[10px] text-[#F87171] px-1">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".pptx,.key,.pdf,application/pdf"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
