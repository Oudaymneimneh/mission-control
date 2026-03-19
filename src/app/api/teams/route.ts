import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

interface TeamRow {
  id: number
  name: string
  description: string | null
  parent_id: number | null
  workspace_id: number
  created_at: number
  updated_at: number
  member_count?: number
}

interface TeamMemberRow {
  team_id: number
  id: number
  name: string
  role: string
  status: string
}

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  parent_id: z.number().int().positive().nullable().optional(),
})

const updateTeamSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
})

const deleteTeamSchema = z.object({
  id: z.number().int().positive(),
})

/**
 * GET /api/teams - List teams with member count
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const url = new URL(request.url)
    const includeMembers = url.searchParams.get('include')?.includes('members')

    const teams = db.prepare(`
      SELECT t.*, COUNT(tm.agent_id) as member_count
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      WHERE t.workspace_id = ?
      GROUP BY t.id
      ORDER BY (t.parent_id IS NULL) DESC, t.name ASC
    `).all(workspaceId) as TeamRow[]

    if (includeMembers) {
      const members = db.prepare(`
        SELECT tm.team_id, a.id, a.name, a.role, a.status
        FROM team_members tm
        JOIN agents a ON a.id = tm.agent_id
        WHERE a.workspace_id = ?
      `).all(workspaceId) as TeamMemberRow[]

      const membersByTeam = new Map<number, Array<Omit<TeamMemberRow, 'team_id'>>>()
      for (const m of members) {
        const list = membersByTeam.get(m.team_id) ?? []
        list.push({ id: m.id, name: m.name, role: m.role, status: m.status })
        membersByTeam.set(m.team_id, list)
      }

      const teamsWithMembers = teams.map(t => ({
        ...t,
        members: membersByTeam.get(t.id) ?? [],
      }))

      return NextResponse.json({ teams: teamsWithMembers })
    }

    return NextResponse.json({ teams })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/teams error')
    return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 })
  }
}

/**
 * POST /api/teams - Create a team
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createTeamSchema)
    if ('error' in result) return result.error
    const { name, description, parent_id } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Validate parent_id hierarchy depth (max 2 levels)
    if (parent_id) {
      const parent = db.prepare(
        'SELECT id, parent_id FROM teams WHERE id = ? AND workspace_id = ?'
      ).get(parent_id, workspaceId) as { id: number; parent_id: number | null } | undefined

      if (!parent) {
        return NextResponse.json({ error: 'Parent team not found' }, { status: 404 })
      }
      if (parent.parent_id !== null) {
        return NextResponse.json({ error: 'Maximum hierarchy depth is 2 levels' }, { status: 400 })
      }
    }

    const insertResult = db.prepare(`
      INSERT INTO teams (name, description, parent_id, workspace_id)
      VALUES (?, ?, ?, ?)
    `).run(name, description || null, parent_id || null, workspaceId)

    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(insertResult.lastInsertRowid) as TeamRow

    return NextResponse.json({ team }, { status: 201 })
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return NextResponse.json({ error: 'A team with that name already exists in this workspace' }, { status: 409 })
    }
    logger.error({ err }, 'POST /api/teams error')
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 })
  }
}

/**
 * PUT /api/teams - Update team name/description
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, updateTeamSchema)
    if ('error' in result) return result.error
    const { id, name, description } = result.data

    if (name === undefined && description === undefined) {
      return NextResponse.json({ error: 'At least one of name or description is required' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const existing = db.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(id, workspaceId)
    if (!existing) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    const fields: string[] = []
    const params: (string | number)[] = []

    if (name !== undefined) { fields.push('name = ?'); params.push(name) }
    if (description !== undefined) { fields.push('description = ?'); params.push(description) }
    fields.push('updated_at = unixepoch()')
    params.push(id)

    db.prepare(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`).run(...params)

    const team = db.prepare(`
      SELECT t.*, COUNT(tm.agent_id) as member_count
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      WHERE t.id = ? AND t.workspace_id = ?
      GROUP BY t.id
    `).get(id, workspaceId) as TeamRow

    return NextResponse.json({ team })
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return NextResponse.json({ error: 'A team with that name already exists in this workspace' }, { status: 409 })
    }
    logger.error({ err }, 'PUT /api/teams error')
    return NextResponse.json({ error: 'Failed to update team' }, { status: 500 })
  }
}

/**
 * DELETE /api/teams - Delete a team (CASCADE handles members)
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, deleteTeamSchema)
    if ('error' in result) return result.error
    const { id } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const existing = db.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(id, workspaceId)
    if (!existing) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    db.prepare('DELETE FROM teams WHERE id = ?').run(id)

    return NextResponse.json({ deleted: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/teams error')
    return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 })
  }
}
