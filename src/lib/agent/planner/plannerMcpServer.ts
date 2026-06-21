import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ClarificationQuestion } from '@/lib/types'
import type { PlannerStreamEvent, SlideLayout, DeckTone } from './types'
import { PlannerSession } from './plannerSession'

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

const planSlideSchema = z.object({
  index: z.number().int().min(1),
  title: z.string(),
  purpose: z.string(),
  layout: z.enum([
    'cover',
    'section-header',
    'bullets',
    'two-column',
    'chart',
    'image-text',
    'quote',
    'timeline',
    'grid',
    'closing',
  ]),
  contentBrief: z.string(),
  dataPoints: z.array(z.string()).optional(),
  visualHint: z.string().optional(),
})

const deckPlanSchema = z.object({
  scope: z.enum(['light', 'medium', 'indepth']),
  audience: z.string(),
  tone: z.enum(['executive', 'technical', 'investor', 'educational', 'persuasive']),
  title: z.string(),
  oneLiner: z.string(),
  slides: z.array(planSlideSchema).min(1),
  knowledgeGaps: z.array(z.string()).optional(),
})

export function createPlannerMcpServer(
  session: PlannerSession,
  onEvent: (event: PlannerStreamEvent) => void,
  abortController: AbortController
) {
  return createSdkMcpServer({
    name: 'planner',
    tools: [
      tool(
        'read_context',
        'Read the current deck state and knowledge context before planning.',
        {},
        async () => {
          onEvent({ type: 'step', kind: 'reading', label: 'Reading deck and knowledge context' })
          return { content: [{ type: 'text', text: session.readContext() }] }
        }
      ),

      tool(
        'ask_user',
        'Pause and ask the user structured questions (scope, audience, tone, goal) before producing the plan.',
        {
          intro: z.string().optional(),
          questions: z.array(questionSchema),
        },
        async ({ intro, questions }) => {
          const result = session.askUser(intro, questions as ClarificationQuestion[])
          onEvent({ type: 'ask_user', intro, questions: questions as ClarificationQuestion[] })
          abortController.abort()
          return { content: [{ type: 'text', text: result }] }
        }
      ),

      tool(
        'submit_plan',
        'Submit the completed deck plan. Call this once you have scope, audience, tone, and a full slide outline.',
        { plan: deckPlanSchema },
        async ({ plan }) => {
          const validated = {
            ...plan,
            slides: plan.slides.map(s => ({
              ...s,
              layout: s.layout as SlideLayout,
            })),
            tone: plan.tone as DeckTone,
          }
          const result = session.submitPlan(validated)
          onEvent({ type: 'plan_ready', plan: validated })
          onEvent({ type: 'step', kind: 'done', label: `Plan ready: "${plan.title}" — ${plan.slides.length} slides` })
          return { content: [{ type: 'text', text: result }] }
        }
      ),
    ],
  })
}

export const PLANNER_MCP_TOOL_NAMES = [
  'mcp__planner__read_context',
  'mcp__planner__ask_user',
  'mcp__planner__submit_plan',
] as const
