import { prisma } from '@/lib/prisma'
import { listGraphNodes } from './nodes'
import { listGraphEdges } from './edges'
import { getDeckMappingSummary } from './deckMap'

const STOPWORDS = new Set(
  ('the a an and or of to in on for with is are be this that it as at by from into').split(' ')
)

function keywordSet(text: string): Set<string> {
  const out = new Set<string>()
  ;(text.toLowerCase().match(/[a-z0-9#]{3,}/g) || []).forEach(w => {
    if (!STOPWORDS.has(w)) out.add(w)
  })
  return out
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max).replace(/\s+\S*$/, '') + ' … [truncated]'
}

function scoreText(text: string, query: Set<string>): number {
  if (!query.size) return 1
  const keys = keywordSet(text)
  let s = 0
  for (const w of query) if (keys.has(w)) s++
  return s
}

export type GraphContextOptions = {
  branchId: string
  presentationId?: string | null
  instruction?: string
  charBudget?: number
}

export type GraphContextResult = {
  context: string
  claimCount: number
  metricCount: number
  topicCount: number
  sourceCount: number
  mappingCount: number
}

function isGraphSchemaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err)
  return /no such table: GraphNode|no such table: SourceDocument/i.test(msg)
}

/** Structured hub knowledge graph context for the AI agent (Phase 3 interim). */
export async function buildGraphKnowledgeContext(
  opts: GraphContextOptions
): Promise<GraphContextResult> {
  const empty: GraphContextResult = {
    context: '',
    claimCount: 0,
    metricCount: 0,
    topicCount: 0,
    sourceCount: 0,
    mappingCount: 0,
  }

  try {
    const budget = opts.charBudget ?? 8000
    const query = keywordSet(opts.instruction ?? '')

    const [sources, nodes, edges] = await Promise.all([
      prisma.sourceDocument.findMany({
        where: { branchId: opts.branchId, status: 'extracted' },
        select: { id: true, title: true },
        orderBy: { createdAt: 'desc' },
      }),
      listGraphNodes({ branchId: opts.branchId }),
      listGraphEdges({ branchId: opts.branchId }),
    ])

    const knowledge = nodes.filter(
      n =>
        (n.type === 'Claim' || n.type === 'Metric' || n.type === 'Topic') &&
        n.status !== 'rejected'
    )

    if (!knowledge.length && !sources.length) return empty

    const evidenceByNode = new Map<string, string>()
    for (const e of edges) {
      if (e.type === 'SUPPORTED_BY' && e.evidenceText) {
        evidenceByNode.set(e.fromNodeId, e.evidenceText)
      }
    }

    type Scored = { node: (typeof knowledge)[0]; score: number }
    const scored: Scored[] = knowledge.map(node => ({
      node,
      score:
        scoreText(`${node.name} ${node.description ?? ''}`, query) +
        (node.status === 'approved' ? 2 : 0),
    }))
    scored.sort((a, b) => b.score - a.score)

    const parts: string[] = []
    parts.push(
      '## KNOWLEDGE GRAPH (from hub documents — prefer over generic assumptions)',
      '_Extracted claims/metrics/topics from uploaded business documents. ' +
        'Candidate items are unverified — use as working facts; mark placeholders if uncertain._',
      ''
    )

    if (sources.length) {
      parts.push('### Source documents')
      sources.forEach(s => parts.push(`- ${s.title}`))
      parts.push('')
    }

    let used = parts.join('\n').length

    const emitSection = (title: string, type: string) => {
      const items = scored.filter(x => x.node.type === type).slice(0, 40)
      if (!items.length) return
      parts.push(`### ${title}`)
      for (const { node } of items) {
        const status =
          node.status === 'approved' ? 'approved' : 'candidate'
        const evidence = evidenceByNode.get(node.id)
        const line =
          `- **${node.name}** (${status}, ${Math.round(node.confidence * 100)}%)` +
          (node.description ? `: ${truncate(node.description, 200)}` : '') +
          (evidence ? `\n  Evidence: "${truncate(evidence, 180)}"` : '')
        if (used + line.length > budget) return
        parts.push(line)
        used += line.length + 1
      }
      parts.push('')
    }

    emitSection('Topics', 'Topic')
    emitSection('Claims', 'Claim')
    emitSection('Metrics', 'Metric')

    let mappingCount = 0
    if (opts.presentationId) {
      const mapping = await getDeckMappingSummary(
        opts.presentationId,
        opts.branchId
      )
      if (mapping && mapping.mappingCount > 0) {
        mappingCount = mapping.mappingCount
        parts.push('### This deck — linked knowledge')
        for (const m of mapping.mappings.slice(0, 15)) {
          if (!m) continue
          const line = `- Slide element "${m.elementName}" → ${m.knowledgeType} "${m.knowledgeName}"`
          if (used + line.length > budget) break
          parts.push(line)
          used += line.length + 1
        }
        parts.push('')
      }
    }

    const context =
      parts.length <= 3
        ? ''
        : `\n=== KNOWLEDGE GRAPH CONTEXT ===\n${parts.join('\n')}=== END KNOWLEDGE GRAPH CONTEXT ===`

    return {
      context,
      claimCount: knowledge.filter(n => n.type === 'Claim').length,
      metricCount: knowledge.filter(n => n.type === 'Metric').length,
      topicCount: knowledge.filter(n => n.type === 'Topic').length,
      sourceCount: sources.length,
      mappingCount,
    }
  } catch (err) {
    if (isGraphSchemaError(err)) return empty
    throw err
  }
}
