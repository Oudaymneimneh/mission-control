import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import {
  canInitiateMeeting,
  selectPartner,
  createMeeting,
  calculatePropensity,
  parsePersonality,
} from '@/lib/meeting-engine'

/**
 * POST /api/meetings/trigger — Operator: force-trigger a meeting for an agent.
 * Body: { agent_id: number }
 * Bypasses propensity roll but respects cooldown + partner selection.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const agentId = body.agent_id
  if (typeof agentId !== 'number') {
    return NextResponse.json({ error: 'agent_id is required (number)' }, { status: 400 })
  }

  const workspaceId = auth.user.workspace_id ?? 1

  try {
    const db = getDatabase()

    const agent = db.prepare(
      'SELECT id, name, role, status, soul_content, config, workspace_id FROM agents WHERE id = ? AND workspace_id = ?'
    ).get(agentId, workspaceId) as {
      id: number; name: string; role: string; status: string;
      soul_content: string | null; config: string | null; workspace_id: number
    } | undefined

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const personality = parsePersonality(agent.config)
    const propensity = calculatePropensity(agent.config, personality)

    if (!canInitiateMeeting(db, agent.id, agent.workspace_id)) {
      return NextResponse.json({
        error: 'Agent cannot initiate (cooldown, already in meeting, or max concurrent reached)',
        propensity,
      }, { status: 409 })
    }

    const result = selectPartner(db, agent)
    if (!result) {
      return NextResponse.json({
        error: 'No available partner found (all busy or no idle agents)',
        propensity,
      }, { status: 409 })
    }

    const meeting = createMeeting(db, agent, result.partner)
    return NextResponse.json({
      meeting_id: meeting.id,
      initiator: agent.name,
      partner: result.partner.name,
      partner_score: result.score,
      propensity,
      status: meeting.status,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to trigger meeting' }, { status: 500 })
  }
}
