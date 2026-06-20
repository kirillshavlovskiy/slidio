import { NextResponse } from 'next/server'
import { getAgentProvider } from '@/lib/agent/models'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({ provider: getAgentProvider() })
}
