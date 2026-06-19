import { prisma } from '@/lib/prisma'
import { listGraphNodes } from '@/lib/graph/nodes'
import { listGraphEdges } from '@/lib/graph/edges'
import { getDeckMappingSummary } from '@/lib/graph/deckMap'
import type {
  AgentId,
  AgentPlanResponse,
  KnowledgeNodeRef,
  OrchestratorPlan,
  OrchestratorTaskType,
  SemanticEditPlan,
} from './types'

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

function scoreText(text: string, query: Set<string>): number {
  if (!query.size) return 1
  const keys = keywordSet(text)
  let s = 0
  for (const w of query) if (keys.has(w)) s++
  return s
}

function isGraphSchemaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err)
  return /no such table: GraphNode|no such column:.*extractedText/i.test(msg)
}

const KNOWLEDGE_EDIT =
  /\b(claim|metric|data|number|revenue|competitor|research|document|source|fact|evidence|investor|update.*slide|using.*(upload|research|document|knowledge|hub))\b/i

const DESIGN_ONLY =
  /\b(color|font|align|move|resize|margin|padding|layout|spacing|bold|italic|theme|style)\b/i

const FULL_DECK =
  /\b(full deck|whole deck|all slides|new deck|create.*presentation|build.*deck|from scratch)\b/i

function inferTaskType(instruction: string, hasKnowledge: boolean): OrchestratorTaskType {
  if (FULL_DECK.test(instruction)) return 'full_deck_build'
  if (hasKnowledge && KNOWLEDGE_EDIT.test(instruction)) return 'knowledge_based_slide_edit'
  if (DESIGN_ONLY.test(instruction) && !KNOWLEDGE_EDIT.test(instruction)) return 'design_only_edit'
  if (hasKnowledge) return 'knowledge_based_slide_edit'
  return 'mechanical_edit'
}

function buildOrchestrator(
  instruction: string,
  targetSlideIds: string[],
  hasKnowledge: boolean
): OrchestratorPlan {
  const task_type = inferTaskType(instruction, hasKnowledge)
  const required_agents: AgentId[] = ['slide_editor_agent', 'validation_agent']
  if (hasKnowledge && task_type !== 'design_only_edit') {
    required_agents.unshift('knowledge_agent')
  }
  const approval_required =
    hasKnowledge &&
    (task_type === 'knowledge_based_slide_edit' ||
      /\b(investor|pitch|fundraising|board|external)\b/i.test(instruction))
  return {
    task_type,
    required_agents,
    target_slide_ids: targetSlideIds,
    approval_required,
    knowledge_required: hasKnowledge && task_type !== 'design_only_edit',
  }
}

function toNodeRef(
  node: {
    id: string
    type: string
    name: string
    status: string
    description: string | null
  },
  evidence?: string | null
): KnowledgeNodeRef {
  return {
    id: node.id,
    type: node.type as KnowledgeNodeRef['type'],
    name: node.name,
    status: node.status as KnowledgeNodeRef['status'],
    description: node.description,
    evidence: evidence ?? null,
  }
}

export type BuildPlanInput = {
  branchId: string
  presentationId?: string | null
  instruction: string
  targetSlideIds: string[]
  maxClaims?: number
  maxMetrics?: number
}

export async function buildSemanticEditPlan(
  input: BuildPlanInput
): Promise<SemanticEditPlan | null> {
  const query = keywordSet(input.instruction)
  const maxClaims = input.maxClaims ?? 8
  const maxMetrics = input.maxMetrics ?? 6

  const [sources, nodes, edges] = await Promise.all([
    prisma.sourceDocument.findMany({
      where: { branchId: input.branchId, status: 'extracted' },
      select: { id: true, title: true },
      orderBy: { createdAt: 'desc' },
    }),
    listGraphNodes({ branchId: input.branchId }),
    listGraphEdges({ branchId: input.branchId }),
  ])

  const knowledge = nodes.filter(
    n =>
      (n.type === 'Claim' || n.type === 'Metric' || n.type === 'Topic') &&
      n.status !== 'rejected'
  )
  if (!knowledge.length && !sources.length) return null

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
      (node.status === 'approved' ? 3 : 0),
  }))
  scored.sort((a, b) => b.score - a.score)

  const claims = scored
    .filter(x => x.node.type === 'Claim')
    .slice(0, maxClaims)
    .map(x => toNodeRef(x.node, evidenceByNode.get(x.node.id)))

  const metrics = scored
    .filter(x => x.node.type === 'Metric')
    .slice(0, maxMetrics)
    .map(x => toNodeRef(x.node, evidenceByNode.get(x.node.id)))

  const topics = scored
    .filter(x => x.node.type === 'Topic')
    .slice(0, 5)
    .map(x => toNodeRef(x.node, evidenceByNode.get(x.node.id)))

  const risk_flags: string[] = []
  for (const c of claims) {
    if (c.status === 'candidate') {
      risk_flags.push(`Claim "${c.name}" (${c.id}) is candidate — not approved for external decks`)
    }
    if (!c.evidence?.trim()) {
      risk_flags.push(`Claim "${c.name}" (${c.id}) has no stored evidence snippet`)
    }
  }
  for (const m of metrics) {
    if (m.status === 'candidate') {
      risk_flags.push(`Metric "${m.name}" (${m.id}) is candidate — verify before investor use`)
    }
  }

  let deck_links: SemanticEditPlan['deck_links'] = []
  if (input.presentationId && input.targetSlideIds.length) {
    const mapping = await getDeckMappingSummary(input.presentationId, input.branchId)
    if (mapping?.mappings) {
      const targets = new Set(input.targetSlideIds)
      deck_links = mapping.mappings
        .filter(m => m && targets.has(m.slideId))
        .map(m => ({
          slideId: m!.slideId,
          elementId: m!.elementId,
          elementName: m!.elementName,
          knowledgeNodeId: m!.knowledgeNodeId,
          knowledgeName: m!.knowledgeName,
          knowledgeType: m!.knowledgeType,
        }))
    }
  }

  const main_message =
    topics[0]?.description?.trim() ||
    topics[0]?.name ||
    claims[0]?.description?.trim() ||
    claims[0]?.name ||
    'Use approved hub knowledge where it matches the user request.'

  return {
    main_message,
    claims_to_use: claims,
    metrics_to_use: metrics,
    topics,
    sources: sources.slice(0, 10).map(s => ({ id: s.id, title: s.title })),
    claims_to_remove: [],
    risk_flags,
    deck_links,
  }
}

export function formatSemanticPlanForAgent(plan: SemanticEditPlan): string {
  const lines: string[] = [
    '=== SEMANTIC EDIT PLAN (Knowledge Agent — follow this for factual content) ===',
    `Main message: ${plan.main_message}`,
    '',
  ]

  if (plan.topics.length) {
    lines.push('Topics:')
    plan.topics.forEach(t => lines.push(`- [${t.id}] ${t.name} (${t.status})`))
    lines.push('')
  }

  if (plan.claims_to_use.length) {
    lines.push('Claims to use (prefer approved; mark placeholders if candidate):')
    plan.claims_to_use.forEach(c => {
      lines.push(
        `- [${c.id}] ${c.name} (${c.status})` +
          (c.description ? `: ${c.description.slice(0, 160)}` : '') +
          (c.evidence ? `\n  Evidence: "${c.evidence.slice(0, 140)}"` : '')
      )
    })
    lines.push('')
  }

  if (plan.metrics_to_use.length) {
    lines.push('Metrics to use:')
    plan.metrics_to_use.forEach(m => {
      lines.push(`- [${m.id}] ${m.name} (${m.status})` + (m.description ? `: ${m.description.slice(0, 120)}` : ''))
    })
    lines.push('')
  }

  if (plan.deck_links.length) {
    lines.push('Existing deck ↔ knowledge links on target slides:')
    plan.deck_links.forEach(l => {
      lines.push(
        `- ${l.elementName} (${l.slideId}/${l.elementId}) → ${l.knowledgeType} "${l.knowledgeName}" [${l.knowledgeNodeId}]`
      )
    })
    lines.push('')
  }

  if (plan.risk_flags.length) {
    lines.push('RISK FLAGS (address in copy or ask user — do NOT present candidate claims as verified facts):')
    plan.risk_flags.forEach(f => lines.push(`- ${f}`))
    lines.push('')
  }

  lines.push('Rules: Use only listed node IDs as factual anchors. Do not invent metrics or claims.')
  lines.push('=== END SEMANTIC EDIT PLAN ===')
  return lines.join('\n')
}

export async function buildAgentPlan(input: BuildPlanInput): Promise<AgentPlanResponse> {
  const emptyOrchestrator = buildOrchestrator(input.instruction, input.targetSlideIds, false)

  try {
    const semantic_edit_plan = await buildSemanticEditPlan(input)
    const has_graph_knowledge = !!semantic_edit_plan
    const orchestrator = buildOrchestrator(
      input.instruction,
      input.targetSlideIds,
      has_graph_knowledge
    )

    const plan_context =
      orchestrator.knowledge_required && semantic_edit_plan
        ? formatSemanticPlanForAgent(semantic_edit_plan)
        : ''

    return {
      orchestrator,
      semantic_edit_plan,
      plan_context,
      has_graph_knowledge,
    }
  } catch (err) {
    if (isGraphSchemaError(err)) {
      return {
        orchestrator: emptyOrchestrator,
        semantic_edit_plan: null,
        plan_context: '',
        has_graph_knowledge: false,
      }
    }
    throw err
  }
}
