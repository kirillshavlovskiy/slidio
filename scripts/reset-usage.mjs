#!/usr/bin/env node
/**
 * Reset token usage for testing (current billing period only).
 *
 * Local:
 *   node scripts/reset-usage.mjs you@example.com
 *
 * Production (Turso):
 *   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... node scripts/reset-usage.mjs you@example.com
 *
 * Pass --all to reset every user's current-period bucket (dev only unless you mean it).
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

const emailArg = process.argv.find((a) => a.includes('@'))
const resetAll = process.argv.includes('--all')

if (!emailArg && !resetAll) {
  console.error('Usage: node scripts/reset-usage.mjs <email>  |  node scripts/reset-usage.mjs --all')
  process.exit(1)
}

const url = process.env.DATABASE_URL || 'file:./prisma/dev.db'
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
const client = createClient({ url, authToken })

const now = new Date()
const monthKey = `month:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

const { rows: users } = await client.execute(
  resetAll
    ? 'SELECT id, email, plan, subscriptionStatus, currentPeriodStart FROM User'
    : {
        sql: 'SELECT id, email, plan, subscriptionStatus, currentPeriodStart FROM User WHERE email = ?',
        args: [emailArg],
      }
)

if (users.length === 0) {
  console.error('No matching user.')
  process.exit(1)
}

for (const u of users) {
  const plan = u.plan || 'free'
  const activePaid = plan !== 'free' && ['active', 'trialing', 'past_due'].includes(u.subscriptionStatus || '')
  const periodKey =
    activePaid && u.currentPeriodStart
      ? `cycle:${new Date(u.currentPeriodStart).toISOString()}`
      : monthKey

  const result = await client.execute({
    sql: 'DELETE FROM UsageRecord WHERE userId = ? AND periodKey = ?',
    args: [u.id, periodKey],
  })
  console.log(`Reset ${u.email} — deleted ${result.rowsAffected} row(s) for ${periodKey}`)
}

console.log('\nDone. Usage for the current period is now 0.')
