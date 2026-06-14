'use client'

import { useRef, useState } from 'react'
import { X, Trash2, Layers } from 'lucide-react'
import {
  DSCategory,
  DSFile,
  DesignSystem,
  buildDesignSystem,
  isTextCategory,
} from '@/lib/designSystem'

interface Props {
  dsId: string
  initialName: string
  initialFiles: DSFile[]
  onChange: (ds: DesignSystem) => void
  onClose: () => void
  /** Optional extra section (e.g. the .pptx/.pdf reference-template uploader). */
  templatesSlot?: React.ReactNode
}

interface SectionDef {
  category: DSCategory
  label: string
  emoji: string
  accept: string
  hint: string
}

const SECTIONS: SectionDef[] = [
  { category: 'stylesheet', label: 'Stylesheets', emoji: '🎨', accept: '.css', hint: 'colors_and_type.css — colors & type tokens' },
  { category: 'data', label: 'Data', emoji: '🗄️', accept: '.json', hint: '_ds_manifest.json, _adherence.oxlintrc.json' },
  { category: 'document', label: 'Documents', emoji: '📄', accept: '.md,.txt,.markdown', hint: 'README.md — usage rules' },
  { category: 'logo', label: 'Logos', emoji: '🏷️', accept: 'image/*', hint: 'brand logos — insert onto slides' },
  { category: 'font', label: 'Fonts', emoji: '🔤', accept: '.woff,.woff2,.ttf,.otf,.eot', hint: 'font files' },
  { category: 'component', label: 'Components', emoji: '🧩', accept: '', hint: 'component files' },
  { category: 'preview', label: 'Preview', emoji: '🖼️', accept: 'image/*', hint: 'preview images' },
]

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function fileId(): string {
  return `dsf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function DesignSystemPanel({
  dsId,
  initialName,
  initialFiles,
  onChange,
  onClose,
  templatesSlot,
}: Props) {
  const [name, setName] = useState(initialName)
  const [files, setFiles] = useState<DSFile[]>(initialFiles)
  const [busy, setBusy] = useState<DSCategory | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const ds = buildDesignSystem(dsId, name, files)

  const commit = (nextName: string, nextFiles: DSFile[]) => {
    setName(nextName)
    setFiles(nextFiles)
    onChange(buildDesignSystem(dsId, nextName, nextFiles))
  }

  const addFiles = async (category: DSCategory, fileList: FileList | File[]) => {
    const list = Array.from(fileList)
    if (list.length === 0) return
    setBusy(category)
    try {
      const newOnes: DSFile[] = await Promise.all(
        list.map(async f => ({
          id: fileId(),
          name: f.name,
          category,
          size: f.size,
          text: isTextCategory(category) ? await readText(f) : undefined,
          dataUrl:
            category === 'font' || category === 'logo' ? await readDataUrl(f) : undefined,
        }))
      )
      commit(name, [...files, ...newOnes])
    } finally {
      setBusy(null)
    }
  }

  const removeFile = (id: string) => commit(name, files.filter(f => f.id !== id))

  const palette = ds.tokens.palette.slice(0, 24)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/60 backdrop-blur-sm">
      <div className="w-[760px] max-h-[88vh] bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e3a5f] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30">
              <Layers className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Design System</p>
              <p className="text-xs text-[#64748B] mt-0.5">
                Upload each file into its section · the AI follows this system when building slides
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="text-[11px] font-bold tracking-wider uppercase text-amber-400">
              System name
            </label>
            <input
              value={name}
              onChange={e => commit(e.target.value, files)}
              placeholder="e.g. deel-design-system-official"
              className="mt-1 w-full bg-[#112236] border border-[#1e3a5f] rounded px-3 py-2 text-sm
                         text-white placeholder-[#475569] outline-none focus:border-amber-400"
            />
          </div>

          {/* Sections */}
          <div className="grid grid-cols-2 gap-3">
            {SECTIONS.map(sec => {
              const sectionFiles = files.filter(f => f.category === sec.category)
              return (
                <div
                  key={sec.category}
                  className="rounded-lg border border-[#1e3a5f] bg-[#0a1422] p-2.5 flex flex-col"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault()
                    if (e.dataTransfer.files.length) addFiles(sec.category, e.dataTransfer.files)
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-[#cbd5e1]">
                      {sec.emoji} {sec.label}
                    </span>
                    <span className="text-[10px] text-[#475569]">{sectionFiles.length}</span>
                  </div>

                  <div className="space-y-1 mb-1.5">
                    {sectionFiles.map(f => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between gap-1.5 rounded bg-[#112236] px-2 py-1"
                      >
                        {f.category === 'logo' && f.dataUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={f.dataUrl}
                            alt={f.name}
                            className="w-6 h-6 object-contain rounded bg-[#0d1b2a] flex-shrink-0 p-0.5"
                          />
                        )}
                        <span className="text-[11px] text-[#e2e8f0] truncate flex-1" title={f.name}>
                          {f.name}
                        </span>
                        <button
                          onClick={() => removeFile(f.id)}
                          title="Remove file"
                          className="text-[#475569] hover:text-[#F87171] flex-shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => inputs.current[sec.category]?.click()}
                    className="mt-auto cursor-pointer rounded border border-dashed border-[#1e3a5f]
                               hover:border-amber-400 bg-[#0d1b2a] hover:bg-[#1a1500] transition-all
                               px-2 py-1.5 text-center"
                  >
                    <p className="text-[10px] text-[#64748B]">
                      {busy === sec.category ? 'Reading…' : `+ Add to ${sec.label}`}
                    </p>
                    <p className="text-[9px] text-[#334155] mt-0.5 truncate">{sec.hint}</p>
                  </button>
                  <input
                    ref={el => {
                      inputs.current[sec.category] = el
                    }}
                    type="file"
                    accept={sec.accept || undefined}
                    multiple
                    className="hidden"
                    onChange={e => {
                      if (e.target.files?.length) addFiles(sec.category, e.target.files)
                      e.target.value = ''
                    }}
                  />
                </div>
              )
            })}
          </div>

          {/* Reference templates (.pptx / .pdf) */}
          {templatesSlot && (
            <div className="rounded-lg border border-[#1e3a5f] bg-[#0a1422] p-3">
              <p className="text-[11px] font-bold tracking-wider uppercase text-amber-400 mb-2">
                Reference templates (.pptx / .pdf)
              </p>
              {templatesSlot}
            </div>
          )}

          {/* Parsed tokens preview */}
          {files.length > 0 && (
            <div className="rounded-lg border border-[#1e3a5f] bg-[#0a1422] p-3 space-y-2">
              <p className="text-[11px] font-bold tracking-wider uppercase text-amber-400">
                Parsed tokens (what the AI will follow)
              </p>
              {palette.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-[#64748B] mr-1">Palette:</span>
                  {palette.map(c => (
                    <span
                      key={c}
                      title={'#' + c}
                      className="inline-block w-4 h-4 rounded-sm border border-[#1e3a5f]"
                      style={{ background: '#' + c }}
                    />
                  ))}
                </div>
              )}
              <div className="text-[11px] text-[#94a3b8]">
                <span className="text-[#64748B]">Fonts:</span>{' '}
                {ds.tokens.fontFamilies.length === 0 ? (
                  '—'
                ) : (
                  <div className="mt-1 flex flex-col gap-1">
                    {ds.tokens.fontFamilies.map(f => (
                      <div key={f} className="flex items-baseline gap-2">
                        <span className="text-[10px] text-[#64748B] w-24 truncate flex-shrink-0">
                          {f}
                        </span>
                        <span
                          className="text-[15px] text-[#e2e8f0] truncate"
                          style={{ fontFamily: `"${f}", sans-serif` }}
                        >
                          Ag — The quick brown fox 123
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-[#94a3b8]">
                <span className="text-[#64748B]">Type scale:</span>{' '}
                {ds.tokens.typeScale.join(', ') || '—'}
              </p>
              <p className="text-[11px] text-[#94a3b8]">
                <span className="text-[#64748B]">Named color tokens:</span>{' '}
                {ds.tokens.colorVars.length}
              </p>
              <p className="text-[11px] text-[#94a3b8]">
                <span className="text-[#64748B]">Themes:</span>{' '}
                {ds.hasDark ? (
                  <span className="text-[#34d399]">light + dark ✓ (AI can produce both)</span>
                ) : (
                  'light only'
                )}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1e3a5f] flex items-center justify-between flex-shrink-0">
          <p className="text-[11px] text-[#64748B]">
            {files.length} file{files.length !== 1 ? 's' : ''} ·{' '}
            {ds.tokens.palette.length} colors · {ds.tokens.fontFamilies.length} fonts
          </p>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-amber-500 text-[#0d1b2a] rounded text-sm font-bold
                       hover:bg-amber-400 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
