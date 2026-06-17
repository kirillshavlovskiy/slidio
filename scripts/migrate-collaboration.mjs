#!/usr/bin/env node
/**
 * Additive migration for hub collaboration tables/columns on SQLite or Turso.
 * Safe to re-run — skips statements that already applied.
 */
import { createClient } from '@libsql/client'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const url = process.env.DATABASE_URL || 'file:./prisma/dev.db'
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined

const statements = [
  `ALTER TABLE "User" ADD COLUMN "isSuperuser" BOOLEAN NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS "HubMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HubMember_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "KnowledgeBranch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HubMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "HubMember_hubId_userId_key" ON "HubMember"("hubId", "userId")`,
  `CREATE TABLE IF NOT EXISTS "HubInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hubId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "token" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HubInvite_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "KnowledgeBranch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "HubInvite_token_key" ON "HubInvite"("token")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "HubInvite_hubId_email_key" ON "HubInvite"("hubId", "email")`,
  `ALTER TABLE "SlideVersion" ADD COLUMN "actorId" TEXT`,
  `ALTER TABLE "DecisionRecord" ADD COLUMN "actorId" TEXT`,
]

function resolveUrl(raw) {
  if (raw.startsWith('file:')) {
    const filePath = raw.replace(/^file:/, '')
    return `file:${path.resolve(root, filePath)}`
  }
  return raw
}

const clientUrl = resolveUrl(url)
if (clientUrl.startsWith('libsql://') && !authToken) {
  console.error('Set DATABASE_AUTH_TOKEN for Turso.')
  process.exit(1)
}

const client = createClient({ url: clientUrl, authToken })

console.error(`Migrating collaboration schema on ${clientUrl.split('@').pop() || clientUrl} ...`)
for (const stmt of statements) {
  try {
    await client.execute(stmt)
    console.log('OK:', stmt.split('\n')[0].slice(0, 72))
  } catch (err) {
    const msg = String(err?.message || err)
    if (/duplicate column|already exists/i.test(msg)) {
      console.log('SKIP (exists):', stmt.split('\n')[0].slice(0, 72))
      continue
    }
    throw err
  }
}
console.error('Collaboration migration complete.')
