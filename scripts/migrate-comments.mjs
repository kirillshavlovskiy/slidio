#!/usr/bin/env node
/**
 * Additive migration for DeckComment table on SQLite or Turso.
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
  `CREATE TABLE IF NOT EXISTS "DeckComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presentationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slideId" TEXT,
    "elementId" TEXT,
    "content" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeckComment_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeckComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "DeckComment_presentationId_idx" ON "DeckComment"("presentationId")`,
  `ALTER TABLE "DeckComment" ADD COLUMN "pinX" REAL`,
  `ALTER TABLE "DeckComment" ADD COLUMN "pinY" REAL`,
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

console.error(`Migrating DeckComment schema on ${clientUrl.split('@').pop() || clientUrl} ...`)
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
console.error('DeckComment migration complete.')
