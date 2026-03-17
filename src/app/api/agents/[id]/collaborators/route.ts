import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { suggestCollaborators } from '@/lib/persona-engine'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const agentId = parseInt(id, 10)
  if (Number.isNaN(agentId)) return NextResponse.json({ error: 'Invalid agent ID' }, { status: 400 })

  const workspaceId = auth.user.workspace_id ?? 1
  const limit = Math.min(parseInt(new URL(request.url).searchParams.get('limit') || '5', 10), 20)

  try {
    const db = getDatabase()
    const collaborators = suggestCollaborators(db, agentId, workspaceId, limit)
    return NextResponse.json({ data: collaborators })
  } catch {
    return NextResponse.json({ error: 'Failed to get collaborators' }, { status: 500 })
  }
}
