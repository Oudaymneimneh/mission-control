import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  ensureTenantWorkspaceAccess,
  ForbiddenError
} from '@/lib/workspaces'

function toProjectId(raw: string): number {
  const id = Number.parseInt(raw, 10)
  return Number.isFinite(id) ? id : NaN
}

const PAGE_SIZE = 20

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/activity',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })
    const { id } = await params
    const projectId = toProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    const projectScope = db.prepare(`
      SELECT p.id
      FROM projects p
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ?
      LIMIT 1
    `).get(projectId, workspaceId, tenantId)
    if (!projectScope) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const url = new URL(request.url)
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    const offset = (page - 1) * PAGE_SIZE

    const unionQuery = `
      SELECT 'meeting' as type, m.id, COALESCE(m.topic, 'Meeting') as title,
        m.summary as detail, COALESCE(m.concluded_at, m.started_at, m.created_at) as timestamp,
        m.status as extra1, i.name as extra2, p2.name as extra3
      FROM agent_meetings m
      LEFT JOIN agents i ON i.id = m.initiator_id
      LEFT JOIN agents p2 ON p2.id = m.participant_id
      WHERE m.project_id = ?

      UNION ALL

      SELECT 'decision' as type, d.id, d.title, d.description as detail,
        d.created_at as timestamp, d.status as extra1, NULL as extra2, NULL as extra3
      FROM project_decisions d WHERE d.project_id = ?

      UNION ALL

      SELECT 'artifact' as type, a.id, a.title, a.artifact_type as detail,
        a.created_at as timestamp, NULL as extra1, ag.name as extra2, NULL as extra3
      FROM project_artifacts a
      LEFT JOIN agents ag ON ag.id = a.created_by_agent_id
      WHERE a.project_id = ?

      UNION ALL

      SELECT 'task' as type, t.id, t.title, t.status as detail,
        t.created_at as timestamp, t.priority as extra1, NULL as extra2, NULL as extra3
      FROM tasks t WHERE t.project_id = ?
    `

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM (${unionQuery})`).get(
      projectId, projectId, projectId, projectId
    ) as { total: number }
    const total = countRow.total
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

    const activity = db.prepare(`
      ${unionQuery}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(projectId, projectId, projectId, projectId, PAGE_SIZE, offset)

    return NextResponse.json({ activity, page, totalPages, total })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/activity error')
    return NextResponse.json({ error: 'Failed to fetch activity feed' }, { status: 500 })
  }
}
