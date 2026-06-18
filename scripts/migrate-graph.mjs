#!/usr/bin/env node
/**
 * Additive migration for knowledge graph tables on SQLite or Turso.
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
  `CREATE TABLE IF NOT EXISTS "SourceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "extractedTextBlobUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceDocument_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "KnowledgeBranch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "SourceDocument_branchId_idx" ON "SourceDocument"("branchId")`,
  `CREATE TABLE IF NOT EXISTS "DocumentChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceDocumentId" TEXT NOT NULL,
    "sectionTitle" TEXT,
    "text" TEXT NOT NULL,
    "page" INTEGER,
    "charStart" INTEGER,
    "charEnd" INTEGER,
    "ordinal" INTEGER NOT NULL,
    CONSTRAINT "DocumentChunk_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "DocumentChunk_sourceDocumentId_idx" ON "DocumentChunk"("sourceDocumentId")`,
  `CREATE TABLE IF NOT EXISTS "GraphNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "properties" TEXT NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL DEFAULT 'ai_agent',
    "sourceDocumentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphNode_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "GraphNode_branchId_type_status_idx" ON "GraphNode"("branchId", "type", "status")`,
  `CREATE INDEX IF NOT EXISTS "GraphNode_sourceDocumentId_idx" ON "GraphNode"("sourceDocumentId")`,
  `CREATE TABLE IF NOT EXISTS "GraphEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "evidenceText" TEXT,
    "properties" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "GraphNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GraphEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "GraphNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "GraphEdge_branchId_idx" ON "GraphEdge"("branchId")`,
  `CREATE INDEX IF NOT EXISTS "GraphEdge_fromNodeId_toNodeId_type_idx" ON "GraphEdge"("fromNodeId", "toNodeId", "type")`,
  `CREATE TABLE IF NOT EXISTS "GraphVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "summary" TEXT NOT NULL,
    "nodeCount" INTEGER NOT NULL,
    "edgeCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphVersion_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "GraphVersion_branchId_idx" ON "GraphVersion"("branchId")`,
  `ALTER TABLE "GraphNode" ADD COLUMN "presentationId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "GraphNode_presentationId_idx" ON "GraphNode"("presentationId")`,
  `ALTER TABLE "GraphVersion" ADD COLUMN "presentationId" TEXT`,
  `ALTER TABLE "SourceDocument" ADD COLUMN "extractedText" TEXT`,
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

console.error(`Migrating graph schema on ${clientUrl.split('@').pop() || clientUrl} ...`)
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
console.error('Graph migration complete.')
