#!/usr/bin/env node
/**
 * Smoke-test @anthropic-ai/claude-agent-sdk (CLI spawn + optional deck MCP run).
 * Usage: node scripts/test-claude-agent-sdk.mjs [--deck]
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

for (const line of readFileSync(resolve(root, '.env.local'), 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq < 1) continue
  const key = trimmed.slice(0, eq)
  let val = trimmed.slice(eq + 1)
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  if (!process.env[key]) process.env[key] = val
}

const deckMode = process.argv.includes('--deck')

const sdkOptions = {
  maxTurns: deckMode ? 5 : 1,
  persistSession: false,
  settingSources: [],
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  ...(process.env.CLAUDE_CODE_EXECUTABLE
    ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE }
    : {}),
}

console.log('── Claude Agent SDK smoke test ──')
console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING')
console.log('AGENT_PROVIDER (app):', process.env.AGENT_PROVIDER || '(unset)')
console.log('Mode:', deckMode ? 'deck MCP tools' : 'minimal PONG')

const { query, tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk')
const { z } = await import('zod')

let prompt = 'Reply with exactly the word PONG and nothing else.'
let options = { ...sdkOptions, tools: [], strictMcpConfig: true }

if (deckMode) {
  const deckServer = createSdkMcpServer({
    name: 'deck',
    tools: [
      tool(
        'get_slides',
        'Read slides',
        { slideIds: z.array(z.string()).optional() },
        async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify([
                {
                  id: 'slide-1',
                  bg: 'FFFFFF',
                  elements: [{ id: 'title', type: 'text', content: 'Hello', x: 1, y: 1, w: 8, h: 1 }],
                },
              ]),
            },
          ],
        })
      ),
      tool(
        'finish',
        'Finish',
        { summary: z.string() },
        async ({ summary }) => ({ content: [{ type: 'text', text: summary }] })
      ),
    ],
  })
  options = {
    ...sdkOptions,
    strictMcpConfig: true,
    mcpServers: { deck: deckServer },
    allowedTools: ['mcp__deck__get_slides', 'mcp__deck__finish'],
  }
  prompt =
    'User instruction: "How many elements on slide 1?"\n\n' +
    'This is a QUESTION — call get_slides, then finish with your answer in summary. Do NOT apply changes.'
}

let gotInit = false
let gotResult = false

try {
  for await (const msg of query({ prompt, options })) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      gotInit = true
      console.log('✓ CLI initialized — model:', msg.model)
    }
    if (msg.type === 'assistant') {
      const blocks = msg.message?.content
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b.type === 'text' && b.text?.trim()) {
            console.log('  assistant:', b.text.trim().slice(0, 120))
          }
        }
      }
    }
    if (msg.type === 'result') {
      gotResult = true
      console.log('✓ Result:', msg.subtype)
      if (msg.subtype === 'success') {
        console.log('  summary:', (msg.result || '').slice(0, 300))
        console.log('  turns:', msg.num_turns, '| cost $:', msg.total_cost_usd?.toFixed(4))
      } else if ('errors' in msg) {
        console.log('  errors:', msg.errors)
      }
    }
  }

  if (gotInit && gotResult) {
    console.log('\nPASS — Claude Agent SDK is working.')
    process.exit(0)
  }
  console.error('\nFAIL — no init or result message received.')
  process.exit(1)
} catch (err) {
  console.error('\nFAIL —', err instanceof Error ? err.message : err)
  if (String(err).includes('Native CLI binary')) {
    console.error(
      'Hint: run npm install (optional platform package) or set CLAUDE_CODE_EXECUTABLE in .env.local'
    )
  }
  process.exit(1)
}
