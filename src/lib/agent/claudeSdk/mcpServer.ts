import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Change, ClarificationQuestion } from '@/lib/types'
import type { DeckAgentStreamEvent } from '@/lib/agent/claudeSdk/types'
import { AskUserPause, DeckAgentSession } from '@/lib/agent/claudeSdk/deckSession'

const questionSchema = z.object({
  id: z.string(),
  question: z.string(),
  options: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string().optional(),
      })
    )
    .optional(),
  allowText: z.boolean().optional(),
  allowMultiple: z.boolean().optional(),
})

export function createDeckMcpServer(
  session: DeckAgentSession,
  onEvent: (event: DeckAgentStreamEvent) => void
) {
  return createSdkMcpServer({
    name: 'deck',
    tools: [
      tool(
        'get_slide',
        'Read the full element list (ids, geometry, style, content) for one slide.',
        { slideId: z.string() },
        async ({ slideId }) => {
          onEvent({ type: 'step', kind: 'read', label: `Inspected ${slideId}` })
          return { content: [{ type: 'text', text: session.getSlide(slideId) }] }
        }
      ),
      tool(
        'get_slides',
        'Read multiple slides at once. Omit slideIds to read the entire deck.',
        { slideIds: z.array(z.string()).optional() },
        async ({ slideIds }) => {
          const label = slideIds?.length
            ? `Inspected ${slideIds.length} slide(s)`
            : `Inspected all ${session.slides.length} slides`
          onEvent({ type: 'step', kind: 'read', label })
          return { content: [{ type: 'text', text: session.getSlides(slideIds) }] }
        }
      ),
      tool(
        'render_slide',
        'Preview slide layout and programmatic overlap/clipping checks.',
        { slideId: z.string() },
        async ({ slideId }) => {
          onEvent({ type: 'step', kind: 'render', label: `Rendered ${slideId}` })
          return { content: [{ type: 'text', text: session.renderSlide(slideId) }] }
        }
      ),
      tool(
        'apply_changes',
        'Apply a patch to the live slide(s). Provide a complete, self-contained set of changes.',
        {
          changes: z.array(z.record(z.string(), z.unknown())),
          summary: z.string().optional(),
        },
        async ({ changes, summary }) => {
          const result = session.applyChanges(changes as unknown as Change[], summary)
          onEvent({
            type: 'step',
            kind: 'apply',
            label: summary || `Applied ${changes.length} change batch`,
          })
          return { content: [{ type: 'text', text: result }] }
        }
      ),
      tool(
        'finish',
        'Finish the session once the result is correct.',
        { summary: z.string() },
        async ({ summary }) => {
          session.finish(summary)
          onEvent({ type: 'step', kind: 'done', label: summary })
          return { content: [{ type: 'text', text: summary }] }
        }
      ),
      tool(
        'ask_user',
        'Pause and ask the user structured questions when genuinely blocked.',
        {
          intro: z.string().optional(),
          questions: z.array(questionSchema),
        },
        async ({ intro, questions }) => {
          session.askUser(intro, questions as ClarificationQuestion[])
          return { content: [{ type: 'text', text: 'Paused for user input.' }] }
        }
      ),
    ],
  })
}

export const DECK_MCP_TOOL_NAMES = [
  'mcp__deck__get_slide',
  'mcp__deck__get_slides',
  'mcp__deck__render_slide',
  'mcp__deck__apply_changes',
  'mcp__deck__finish',
  'mcp__deck__ask_user',
] as const

export { AskUserPause }
