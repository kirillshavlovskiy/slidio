import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

// Bump when GraphNode / graph schema fields change — busts Next.js dev global singleton.
const PRISMA_CLIENT_VERSION = 'editor-session-2026-06'

function createPrismaClient() {
  const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
  const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
  const adapter = new PrismaLibSql({ url, authToken })
  return new PrismaClient({ adapter })
}

type GlobalPrisma = {
  prisma?: PrismaClient
  prismaClientVersion?: string
}

const globalForPrisma = globalThis as unknown as GlobalPrisma

if (
  globalForPrisma.prisma &&
  globalForPrisma.prismaClientVersion !== PRISMA_CLIENT_VERSION
) {
  void globalForPrisma.prisma.$disconnect().catch(() => {})
  globalForPrisma.prisma = undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  globalForPrisma.prismaClientVersion = PRISMA_CLIENT_VERSION
}
