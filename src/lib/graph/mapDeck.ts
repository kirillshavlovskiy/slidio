import Anthropic from '@anthropic-ai/sdk'
import type { SlideData } from '@/lib/types'
import { elementDisplayText, slideTitle } from './project'

const client = new Anthropic()
const MODEL = process.env.ANTHROPIC_CHEAP_MODEL || 'claude-haiku-4-5'
const MAX_OUTPUT_TOKENS = 2048

export type KnowledgeRef = {
  id: string
  type: 'Topic' | 'Claim' | 'Metric'
  name: string
  description?: string | null
}

export type ElementMapping = {
  slideId: string
  elementId: string
  knowledgeNodeId: string
  edgeType: 'EXPRESSES' | 'REPRESENTS'
  confidence: number
  evidenceText?: string
}

export type SlideTopicMapping = {
  slideId: string
  topicNodeId: string
  confidence: number
}

export type MapSlideResult = {
  elementMappings: ElementMapping[]
  slideTopics: SlideTopicMapping[]
}

function parseMappings(raw: string): MapSlideResult {
  const out: MapSlideResult = { elementMappings: [], slideTopics: [] }
  const objMatch = raw.match(/\{[\s\S]*\}/)
  if (!objMatch) return out
  try {
    const parsed = JSON.parse(objMatch[0]) as Record<string, unknown>
    const elements = parsed.elementMappings
    if (Array.isArray(elements)) {
      for (const item of elements) {
        const o = item as Record<string, unknown>
        const edgeType = o.edgeType as string
        if (edgeType !== 'EXPRESSES' && edgeType !== 'REPRESENTS') continue
        const knowledgeNodeId = String(o.knowledgeNodeId || '').trim()
        const elementId = String(o.elementId || '').trim()
        const slideId = String(o.slideId || '').trim()
        if (!knowledgeNodeId || !elementId || !slideId) continue
        out.elementMappings.push({
          slideId,
          elementId,
          knowledgeNodeId,
          edgeType,
          confidence: typeof o.confidence === 'number' ? o.confidence : 0.6,
          evidenceText: o.evidenceText ? String(o.evidenceText) : undefined,
        })
      }
    }
    const topics = parsed.slideTopics
    if (Array.isArray(topics)) {
      for (const item of topics) {
        const o = item as Record<string, unknown>
        const topicNodeId = String(o.topicNodeId || '').trim()
        const slideId = String(o.slideId || '').trim()
        if (!topicNodeId || !slideId) continue
        out.slideTopics.push({
          slideId,
          topicNodeId,
          confidence: typeof o.confidence === 'number' ? o.confidence : 0.6,
        })
      }
    }
  } catch {
    /* ignore */
  }
  return out
}

const SYSTEM = `You map slide content to an existing knowledge graph.
Return ONLY valid JSON — no markdown.

Output shape:
{
  "elementMappings": [
    { "slideId", "elementId", "knowledgeNodeId", "edgeType": "EXPRESSES"|"REPRESENTS", "confidence": 0-1, "evidenceText": "matching phrase from element" }
  ],
  "slideTopics": [
    { "slideId", "topicNodeId", "confidence": 0-1 }
  ]
}

Rules:
- EXPRESSES links a slide element to a Claim node
- REPRESENTS links a slide element to a Metric node
- slideTopics links a slide (overall theme) to a Topic node via ABOUT (provide topicNodeId only)
- Only use knowledgeNodeIds from the provided catalog — never invent IDs
- Skip decorative elements, empty shapes, logos with no factual content
- Conservative: empty arrays if nothing clearly matches
- confidence >= 0.5 only for real semantic matches`

export async function mapSlideToKnowledge(input: {
  slide: SlideData
  slideIndex: number
  presentationId: string
  knowledge: KnowledgeRef[]
}): Promise<MapSlideResult> {
  const { slide, slideIndex, presentationId, knowledge } = input

  const mappable = slide.elements
    .map(el => ({
      elementId: el.id,
      type: el.type,
      text: elementDisplayText(el),
    }))
    .filter(e => e.text.length >= 4)

  if (!mappable.length || !knowledge.length) {
    return { elementMappings: [], slideTopics: [] }
  }

  const catalog = knowledge
    .map(k => `- ${k.id} | ${k.type} | ${k.name}${k.description ? `: ${k.description.slice(0, 120)}` : ''}`)
    .join('\n')

  const elementsBlock = mappable
    .map(e => `[${e.elementId}] (${e.type}): ${e.text.slice(0, 500)}`)
    .join('\n\n')

  const user = `Presentation ${presentationId}
Slide: "${slideTitle(slide, slideIndex)}" (slideId=${slide.id})

Elements:
${elementsBlock}

Knowledge catalog (id | type | name):
${catalog}

Map elements and/or slide theme to catalog entries. JSON only.`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    thinking: { type: 'disabled' },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return { elementMappings: [], slideTopics: [] }
  }

  const parsed = parseMappings(textBlock.text)
  const validIds = new Set(knowledge.map(k => k.id))

  return {
    elementMappings: parsed.elementMappings.filter(
      m =>
        validIds.has(m.knowledgeNodeId) &&
        m.confidence >= 0.5 &&
        m.slideId === slide.id
    ),
    slideTopics: parsed.slideTopics.filter(
      t => validIds.has(t.topicNodeId) && t.confidence >= 0.5 && t.slideId === slide.id
    ),
  }
}
