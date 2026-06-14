import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Local dev uses the SQLite file. Production (Turso) schema changes are applied
// with `npm run db:push:turso` (see scripts/push-turso.mjs), since the Prisma
// CLI's native SQLite connector only speaks `file:` URLs, not `libsql://`.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
  },
})
