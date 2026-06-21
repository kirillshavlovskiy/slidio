import type { PlannerStreamEvent } from './types'

export async function consumePlannerStream(
  res: Response,
  onEvent: (event: PlannerStreamEvent) => void
): Promise<void> {
  if (!res.ok) {
    let message = `Planner request failed (HTTP ${res.status})`
    try {
      const err = (await res.json()) as { error?: string }
      if (err.error) message = err.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body from planner')

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
      onEvent(JSON.parse(line) as PlannerStreamEvent)
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as PlannerStreamEvent)
  }
}
