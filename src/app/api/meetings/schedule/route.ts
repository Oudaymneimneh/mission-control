import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { createScheduledMeeting } from '@/lib/meeting-engine'

/**
 * POST /api/meetings/schedule — Schedule a meeting between two agents.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const { initiator_id, participant_id, topic, scheduled_for, recurring_interval_ms } = body

  if (!initiator_id || !participant_id) {
    return NextResponse.json({ error: 'initiator_id and participant_id required' }, { status: 400 })
  }
  if (initiator_id === participant_id) {
    return NextResponse.json({ error: 'Cannot schedule meeting with self' }, { status: 400 })
  }

  // Validate recurring_interval_ms if provided
  if (recurring_interval_ms !== undefined && recurring_interval_ms !== null) {
    if (typeof recurring_interval_ms !== 'number' || !Number.isFinite(recurring_interval_ms) || recurring_interval_ms < 60000) {
      return NextResponse.json(
        { error: 'recurring_interval_ms must be at least 60000 (1 minute)' },
        { status: 400 }
      )
    }
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const meeting = createScheduledMeeting(db, initiator_id, participant_id, workspaceId, topic, scheduled_for, recurring_interval_ms)
    return NextResponse.json({ data: meeting }, { status: 201 })
  } catch (err: any) {
    const msg = err?.message || 'Failed to schedule meeting'
    const status = msg.includes('not found') ? 404 : msg.includes('Maximum') ? 429 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
