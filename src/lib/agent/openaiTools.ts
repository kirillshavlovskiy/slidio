import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'

/** Convert Anthropic tool defs to OpenAI function tools. */
export function anthropicToolsToOpenAI(
  tools: Anthropic.Tool[]
): OpenAI.ChatCompletionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema as Record<string, unknown>,
      strict: (t as { strict?: boolean }).strict ?? false,
    },
  }))
}

/** Map Anthropic tool-loop messages to OpenAI chat format. */
export function anthropicMessagesToOpenAI(
  messages: Array<{
    role: 'user' | 'assistant'
    content: string | Array<{ type: string; [key: string]: unknown }>
  }>
): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = []
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = []
      for (const b of m.content) {
        if (b.type === 'text' && typeof b.text === 'string') textParts.push(b.text)
        if (b.type === 'thinking' && typeof b.thinking === 'string') {
          textParts.push(`[REASONING]\n${b.thinking}`)
        }
        if (b.type === 'tool_use') {
          toolCalls.push({
            id: String(b.id),
            type: 'function',
            function: {
              name: String(b.name),
              arguments: JSON.stringify(b.input ?? {}),
            },
          })
        }
      }
      out.push({
        role: 'assistant',
        content: textParts.join('\n') || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    // user turn with tool results
    const toolResults: OpenAI.ChatCompletionToolMessageParam[] = []
    const textParts: string[] = []
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        const content =
          typeof b.content === 'string'
            ? b.content
            : Array.isArray(b.content)
              ? b.content
                  .map(c =>
                    c.type === 'text'
                      ? c.text
                      : c.type === 'image'
                        ? '[screenshot]'
                        : ''
                  )
                  .join('\n')
              : ''
        toolResults.push({
          role: 'tool',
          tool_call_id: String(b.tool_use_id),
          content,
        })
      } else if (b.type === 'text' && typeof b.text === 'string') {
        textParts.push(b.text)
      }
    }
    if (textParts.length) out.push({ role: 'user', content: textParts.join('\n') })
    out.push(...toolResults)
  }
  return out
}

export type OpenAIAgentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking: string }

/** Map OpenAI completion to the same block shape the client already handles. */
export function openAIResponseToBlocks(
  message: OpenAI.ChatCompletionMessage
): OpenAIAgentBlock[] {
  const blocks: OpenAIAgentBlock[] = []
  if (message.content?.trim()) {
    blocks.push({ type: 'text', text: message.content })
  }
  if (message.tool_calls?.length) {
    for (const tc of message.tool_calls) {
      if (tc.type !== 'function') continue
      let input: unknown = {}
      try {
        input = JSON.parse(tc.function.arguments || '{}')
      } catch {
        input = {}
      }
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      })
    }
  }
  return blocks
}
