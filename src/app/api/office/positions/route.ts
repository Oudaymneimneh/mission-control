import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { getWorkspacePositions } from '@/lib/meeting-engine'

/**
 * GET /api/office/positions — Get all agent positions for the workspace.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1

  try {
    const db = getDatabase()
    const positions = getWorkspacePositions(db, workspaceId)
    return NextResponse.json({ data: positions })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to get positions' }, { status: 500 })
  }
}
