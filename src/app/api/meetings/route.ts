import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { listMeetings } from '@/lib/meeting-engine'

/**
 * GET /api/meetings — List meetings with optional status filter and pagination.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || undefined
  const projectIdParam = searchParams.get('project_id')
  const projectId = projectIdParam ? parseInt(projectIdParam, 10) : undefined
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100)
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0)

  try {
    const db = getDatabase()
    const result = listMeetings(db, workspaceId, { status, projectId, limit, offset })
    return NextResponse.json({ data: result.meetings, total: result.total })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to list meetings' }, { status: 500 })
  }
}
