import Anthropic from '@anthropic-ai/sdk'
import type { ExtractedItem } from './validate'

const client = new Anthropic()
const MODEL = process.env.ANTHROPIC_CHEAP_MODEL || 'claude-haiku-4-5'
export const BATCH_SIZE = Math.max(1, Number(process.env.GRAPH_EXTRACT_BATCH_SIZE) || 2)
export const BATCH_DELAY_MS = Math.max(0, Number(process.env.GRAPH_EXTRACT_DELAY_MS) || 6500)
const MAX_OUTPUT_TOKENS = 1024
const API_TIMEOUT_MS = 90_000
const MAX_429_RETRIES = 3

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    ),
  ])
}

function parseItems(raw: string): ExtractedItem[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item): ExtractedItem | null => {
        const o = item as Record<string, unknown>
        const type = o.type as ExtractedItem['type']
        if (type !== 'Topic' && type !== 'Claim' && type !== 'Metric') return null
        const confidence = typeof o.confidence === 'number' ? o.confidence : 0.5
        const name = String(o.name || '').trim()
        if (!name) return null
        return {
          type,
          name,
          description: o.description ? String(o.description) : undefined,
          confidence,
          evidenceText: o.evidenceText ? String(o.evidenceText) : undefined,
          topicName: o.topicName ? String(o.topicName) : undefined,
        }
      })
      .filter((x): x is ExtractedItem => x !== null)
  } catch {
    return []
  }
}

function parseBatchItems(raw: string, expectedCount: number): ExtractedItem[][] {
  const out: ExtractedItem[][] = Array.from({ length: expectedCount }, () => [])
  const objMatch = raw.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as Record<string, unknown>
      const chunks = parsed.chunks
      if (Array.isArray(chunks)) {
        for (let i = 0; i < expectedCount; i++) {
          const entry = chunks[i]
          if (Array.isArray(entry)) out[i] = parseItems(JSON.stringify(entry))
          else if (entry && typeof entry === 'object' && Array.isArray((entry as { items?: unknown }).items)) {
            out[i] = parseItems(JSON.stringify((entry as { items: unknown[] }).items))
          }
        }
        return out
      }
    } catch {
      // fall through
    }
  }
  out[0] = parseItems(raw)
  return out
}

async function createWithRetry(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(
        client.messages.create(params),
        API_TIMEOUT_MS,
        'AI extraction'
      )
    } catch (err) {
      const status = (err as { status?: number })?.status
      if (status === 429 && attempt < MAX_429_RETRIES) {
        const headers = (err as { headers?: Record<string, string> })?.headers
        const retryAfter = Number(headers?.['retry-after']) || 0
        const waitMs = Math.min(Math.max(retryAfter * 1000, BATCH_DELAY_MS), 45_000)
        console.warn(`[graph extract] 429 — wait ${waitMs}ms (${attempt + 1}/${MAX_429_RETRIES})`)
        await sleep(waitMs)
        continue
      }
      throw err
    }
  }
}

const SYSTEM = `Extract structured knowledge from business document text.
Return ONLY valid JSON — no markdown fences.

Single chunk: a JSON array of objects with fields:
- type: "Topic" | "Claim" | "Metric"
- name, description, confidence (0–1)
- evidenceText: exact substring from the chunk (required for Claim/Metric)
- topicName: optional for Claim/Metric

Multiple chunks: { "chunks": [ { "items": [ ...same objects... ] }, ... ] } — one entry per chunk in order.

Rules: conservative, no invented facts, skip fluff, return [] / empty items if nothing substantive.`

async function callExtract(user: string, batchCount: number): Promise<ExtractedItem[][]> {
  const response = await createWithRetry({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    thinking: { type: 'disabled' },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return Array.from({ length: batchCount }, () => [])
  }

  const raw = textBlock.text.trim()
  return batchCount === 1 ? [parseItems(raw)] : parseBatchItems(raw, batchCount)
}

export async function extractFromChunkBatch(
  chunkTexts: string[],
  hubHints?: string
): Promise<ExtractedItem[][]> {
  if (!chunkTexts.length) return []

  const hints = hubHints ? `Hub context:\n${hubHints.slice(0, 800)}\n\n` : ''

  if (chunkTexts.length === 1) {
    const user = `${hints}Chunk:\n"""${chunkTexts[0].slice(0, 2500)}"""`
    return callExtract(user, 1)
  }

  const body = chunkTexts
    .map((text, i) => `--- Chunk ${i + 1} ---\n"""${text.slice(0, 1800)}"""`)
    .join('\n\n')

  const user = `${hints}Extract from each chunk separately. Return { "chunks": [ { "items": [...] }, ... ] } with ${chunkTexts.length} entries in order.\n\n${body}`
  return callExtract(user, chunkTexts.length)
}

export { sleep }
