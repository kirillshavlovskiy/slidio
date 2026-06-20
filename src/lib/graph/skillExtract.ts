import Anthropic from '@anthropic-ai/sdk'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { toFile } from '@anthropic-ai/sdk/uploads'
import { agentModel } from '@/lib/agent/models'
import { fileTypeFromName } from '@/lib/parseDocumentServer'

const client = new Anthropic()

const SKILL_BETAS = [
  'code-execution-2025-08-25',
  'files-api-2025-04-14',
  'skills-2025-10-02',
] as const

const MODEL = agentModel()
const EXTRACT_MAX_TOKENS = 16_000
const API_TIMEOUT_MS = 120_000

export const SKILL_EXTRACT_FORMATS = new Set(['pdf', 'docx', 'pptx', 'xlsx'])

function skillIdForFileType(fileType: string): string | null {
  if (fileType === 'pdf') return 'pdf'
  if (fileType === 'docx') return 'docx'
  if (fileType === 'pptx') return 'pptx'
  if (fileType === 'xlsx') return 'xlsx'
  return null
}

function mimeForFilename(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.pptx') || lower.endsWith('.pptm')) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  return 'application/octet-stream'
}

export function needsSkillExtract(filename: string): boolean {
  const ft = fileTypeFromName(filename)
  return SKILL_EXTRACT_FORMATS.has(ft)
}

function extractionPrompt(fileType: string, filename: string): string {
  const structureHints: Record<string, string> = {
    pdf: '- Use "## Page N" headings when page boundaries are clear',
    docx: '- Preserve headings, bullet lists, and tables as Markdown',
    pptx: '- Use "## Slide N" before each slide\'s text, in order',
    xlsx: '- Use "## Sheet: <name>" for each worksheet; render tabular data as Markdown tables',
  }
  const hint = structureHints[fileType] || '- Preserve logical structure with Markdown headings'

  return `Read the uploaded file "${filename}" using the ${fileType} skill.

Extract ALL readable factual text for a knowledge base (claims, metrics, topics, definitions, data).
${hint}
- Include numbers, dates, and named entities verbatim where possible
- Do NOT summarize or omit sections — completeness matters more than brevity
- Return ONLY the extracted text (Markdown). No preamble, commentary, or code fences.`
}

function collectTextFromMessage(message: BetaMessage): string {
  const parts: string[] = []
  for (const block of message.content) {
    if (block.type === 'text' && block.text.trim()) {
      parts.push(block.text.trim())
    }
  }
  return parts.join('\n\n').trim()
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    ),
  ])
}

/**
 * Extract document text using Anthropic document skills (pdf, docx, pptx, xlsx).
 * Uploads via Files API, runs code-execution + skill in container, returns Markdown text.
 */
export async function extractTextWithSkill(buffer: Buffer, filename: string): Promise<string> {
  const fileType = fileTypeFromName(filename)
  const skillId = skillIdForFileType(fileType)
  if (!skillId) {
    throw new Error(`Skill extraction is not supported for .${fileType} files`)
  }

  const uploadable = await toFile(buffer, filename, { type: mimeForFilename(filename) })
  const uploaded = await client.beta.files.upload({
    file: uploadable,
    betas: [...SKILL_BETAS],
  })

  try {
    const response = await withTimeout(
      client.beta.messages.create({
        model: MODEL,
        max_tokens: EXTRACT_MAX_TOKENS,
        betas: [...SKILL_BETAS],
        container: {
          skills: [{ type: 'anthropic', skill_id: skillId, version: 'latest' }],
        },
        tools: [{ type: 'code_execution_20250825', name: 'code_execution' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'container_upload', file_id: uploaded.id },
              { type: 'text', text: extractionPrompt(fileType, filename) },
            ],
          },
        ],
      }),
      API_TIMEOUT_MS,
      'Document skill extraction'
    )

    const text = collectTextFromMessage(response)
    if (!text) {
      throw new Error('Skill extraction returned no text — the file may be empty or unreadable')
    }
    return text
  } finally {
    await client.beta.files.delete(uploaded.id, { betas: [...SKILL_BETAS] }).catch(() => {})
  }
}
