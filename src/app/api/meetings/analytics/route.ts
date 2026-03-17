import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'

/**
 * GET /api/meetings/analytics — Aggregated meeting metrics for dashboard.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1

  try {
    const db = getDatabase()

    // Meetings per day (last 14 days)
    const meetingsPerDay = db.prepare(`
      SELECT date(created_at, 'unixepoch') as day, COUNT(*) as count
      FROM agent_meetings WHERE workspace_id = ? AND created_at > unixepoch() - 1209600
      GROUP BY day ORDER BY day ASC
    `).all(workspaceId) as Array<{ day: string; count: number }>

    // Average turns per concluded meeting
    const avgTurns = db.prepare(`
      SELECT AVG(turn_count) as avg_turns, AVG(max_turns) as avg_max_turns
      FROM agent_meetings WHERE workspace_id = ? AND status = 'concluded'
    `).get(workspaceId) as { avg_turns: number | null; avg_max_turns: number | null }

    // Top meeting pairs
    const topPairs = db.prepare(`
      SELECT a1.name as initiator_name, a2.name as participant_name, COUNT(*) as meeting_count
      FROM agent_meetings m
      JOIN agents a1 ON m.initiator_id = a1.id
      JOIN agents a2 ON m.participant_id = a2.id
      WHERE m.workspace_id = ? AND m.status = 'concluded'
      GROUP BY m.initiator_id, m.participant_id
      ORDER BY meeting_count DESC LIMIT 10
    `).all(workspaceId) as Array<{ initiator_name: string; participant_name: string; meeting_count: number }>

    // Trust network edges
    const trustNetwork = db.prepare(`
      SELECT t.source_agent_id, t.target_agent_id, t.trust_score, t.interaction_count,
             a1.name as source_name, a2.name as target_name
      FROM agent_pairwise_trust t
      JOIN agents a1 ON t.source_agent_id = a1.id
      JOIN agents a2 ON t.target_agent_id = a2.id
      WHERE t.workspace_id = ?
      ORDER BY t.trust_score DESC
    `).all(workspaceId) as Array<{ source_agent_id: number; target_agent_id: number; trust_score: number; interaction_count: number; source_name: string; target_name: string }>

    // Meetings per agent (both as initiator and participant) with avg duration
    const meetingsPerAgent = db.prepare(`
      SELECT a.name, a.id as agent_id, COUNT(*) as meeting_count,
        AVG(CASE WHEN m.concluded_at IS NOT NULL THEN (m.concluded_at - m.created_at) / 60.0 ELSE NULL END) as avg_duration_min
      FROM (
        SELECT initiator_id as agent_id, id as meeting_id FROM agent_meetings WHERE workspace_id = ? AND status = 'concluded'
        UNION ALL
        SELECT participant_id as agent_id, id as meeting_id FROM agent_meetings WHERE workspace_id = ? AND status = 'concluded'
      ) sub
      JOIN agents a ON sub.agent_id = a.id
      JOIN agent_meetings m ON sub.meeting_id = m.id
      GROUP BY a.id ORDER BY meeting_count DESC
    `).all(workspaceId, workspaceId) as Array<{ name: string; agent_id: number; meeting_count: number; avg_duration_min: number | null }>

    // Trust delta per agent: sum of trust score changes from all pairwise relationships
    // (current trust - 0.5 baseline) summed across all pairs
    const trustDeltas = db.prepare(`
      SELECT agent_id, SUM(delta) as trust_delta FROM (
        SELECT source_agent_id as agent_id, SUM(trust_score - 0.5) as delta
        FROM agent_pairwise_trust WHERE workspace_id = ?
        GROUP BY source_agent_id
        UNION ALL
        SELECT target_agent_id as agent_id, SUM(trust_score - 0.5) as delta
        FROM agent_pairwise_trust WHERE workspace_id = ?
        GROUP BY target_agent_id
      ) sub GROUP BY agent_id
    `).all(workspaceId, workspaceId) as Array<{ agent_id: number; trust_delta: number }>

    const trustDeltaMap = new Map(trustDeltas.map(t => [t.agent_id, t.trust_delta]))

    const meetingsPerAgentEnriched = meetingsPerAgent.map(agent => ({
      name: agent.name,
      meeting_count: agent.meeting_count,
      avg_duration_min: agent.avg_duration_min != null ? Math.round(agent.avg_duration_min * 10) / 10 : null,
      trust_delta: trustDeltaMap.get(agent.agent_id) ?? 0,
    }))

    // Lifetime concluded count (not windowed)
    const totalRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM agent_meetings WHERE workspace_id = ? AND status = ?'
    ).get(workspaceId, 'concluded') as { cnt: number }
    const total_concluded = totalRow.cnt

    // Average quality scores (last 50 concluded meetings with scores)
    const qualityRows = db.prepare(`
      SELECT quality_score FROM agent_meetings
      WHERE workspace_id = ? AND status = 'concluded' AND quality_score IS NOT NULL
      ORDER BY concluded_at DESC LIMIT 50
    `).all(workspaceId) as Array<{ quality_score: string }>

    const qualityScores = qualityRows
      .map(r => { try { return JSON.parse(r.quality_score) } catch { return null } })
      .filter(Boolean)

    const avgQuality = qualityScores.length > 0 ? {
      coherence: qualityScores.reduce((s: number, q: any) => s + q.coherence, 0) / qualityScores.length,
      actionability: qualityScores.reduce((s: number, q: any) => s + q.actionability, 0) / qualityScores.length,
      role_adherence: qualityScores.reduce((s: number, q: any) => s + q.role_adherence, 0) / qualityScores.length,
    } : null

    return NextResponse.json({
      data: {
        meetings_per_day: meetingsPerDay,
        avg_turns: avgTurns.avg_turns ?? 0,
        top_pairs: topPairs,
        trust_network: trustNetwork,
        meetings_per_agent: meetingsPerAgentEnriched,
        avg_quality: avgQuality,
        total_concluded,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to get analytics' }, { status: 500 })
  }
}
