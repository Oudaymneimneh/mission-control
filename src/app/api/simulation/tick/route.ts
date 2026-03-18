import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getSimulationEngine } from '@/lib/simulation-engine'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const engine = getSimulationEngine()
    const status = engine.getStatus()
    return NextResponse.json({ running: status.running, tickCount: status.tickCount, config: status.config })
  } catch {
    return NextResponse.json({ running: false, tickCount: 0 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const engine = getSimulationEngine()
    await engine.tick()
    return NextResponse.json({ status: 'ticked', tickCount: engine.getStatus().tickCount })
  } catch (err) {
    logger.error({ err }, 'POST /api/simulation/tick error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
