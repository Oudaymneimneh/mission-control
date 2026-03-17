import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { suggestCollaborators } from '@/lib/persona-engine'

function createMockDb() {
  const calls: Array<{ sql: string; stmt: any }> = []
  return {
    prepare: vi.fn((sql: string) => {
      const match = calls.find(c => sql.includes(c.sql))
      if (match) return match.stmt
      return { get: vi.fn(), all: vi.fn().mockReturnValue([]), run: vi.fn() }
    }),
    _when(sql: string, stmt: any) { calls.push({ sql, stmt }) },
  }
}

describe('suggestCollaborators', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns collaborators sorted by trust score', () => {
    const db = createMockDb()
    db._when('agent_pairwise_trust', {
      all: vi.fn().mockReturnValue([
        { target_agent_id: 2, trust_score: 0.9, interaction_count: 5 },
        { target_agent_id: 3, trust_score: 0.6, interaction_count: 2 },
      ]),
    })
    db._when('agents WHERE id IN', {
      all: vi.fn().mockReturnValue([
        { id: 2, name: 'Nova', role: 'researcher', status: 'idle' },
        { id: 3, name: 'Orion', role: 'engineer', status: 'idle' },
      ]),
    })

    const result = suggestCollaborators(db as any, 1, 1)
    expect(result).toHaveLength(2)
    expect(result[0].agent_id).toBe(2)
    expect(result[0].trust_score).toBe(0.9)
    expect(result[1].agent_id).toBe(3)
  })

  it('returns empty array when no trust data', () => {
    const db = createMockDb()
    db._when('agent_pairwise_trust', { all: vi.fn().mockReturnValue([]) })
    const result = suggestCollaborators(db as any, 1, 1)
    expect(result).toHaveLength(0)
  })

  it('filters out agents not found in DB', () => {
    const db = createMockDb()
    db._when('agent_pairwise_trust', {
      all: vi.fn().mockReturnValue([
        { target_agent_id: 2, trust_score: 0.8, interaction_count: 3 },
        { target_agent_id: 99, trust_score: 0.7, interaction_count: 2 },
      ]),
    })
    db._when('agents WHERE id IN', {
      all: vi.fn().mockReturnValue([
        { id: 2, name: 'Nova', role: 'researcher', status: 'idle' },
      ]),
    })

    const result = suggestCollaborators(db as any, 1, 1)
    expect(result).toHaveLength(1)
    expect(result[0].agent_id).toBe(2)
  })
})
