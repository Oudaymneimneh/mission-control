import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import {
  type AgentForMeeting,
  type AgentPositionRow,
  parsePersonality,
  getWorkspacePositions,
} from '@/lib/meeting-engine'
import { getPairwiseTrust } from '@/lib/persona-engine'

/**
 * GET /api/meetings/suggestions — Top 5 collaborator suggestions for an agent
 * using the 5-factor partner selection algorithm.
 *
 * Query params: agentId, workspaceId
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = request.nextUrl
  const agentIdStr = searchParams.get('agentId')

  if (!agentIdStr) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
  }

  const agentId = Number(agentIdStr)
  const workspaceId = auth.user.workspace_id ?? 1

  if (!Number.isFinite(agentId)) {
    return NextResponse.json({ error: 'Invalid agentId' }, { status: 400 })
  }

  try {
    const db = getDatabase()

    // Load initiator agent
    const initiator = db.prepare(
      'SELECT id, name, role, status, soul_content, config, workspace_id FROM agents WHERE id = ? AND workspace_id = ?'
    ).get(agentId, workspaceId) as AgentForMeeting | undefined

    if (!initiator) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Get all other agents in the workspace (idle or not — we show scores regardless)
    const candidates = db.prepare(
      'SELECT id, name, role, status, soul_content, config, workspace_id FROM agents WHERE workspace_id = ? AND id != ?'
    ).all(workspaceId, agentId) as AgentForMeeting[]

    if (candidates.length === 0) {
      return NextResponse.json({ data: [] })
    }

    // Batch-load positions
    const allPositions = getWorkspacePositions(db, workspaceId)
    const posMap = new Map<number, AgentPositionRow>(allPositions.map((p) => [p.agent_id, p]))

    // Parse initiator personality once
    const initPersonality = parsePersonality(initiator.config)
    const initiatorPos = posMap.get(initiator.id) ?? null

    // Score each candidate with factor breakdown
    const scored = candidates.map((candidate) => {
      const candPersonality = parsePersonality(candidate.config)
      const candidatePos = posMap.get(candidate.id) ?? null

      // 1. Trust score (0-1)
      const trustData = getPairwiseTrust(db, initiator.id, candidate.id)
      const trust = trustData.trust_score

      // 2. Social compatibility — Big Five similarity
      let compatibility = 0.5
      if (initPersonality && candPersonality) {
        const traits = ['extraversion', 'agreeableness', 'openness', 'conscientiousness', 'neuroticism'] as const
        let totalDiff = 0
        for (const trait of traits) {
          totalDiff += Math.abs(initPersonality[trait] - candPersonality[trait])
        }
        compatibility = 1 - (totalDiff / traits.length)
      }

      // 3. Proximity
      let proximity = 0.5
      if (initiatorPos && candidatePos) {
        const dist = Math.hypot(initiatorPos.x - candidatePos.x, initiatorPos.y - candidatePos.y)
        proximity = Math.max(0, 1 - dist / 80)
      }

      // 4. Novelty
      const recentMeetings = db.prepare(`
        SELECT COUNT(*) as cnt FROM agent_meetings
        WHERE workspace_id = ?
          AND ((initiator_id = ? AND participant_id = ?) OR (initiator_id = ? AND participant_id = ?))
          AND created_at > unixepoch() - 3600
      `).get(workspaceId, initiator.id, candidate.id, candidate.id, initiator.id) as { cnt: number }
      const novelty = Math.max(0, 1 - recentMeetings.cnt * 0.3)

      // 5. Jitter — deterministic for suggestions (use agent ID pair hash for stability)
      const jitter = ((initiator.id * 31 + candidate.id * 17) % 100) / 100

      const totalScore = trust * 0.3 + compatibility * 0.2 + proximity * 0.2 + novelty * 0.2 + jitter * 0.1

      return {
        agentId: candidate.id,
        name: candidate.name,
        totalScore: Math.round(totalScore * 1000) / 1000,
        factors: {
          trust: Math.round(trust * 1000) / 1000,
          compatibility: Math.round(compatibility * 1000) / 1000,
          proximity: Math.round(proximity * 1000) / 1000,
          novelty: Math.round(novelty * 1000) / 1000,
          jitter: Math.round(jitter * 1000) / 1000,
        },
      }
    })

    // Sort by total score descending, take top 5
    scored.sort((a, b) => b.totalScore - a.totalScore)
    const top5 = scored.slice(0, 5)

    return NextResponse.json({ data: top5 })
  } catch {
    return NextResponse.json({ error: 'Failed to get suggestions' }, { status: 500 })
  }
}
