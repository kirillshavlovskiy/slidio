#!/usr/bin/env node
/**
 * Applies the Prisma schema to a Turso (libSQL) database.
 *
 * The Prisma CLI's native SQLite connector only understands `file:` URLs, so we
 * generate the DDL from the schema and execute it against Turso over libSQL.
 *
 * Usage (first-time table creation):
 *   DATABASE_URL=libsql://your-db.turso.io \
 *   DATABASE_AUTH_TOKEN=eyJ... \
 *   npm run db:push:turso
 *
 * Note: this creates tables that don't exist yet. For later schema changes,
 * apply the altering SQL via `turso db shell <db>` (libSQL has limited ALTER).
 */
import { execSync } from "node:child_process";
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;

if (!url || !url.startsWith("libsql://")) {
  console.error("Set DATABASE_URL to your libsql://<db>.turso.io URL.");
  process.exit(1);
}
if (!authToken) {
  console.error("Set DATABASE_AUTH_TOKEN to your Turso auth token.");
  process.exit(1);
}

console.error("Generating schema SQL from prisma/schema.prisma...");
const raw = execSync(
  "npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script",
  { encoding: "utf8" }
);

// Drop comment lines, then split into individual statements.
const statements = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const client = createClient({ url, authToken });
console.error(`Applying ${statements.length} statement(s) to Turso...`);
for (const stmt of statements) {
  try {
    await client.execute(stmt);
  } catch (err) {
    console.error(`\nFailed on statement:\n${stmt}\n`);
    throw err;
  }
}
console.error("Done. Turso schema is in sync with prisma/schema.prisma.");
