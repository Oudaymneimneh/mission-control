import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { setAgentTargetPosition } from '@/lib/meeting-engine'
import type { AgentPositionRow } from '@/lib/meeting-engine'

/**
 * GET /api/office/positions/[agentId] — Get a single agent's position.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { agentId: agentIdStr } = await params
  const agentId = parseInt(agentIdStr, 10)
  if (Number.isNaN(agentId)) {
    return NextResponse.json({ error: 'Invalid agent ID' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const pos = db.prepare(
      'SELECT * FROM agent_office_positions WHERE agent_id = ?'
    ).get(agentId) as AgentPositionRow | undefined

    if (!pos) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 })
    }

    const workspaceId = auth.user.workspace_id ?? 1
    if (pos.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 })
    }

    return NextResponse.json({ data: pos })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to get position' }, { status: 500 })
  }
}

/**
 * POST /api/office/positions/[agentId] — Admin: override agent position.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { agentId: agentIdStr } = await params
  const agentId = parseInt(agentIdStr, 10)
  if (Number.isNaN(agentId)) {
    return NextResponse.json({ error: 'Invalid agent ID' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const { target_x, target_y } = body

  if (typeof target_x !== 'number' || typeof target_y !== 'number') {
    return NextResponse.json({ error: 'target_x and target_y are required numbers' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    setAgentTargetPosition(db, agentId, workspaceId, target_x, target_y)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to set position' }, { status: 500 })
  }
}
