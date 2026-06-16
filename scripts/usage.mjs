#!/usr/bin/env node
/**
 * Show token usage vs plan limits for every user.
 *
 * Local:
 *   node scripts/usage.mjs
 *
 * Production (Turso):
 *   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... node scripts/usage.mjs
 *
 * Reads DECKPILOT_*_TOKENS from the environment (defaults match plans.ts).
 */
import { createClient } from '@libsql/client'
import { readFileSync, existsSync } from 'node:fs'

function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m || process.env[m[1]] != null) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}

loadEnvLocal()

function tokenQuota(envVar, fallback) {
  const parsed = Number.parseInt(process.env[envVar] || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const LIMITS = {
  free: tokenQuota('DECKPILOT_FREE_TOKENS', 200_000),
  pro: tokenQuota('DECKPILOT_PRO_TOKENS', 2_000_000),
  max: tokenQuota('DECKPILOT_MAX_TOKENS', 5_000_000),
}

const url = process.env.DATABASE_URL || 'file:./prisma/dev.db'
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
const client = createClient({ url, authToken })

const now = new Date()
const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
const monthKey = `month:${month}`

const { rows: users } = await client.execute(
  `SELECT id, email, plan, subscriptionStatus, currentPeriodStart FROM User ORDER BY createdAt DESC`
)
const { rows: usage } = await client.execute(
  `SELECT userId, periodKey, tokensUsed, updatedAt FROM UsageRecord ORDER BY updatedAt DESC`
)

console.log(`Database: ${url.startsWith('file:') ? url : url.replace(/\/\/[^@]+@/, '//***@')}`)
console.log(`Limits — free: ${LIMITS.free.toLocaleString()}  pro: ${LIMITS.pro.toLocaleString()}  max: ${LIMITS.max.toLocaleString()}`)
console.log(`Calendar month key: ${monthKey}\n`)

if (users.length === 0) {
  console.log('No users.')
  process.exit(0)
}

for (const u of users) {
  const plan = u.plan || 'free'
  const activePaid = plan !== 'free' && ['active', 'trialing', 'past_due'].includes(u.subscriptionStatus || '')
  const periodKey =
    activePaid && u.currentPeriodStart
      ? `cycle:${new Date(u.currentPeriodStart).toISOString()}`
      : monthKey
  const limit = LIMITS[plan] ?? LIMITS.free
  const recs = usage.filter((r) => r.userId === u.id)
  const current = recs.find((r) => r.periodKey === periodKey)
  const used = current?.tokensUsed ?? 0
  const remaining = Math.max(0, limit - used)
  const blocked = remaining <= 0

  console.log(`${blocked ? '⛔' : '✓'} ${u.email}  plan=${plan}  period=${periodKey}`)
  console.log(`   used ${used.toLocaleString()} / ${limit.toLocaleString()}  (${remaining.toLocaleString()} left)`)
  const other = recs.filter((r) => r.periodKey !== periodKey)
  if (other.length) {
    console.log(`   other buckets: ${other.map((r) => `${r.periodKey}=${r.tokensUsed}`).join(', ')}`)
  }
}
