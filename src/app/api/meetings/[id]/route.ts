import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { getMeetingDetail, cancelMeeting } from '@/lib/meeting-engine'

/**
 * GET /api/meetings/[id] — Get meeting detail with messages.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const meetingId = parseInt(id, 10)
  if (Number.isNaN(meetingId)) {
    return NextResponse.json({ error: 'Invalid meeting ID' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const detail = getMeetingDetail(db, meetingId)
    if (!detail) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
    }

    // Workspace scope check
    const workspaceId = auth.user.workspace_id ?? 1
    if (detail.meeting.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
    }

    return NextResponse.json({ data: detail })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to get meeting' }, { status: 500 })
  }
}

/**
 * POST /api/meetings/[id] — Admin actions (conclude/cancel).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const meetingId = parseInt(id, 10)
  if (Number.isNaN(meetingId)) {
    return NextResponse.json({ error: 'Invalid meeting ID' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const action = body.action

  if (action !== 'cancel') {
    return NextResponse.json({ error: 'Invalid action. Supported: cancel' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const detail = getMeetingDetail(db, meetingId)
    if (!detail) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
    }

    const workspaceId = auth.user.workspace_id ?? 1
    if (detail.meeting.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
    }

    cancelMeeting(db, meetingId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to cancel meeting' }, { status: 500 })
  }
}
