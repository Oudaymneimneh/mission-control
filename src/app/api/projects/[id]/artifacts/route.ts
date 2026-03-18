import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import {
  ensureTenantWorkspaceAccess,
  ForbiddenError
} from '@/lib/workspaces'

function toProjectId(raw: string): number {
  const id = Number.parseInt(raw, 10)
  return Number.isFinite(id) ? id : NaN
}

const ARTIFACT_TYPES = ['document', 'spec', 'code', 'brief'] as const

const createArtifactSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(100000),
  artifact_type: z.enum(ARTIFACT_TYPES).optional(),
  meeting_id: z.number().int().positive().optional(),
  created_by_agent_id: z.number().int().positive().optional(),
})

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
      route: '/api/projects/[id]/artifacts',
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
    const typeFilter = url.searchParams.get('type')

    let query = `
      SELECT a.*, ag.name as created_by_name
      FROM project_artifacts a
      LEFT JOIN agents ag ON ag.id = a.created_by_agent_id
      WHERE a.project_id = ?
    `
    const queryParams: (number | string)[] = [projectId]

    if (typeFilter && ARTIFACT_TYPES.includes(typeFilter as typeof ARTIFACT_TYPES[number])) {
      query += ' AND a.artifact_type = ?'
      queryParams.push(typeFilter)
    }

    query += ' ORDER BY a.created_at DESC'

    const artifacts = db.prepare(query).all(...queryParams)

    return NextResponse.json({ artifacts })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/artifacts error')
    return NextResponse.json({ error: 'Failed to fetch artifacts' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/artifacts',
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

    const result = await validateBody(request, createArtifactSchema)
    if ('error' in result) return result.error
    const body = result.data

    const info = db.prepare(`
      INSERT INTO project_artifacts (project_id, meeting_id, title, content, artifact_type, created_by_agent_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      body.meeting_id ?? null,
      body.title,
      body.content,
      body.artifact_type ?? 'document',
      body.created_by_agent_id ?? null
    )

    const artifact = db.prepare('SELECT * FROM project_artifacts WHERE id = ?').get(info.lastInsertRowid)

    return NextResponse.json({ artifact }, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/artifacts error')
    return NextResponse.json({ error: 'Failed to create artifact' }, { status: 500 })
  }
}
