import type { DeckAgentStreamEvent } from '@/lib/agent/claudeSdk/types'

export async function consumeAgentSdkStream(
  res: Response,
  onEvent: (event: DeckAgentStreamEvent) => void
): Promise<void> {
  if (!res.ok) {
    let message = `Agent SDK request failed (HTTP ${res.status})`
    try {
      const err = (await res.json()) as { error?: string }
      if (err.error) message = err.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body from agent SDK')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      onEvent(JSON.parse(line) as DeckAgentStreamEvent)
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as DeckAgentStreamEvent)
  }
}
