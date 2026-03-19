import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getSimulationEngine, resetSimulationEngine } from '@/lib/simulation-engine'
import { getDatabase } from '@/lib/db'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const engine = getSimulationEngine()
    const status = engine.getStatus()

    if (!status.running) {
      return NextResponse.json({ status: 'not_running', tickCount: 0 })
    }

    engine.stop()
    resetSimulationEngine()

    const db = getDatabase()
    const sleepResult = db.prepare(
      "UPDATE agents SET status = 'offline', last_seen = unixepoch() WHERE workspace_id = ?"
    ).run(auth.user.workspace_id)

    return NextResponse.json({
      status: 'stopped',
      tickCount: status.tickCount,
      agents_stopped: sleepResult.changes,
    })
  } catch (err) {
    logger.error({ err }, 'POST /api/simulation/stop error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
