/**
 * Centralised LLM call logger. Appends every API call, token counts, and
 * running session cost to llm-calls.log in the project root AND to stderr.
 */
import fs from 'fs'
import path from 'path'

const LOG_FILE = path.join(process.cwd(), 'llm-calls.log')

function appendToFile(line: string) {
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8')
  } catch {
    // best effort — don't crash the server if the file can't be written
  }
}

const PRICE = {
  inputPer1M: 3.0,
  outputPer1M: 15.0,
  cacheWritePer1M: 3.75,
  cacheReadPer1M: 0.30,
}

let _sessionCost = 0
let _sessionTokens = 0
let _callCount = 0

export function logLlmCall(opts: {
  caller: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  thinkingTokens?: number
  note?: string
}) {
  const {
    caller,
    model = '?',
    inputTokens = 0,
    outputTokens = 0,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
    thinkingTokens = 0,
    note,
  } = opts

  const cost =
    (inputTokens * PRICE.inputPer1M +
      outputTokens * PRICE.outputPer1M +
      cacheReadTokens * PRICE.cacheReadPer1M +
      cacheWriteTokens * PRICE.cacheWritePer1M) /
    1_000_000

  _callCount++
  _sessionTokens += inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  _sessionCost += cost

  const parts = [
    `[LLM #${_callCount}] ${caller}`,
    `model=${model}`,
    `in=${inputTokens.toLocaleString()}`,
    `out=${outputTokens.toLocaleString()}`,
  ]
  if (thinkingTokens) parts.push(`think=${thinkingTokens.toLocaleString()}`)
  if (cacheReadTokens) parts.push(`cache_hit=${cacheReadTokens.toLocaleString()}`)
  if (cacheWriteTokens) parts.push(`cache_write=${cacheWriteTokens.toLocaleString()}`)
  parts.push(`$${cost.toFixed(4)}`)
  parts.push(`| session total: ${_sessionTokens.toLocaleString()} tok  $${_sessionCost.toFixed(4)}`)
  if (note) parts.push(`| ${note}`)

  const line = parts.join('  ')
  console.error(line)
  appendToFile(line)
}

/** Reset session counters and write a separator to the log file. */
export function resetLlmSessionLog(label?: string) {
  _sessionCost = 0
  _sessionTokens = 0
  _callCount = 0
  const line = `\n── ${new Date().toISOString()} ${label ?? 'new session'} ──`
  console.error(line)
  appendToFile(line)
}

/**
 * Log every turn from a Claude Agent SDK message stream.
 * Pass the message object straight from the `for await` loop.
 */
export function logSdkTurn(caller: string, message: unknown) {
  const m = message as {
    type?: string
    message?: { usage?: { input_tokens?: number; output_tokens?: number } }
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  }

  if (m.type === 'assistant') {
    const u = m.message?.usage ?? {}
    const inTok = (u as { input_tokens?: number }).input_tokens ?? 0
    const outTok = (u as { output_tokens?: number }).output_tokens ?? 0
    const cacheHit = (u as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0
    const cacheWrite = (u as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0
    if (inTok || outTok) {
      logLlmCall({ caller, inputTokens: inTok, outputTokens: outTok, cacheReadTokens: cacheHit, cacheWriteTokens: cacheWrite, note: 'sdk-turn' })
    }
  }

  if (m.type === 'result') {
    const u = m.usage ?? {}
    const inTok = (u as { input_tokens?: number }).input_tokens ?? 0
    const outTok = (u as { output_tokens?: number }).output_tokens ?? 0
    const line = `[LLM] ${caller} DONE — total: ${(inTok + outTok).toLocaleString()} tok  session $${_sessionCost.toFixed(4)}`
    console.error(line)
    appendToFile(line)
  }
}
