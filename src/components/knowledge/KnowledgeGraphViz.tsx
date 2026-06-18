'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type GraphNodeRow = {
  id: string
  type: string
  name: string
  description?: string | null
  status: string
  confidence: number
  sourceDocumentId?: string | null
}

type GraphEdgeRow = {
  id: string
  fromNodeId: string
  toNodeId: string
  type: string
  evidenceText?: string | null
}

type LayoutNode = {
  id: string
  type: string
  name: string
  x: number
  y: number
  r: number
  color: string
  stroke: string
}

type LayoutEdge = {
  id: string
  type: string
  fromId: string
  toId: string
  x1: number
  y1: number
  x2: number
  y2: number
}

type ViewBox = { x: number; y: number; width: number; height: number }

const NODE_STYLE: Record<string, { color: string; stroke: string; r: number }> = {
  Topic: { color: '#7c3aed', stroke: '#a78bfa', r: 20 },
  Claim: { color: '#2563eb', stroke: '#60a5fa', r: 15 },
  Metric: { color: '#0d9488', stroke: '#2dd4bf', r: 15 },
  SourceDocument: { color: '#475569', stroke: '#94a3b8', r: 18 },
  DocumentChunk: { color: '#1e293b', stroke: '#475569', r: 9 },
}

const EDGE_LENGTH: Record<string, number> = {
  ABOUT: 85,
  SUPPORTED_BY: 100,
  PART_OF: 95,
}

const EDGE_STYLE: Record<string, { color: string; dash?: string; width?: number }> = {
  ABOUT: { color: '#a78bfacc', width: 2 },
  SUPPORTED_BY: { color: '#60a5fa99', dash: '5 4', width: 1.5 },
  PART_OF: { color: '#64748b88', dash: '3 4', width: 1 },
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

function layoutGraph(
  nodes: GraphNodeRow[],
  edges: GraphEdgeRow[],
  showStructure: boolean
): { layoutNodes: LayoutNode[]; layoutEdges: LayoutEdge[] } {
  const visible = showStructure
    ? nodes
    : nodes.filter(n => n.type === 'Topic' || n.type === 'Claim' || n.type === 'Metric')

  const visibleIds = new Set(visible.map(n => n.id))
  const visibleEdges = edges.filter(
    e => visibleIds.has(e.fromNodeId) && visibleIds.has(e.toNodeId)
  )

  const cx = 0
  const cy = 0
  const positions = new Map<string, { x: number; y: number }>()

  const topics = visible.filter(n => n.type === 'Topic')
  const claims = visible.filter(n => n.type === 'Claim')
  const metrics = visible.filter(n => n.type === 'Metric')
  const sources = visible.filter(n => n.type === 'SourceDocument')
  const chunks = visible.filter(n => n.type === 'DocumentChunk')

  const topicRing = 90 + topics.length * 6
  topics.forEach((t, i) => {
    const angle = (i / Math.max(topics.length, 1)) * Math.PI * 2 - Math.PI / 2
    positions.set(t.id, {
      x: cx + Math.cos(angle) * topicRing,
      y: cy + Math.sin(angle) * topicRing * 0.7,
    })
  })

  const aboutTarget = new Map<string, string>()
  for (const e of visibleEdges) {
    if (e.type === 'ABOUT') aboutTarget.set(e.fromNodeId, e.toNodeId)
  }

  const cluster = (items: GraphNodeRow[], innerR: number, outerR: number) => {
    const byTopic = new Map<string, GraphNodeRow[]>()
    const orphans: GraphNodeRow[] = []
    for (const n of items) {
      const tid = aboutTarget.get(n.id)
      if (tid && positions.has(tid)) {
        if (!byTopic.has(tid)) byTopic.set(tid, [])
        byTopic.get(tid)!.push(n)
      } else orphans.push(n)
    }

    for (const [tid, group] of byTopic) {
      const center = positions.get(tid)!
      group.forEach((n, i) => {
        const angle = (i / Math.max(group.length, 1)) * Math.PI * 2
        positions.set(n.id, {
          x: center.x + Math.cos(angle) * innerR,
          y: center.y + Math.sin(angle) * innerR,
        })
      })
    }

    orphans.forEach((n, i) => {
      const angle = (i / Math.max(orphans.length, 1)) * Math.PI * 2
      positions.set(n.id, {
        x: cx + Math.cos(angle) * outerR,
        y: cy + Math.sin(angle) * outerR,
      })
    })
  }

  cluster(claims, 58, topicRing + 75)
  cluster(metrics, 78, topicRing + 100)

  sources.forEach((s, i) => {
    positions.set(s.id, { x: cx - 100 + i * 200, y: -160 })
  })

  chunks.forEach((c, i) => {
    const cols = Math.ceil(Math.sqrt(chunks.length))
    const col = i % cols
    const row = Math.floor(i / cols)
    positions.set(c.id, {
      x: cx - (cols * 50) / 2 + col * 50,
      y: 160 + row * 36,
    })
  })

  const nodeR = (id: string) => NODE_STYLE[visible.find(n => n.id === id)?.type ?? '']?.r ?? 12

  for (let iter = 0; iter < 60; iter++) {
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = positions.get(visible[i].id)!
        const b = positions.get(visible[j].id)!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy) || 1
        const minDist = nodeR(visible[i].id) + nodeR(visible[j].id) + 20
        if (dist < minDist) {
          const push = (minDist - dist) * 0.35
          const nx = dx / dist
          const ny = dy / dist
          a.x -= nx * push
          a.y -= ny * push
          b.x += nx * push
          b.y += ny * push
        }
      }
    }
    for (const e of visibleEdges) {
      const a = positions.get(e.fromNodeId)
      const b = positions.get(e.toNodeId)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 1
      const ideal = EDGE_LENGTH[e.type] ?? 90
      const spring = (dist - ideal) * 0.035
      const nx = dx / dist
      const ny = dy / dist
      a.x += nx * spring
      a.y += ny * spring
      b.x -= nx * spring
      b.y -= ny * spring
    }
  }

  const layoutNodes: LayoutNode[] = visible.map(n => {
    const pos = positions.get(n.id) ?? { x: cx, y: cy }
    const style = NODE_STYLE[n.type] ?? { color: '#334155', stroke: '#64748b', r: 12 }
    return {
      id: n.id,
      type: n.type,
      name: n.name,
      x: pos.x,
      y: pos.y,
      r: style.r,
      color: style.color,
      stroke: style.stroke,
    }
  })

  const nodePos = new Map(layoutNodes.map(n => [n.id, n]))
  const layoutEdges: LayoutEdge[] = visibleEdges
    .map(e => {
      const a = nodePos.get(e.fromNodeId)
      const b = nodePos.get(e.toNodeId)
      if (!a || !b) return null
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 1
      const nx = dx / dist
      const ny = dy / dist
      return {
        id: e.id,
        type: e.type,
        fromId: e.fromNodeId,
        toId: e.toNodeId,
        x1: a.x + nx * a.r,
        y1: a.y + ny * a.r,
        x2: b.x - nx * b.r,
        y2: b.y - ny * b.r,
      }
    })
    .filter((e): e is LayoutEdge => e !== null)

  return { layoutNodes, layoutEdges }
}

function graphBounds(layoutNodes: LayoutNode[]) {
  if (!layoutNodes.length) return { minX: -200, minY: -200, maxX: 200, maxY: 200 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of layoutNodes) {
    minX = Math.min(minX, n.x - n.r - 50)
    minY = Math.min(minY, n.y - n.r - 8)
    maxX = Math.max(maxX, n.x + n.r + 50)
    maxY = Math.max(maxY, n.y + n.r + 22)
  }
  return { minX, minY, maxX, maxY }
}

function fitViewBox(
  layoutNodes: LayoutNode[],
  viewportW: number,
  viewportH: number,
  padding = 48
): ViewBox {
  const b = graphBounds(layoutNodes)
  const contentW = Math.max(b.maxX - b.minX, 80)
  const contentH = Math.max(b.maxY - b.minY, 80)
  const scale = Math.min(
    (viewportW - padding * 2) / contentW,
    (viewportH - padding * 2) / contentH
  )
  const vbW = viewportW / scale
  const vbH = viewportH / scale
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  return { x: cx - vbW / 2, y: cy - vbH / 2, width: vbW, height: vbH }
}

function zoomViewBox(vb: ViewBox, factor: number, anchorX: number, anchorY: number): ViewBox {
  const newW = vb.width * factor
  const newH = vb.height * factor
  const relX = (anchorX - vb.x) / vb.width
  const relY = (anchorY - vb.y) / vb.height
  return {
    x: anchorX - relX * newW,
    y: anchorY - relY * newH,
    width: newW,
    height: newH,
  }
}

type Props = {
  nodes: GraphNodeRow[]
  edges: GraphEdgeRow[]
  className?: string
  initialShowStructure?: boolean
}

export default function KnowledgeGraphViz({ nodes, edges, className, initialShowStructure = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [viewport, setViewport] = useState({ width: 700, height: 400 })
  const knowledgeCount = nodes.filter(n => ['Topic', 'Claim', 'Metric'].includes(n.type)).length
  const [showStructure, setShowStructure] = useState(initialShowStructure || knowledgeCount === 0)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewBox, setViewBox] = useState<ViewBox>({ x: -350, y: -200, width: 700, height: 400 })
  const panRef = useRef<{ active: boolean; lastX: number; lastY: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width } = entries[0].contentRect
      setViewport({ width: Math.max(320, width), height: 400 })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { layoutNodes, layoutEdges } = useMemo(
    () => layoutGraph(nodes, edges, showStructure),
    [nodes, edges, showStructure]
  )

  const fitToGraph = useCallback(() => {
    setViewBox(fitViewBox(layoutNodes, viewport.width, viewport.height))
  }, [layoutNodes, viewport.width, viewport.height])

  useEffect(() => {
    fitToGraph()
  }, [fitToGraph])

  const clientToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const svgPt = pt.matrixTransform(ctm.inverse())
    return { x: svgPt.x, y: svgPt.y }
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const anchor = clientToSvg(e.clientX, e.clientY)
    const factor = e.deltaY > 0 ? 1.12 : 0.88
    setViewBox(vb => zoomViewBox(vb, factor, anchor.x, anchor.y))
  }, [clientToSvg])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as Element
    if (target.closest('[data-graph-node]')) return
    panRef.current = { active: true, lastX: e.clientX, lastY: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const pan = panRef.current
    if (!pan?.active) return
    const scaleX = viewBox.width / viewport.width
    const scaleY = viewBox.height / viewport.height
    const dx = (e.clientX - pan.lastX) * scaleX
    const dy = (e.clientY - pan.lastY) * scaleY
    pan.lastX = e.clientX
    pan.lastY = e.clientY
    setViewBox(vb => ({ ...vb, x: vb.x - dx, y: vb.y - dy }))
  }, [viewBox.width, viewBox.height, viewport.width, viewport.height])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    panRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const zoomBy = useCallback((factor: number) => {
    setViewBox(vb => {
      const cx = vb.x + vb.width / 2
      const cy = vb.y + vb.height / 2
      return zoomViewBox(vb, factor, cx, cy)
    })
  }, [])

  const selected = selectedId ? nodes.find(n => n.id === selectedId) : null
  const connectedIds = useMemo(() => {
    if (!hoveredId && !selectedId) return new Set<string>()
    const id = hoveredId ?? selectedId!
    const set = new Set<string>([id])
    for (const e of edges) {
      if (e.fromNodeId === id) set.add(e.toNodeId)
      if (e.toNodeId === id) set.add(e.fromNodeId)
    }
    return set
  }, [edges, hoveredId, selectedId])

  if (knowledgeCount === 0 && !showStructure) {
    return null
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-[9px] text-[#64748B]">
          {(['Topic', 'Claim', 'Metric'] as const).map(t => (
            <span key={t} className="inline-flex items-center gap-1">
              <span
                className="w-2.5 h-2.5 rounded-full border"
                style={{ background: NODE_STYLE[t].color, borderColor: NODE_STYLE[t].stroke }}
              />
              {t}
            </span>
          ))}
          {showStructure && (
            <>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-slate-600 border border-slate-400" />
                Source
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-800 border border-slate-500" />
                Chunk
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-[#475569] hidden sm:inline">Scroll to zoom · drag to pan</span>
          <div className="flex gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => zoomBy(0.82)} title="Zoom in">
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => zoomBy(1.22)} title="Zoom out">
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fitToGraph} title="Fit graph">
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-[#94A3B8] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showStructure}
              onChange={e => setShowStructure(e.target.checked)}
              className="rounded border-[#1e3a5f]"
            />
            Chunks
          </label>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative rounded-lg border border-[#1e3a5f] bg-[#060d18] overflow-hidden cursor-grab active:cursor-grabbing"
      >
        <svg
          ref={svgRef}
          width={viewport.width}
          height={viewport.height}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          className="block touch-none select-none"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <defs>
            <pattern id="kg-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e3a5f" strokeWidth="0.5" opacity="0.4" />
            </pattern>
          </defs>
          <rect
            x={viewBox.x - viewBox.width}
            y={viewBox.y - viewBox.height}
            width={viewBox.width * 3}
            height={viewBox.height * 3}
            fill="url(#kg-grid)"
          />

          {layoutEdges.map(e => {
            const style = EDGE_STYLE[e.type] ?? { color: '#47556966' }
            const dim = (hoveredId || selectedId) && !(connectedIds.has(e.fromId) || connectedIds.has(e.toId))
            return (
              <line
                key={e.id}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={style.color}
                strokeWidth={style.width ?? 1}
                strokeDasharray={style.dash}
                opacity={dim ? 0.15 : 1}
              />
            )
          })}

          {layoutNodes.map(n => {
            const active = connectedIds.has(n.id)
            const dim = (hoveredId || selectedId) && !active
            return (
              <g
                key={n.id}
                data-graph-node
                opacity={dim ? 0.25 : 1}
                onMouseEnter={() => setHoveredId(n.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={ev => { ev.stopPropagation(); setSelectedId(prev => (prev === n.id ? null : n.id)) }}
                className="cursor-pointer"
              >
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r + (active ? 3 : 0)}
                  fill={n.color}
                  stroke={n.stroke}
                  strokeWidth={selectedId === n.id ? 3 : 1.5}
                />
                <text
                  x={n.x}
                  y={n.y + n.r + 14}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize={10}
                  fontWeight={500}
                  pointerEvents="none"
                >
                  {truncate(n.name, n.type === 'DocumentChunk' ? 14 : 22)}
                </text>
              </g>
            )
          })}
        </svg>

        {selected && (
          <div className="absolute bottom-2 left-2 right-2 rounded-md border border-[#1e3a5f] bg-[#0d1b2a]/95 px-3 py-2 text-[10px] pointer-events-none">
            <p className="font-semibold text-white">{selected.name}</p>
            <p className="text-[#64748B] uppercase mt-0.5">{selected.type} · {Math.round(selected.confidence * 100)}% confidence</p>
            {selected.description && (
              <p className="text-[#94A3B8] mt-1 line-clamp-2">{selected.description}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
