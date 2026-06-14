import { ClaudeResponse, ConversationMessage } from './types'
import type { DisplayMessage } from '@/components/ChatPanel'

export const DEFAULT_WELCOME: DisplayMessage = {
  role: 'assistant',
  response: {
    type: 'clarification',
    question:
      'Select slide(s) with Ctrl/⌘ or Shift, click elements on the canvas, then describe what to change.',
  },
}

export function conversationToDisplay(history: ConversationMessage[]): DisplayMessage[] {
  if (history.length === 0) return [DEFAULT_WELCOME]

  return history.map(msg => {
    if (msg.role === 'user') {
      return {
        role: 'user' as const,
        text: msg.content,
        ...(msg.imageDataUrl ? { imageUrl: msg.imageDataUrl } : {}),
        ...(msg.imageDataUrls && msg.imageDataUrls.length > 0
          ? { imageUrls: msg.imageDataUrls }
          : {}),
      }
    }

    try {
      const response = JSON.parse(msg.content) as ClaudeResponse
      return { role: 'assistant' as const, response }
    } catch {
      return {
        role: 'assistant' as const,
        response: { type: 'clarification', question: msg.content },
      }
    }
  })
}

export function normalizeConversationHistory(raw: unknown): ConversationMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (msg): msg is ConversationMessage =>
      !!msg &&
      typeof msg === 'object' &&
      (msg.role === 'user' || msg.role === 'assistant') &&
      typeof msg.content === 'string'
  )
}
