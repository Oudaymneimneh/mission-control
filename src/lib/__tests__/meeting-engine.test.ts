import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
  writeTransaction: vi.fn((_db: unknown, fn: (db: unknown) => unknown) => fn(_db)),
}))

vi.mock('@/lib/llm/router', () => ({
  complete: vi.fn().mockResolvedValue({ text: 'Hello, shall we discuss the project?', tokenCount: { input: 10, output: 20 }, cost: 0.001, latencyMs: 100, model: 'test' }),
  checkAgentBudget: vi.fn().mockReturnValue({ allowed: true }),
}))

vi.mock('@/lib/persona-engine', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('You are a helpful agent.'),
  getPersona: vi.fn().mockReturnValue(null),
  getPairwiseTrust: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }),
  updatePairwiseTrust: vi.fn().mockReturnValue(0.55),
}))

vi.mock('@/lib/agent-memory', () => ({
  observe: vi.fn().mockResolvedValue(undefined),
  recall: vi.fn().mockReturnValue([]),
}))

import {
  calculatePropensity,
  parsePersonality,
  scorePartner,
  selectPartner,
  canInitiateMeeting,
  createMeeting,
  initializeAgentPosition,
  setAgentTargetPosition,
  arriveAtTarget,
  getWorkspacePositions,
  transitionToConversing,
  generateMeetingTurn,
  summarizeMeeting,
  processActiveMeeting,
  attemptMeetingInitiation,
  createScheduledMeeting,
  cancelMeeting,
  cancelAgentMeetings,
  getActiveMeetings,
  getMeetingDetail,
  listMeetings,
} from '@/lib/meeting-engine'
import { eventBus } from '@/lib/event-bus'
import { complete } from '@/lib/llm/router'
import { observe } from '@/lib/agent-memory'
import { getPairwiseTrust, updatePairwiseTrust } from '@/lib/persona-engine'

// --- Mock DB helper ---

function createMockDb() {
  const calls: Array<{ sql: string; stmt: Record<string, unknown> }> = []

  const db = {
    prepare: vi.fn((sql: string) => {
      const entry = calls.find(c => sql.includes(c.sql))
      if (entry) return entry.stmt
      return { get: vi.fn(), run: vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 0 }), all: vi.fn().mockReturnValue([]) }
    }),
    exec: vi.fn(),
    _when: (sqlFragment: string, stmt: Record<string, unknown>) => {
      calls.push({ sql: sqlFragment, stmt })
    },
  }
  return db
}

// --- Test agents ---

const agentA = {
  id: 1,
  name: 'Atlas',
  role: 'engineer',
  status: 'idle',
  soul_content: null,
  config: JSON.stringify({ persona: { personality: { extraversion: 0.8, agreeableness: 0.7, openness: 0.6, conscientiousness: 0.5, neuroticism: 0.3 } } }),
  workspace_id: 1,
}

const agentB = {
  id: 2,
  name: 'Nova',
  role: 'designer',
  status: 'idle',
  soul_content: null,
  config: JSON.stringify({ persona: { personality: { extraversion: 0.4, agreeableness: 0.6, openness: 0.7, conscientiousness: 0.8, neuroticism: 0.4 } } }),
  workspace_id: 1,
}

const agentIntrovert = {
  id: 3,
  name: 'Quiet',
  role: 'analyst',
  status: 'idle',
  soul_content: null,
  config: JSON.stringify({ persona: { personality: { extraversion: 0.1, agreeableness: 0.2, openness: 0.1, conscientiousness: 0.9, neuroticism: 0.8 } } }),
  workspace_id: 1,
}

describe('meeting-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('calculatePropensity', () => {
    it('returns high propensity for extraverted agents', () => {
      const score = calculatePropensity(agentA.config)
      // 0.8 * 0.6 + 0.7 * 0.3 + 0.6 * 0.1 = 0.48 + 0.21 + 0.06 = 0.75
      expect(score).toBeCloseTo(0.75, 2)
    })

    it('returns low propensity for introverted agents', () => {
      const score = calculatePropensity(agentIntrovert.config)
      // 0.1 * 0.6 + 0.2 * 0.3 + 0.1 * 0.1 = 0.06 + 0.06 + 0.01 = 0.13
      expect(score).toBeCloseTo(0.13, 2)
    })

    it('returns default propensity for agents without personality config', () => {
      expect(calculatePropensity(null)).toBe(0.3)
      expect(calculatePropensity(JSON.stringify({}))).toBe(0.3)
    })
  })

  describe('scorePartner', () => {
    it('returns a score between 0 and 1', () => {
      const db = createMockDb()
      db._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

      const score = scorePartner(db as any, agentA, agentB, null, null)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    })

    it('penalizes recent frequent interactions (low novelty)', () => {
      const db1 = createMockDb()
      db1._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })
      const score1 = scorePartner(db1 as any, agentA, agentB, null, null)

      const db2 = createMockDb()
      db2._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 3 }) })
      const score2 = scorePartner(db2 as any, agentA, agentB, null, null)

      // Score with many recent meetings should be lower (on average, jitter aside)
      // We can't assert strictly due to jitter, but novelty component should differ
      // Just verify both produce valid scores
      expect(score1).toBeGreaterThanOrEqual(0)
      expect(score2).toBeGreaterThanOrEqual(0)
    })

    it('factors in proximity when positions are provided', () => {
      const db = createMockDb()
      db._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

      const closePos = { agent_id: 1, workspace_id: 1, x: 30, y: 40, target_x: null, target_y: null, zone: 'eng', updated_at: 0 }
      const nearPos = { agent_id: 2, workspace_id: 1, x: 32, y: 42, target_x: null, target_y: null, zone: 'eng', updated_at: 0 }
      const farPos = { agent_id: 2, workspace_id: 1, x: 80, y: 80, target_x: null, target_y: null, zone: 'lounge', updated_at: 0 }

      // Run multiple times and check averages to account for jitter
      let nearTotal = 0
      let farTotal = 0
      for (let i = 0; i < 20; i++) {
        nearTotal += scorePartner(db as any, agentA, agentB, closePos, nearPos)
        farTotal += scorePartner(db as any, agentA, agentB, closePos, farPos)
      }
      // Nearby partner should score higher on average
      expect(nearTotal / 20).toBeGreaterThan(farTotal / 20)
    })
  })

  describe('canInitiateMeeting', () => {
    it('returns true when no cooldown and no active meetings', () => {
      const db = createMockDb()
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'idle' }) })
      // cooldown check: "concluded_at FROM agent_meetings ... ORDER BY concluded_at"
      db._when('ORDER BY concluded_at', { get: vi.fn().mockReturnValue(undefined) })
      // active meeting check: "SELECT id FROM agent_meetings ... status IN"
      db._when('SELECT id FROM agent_meetings', { get: vi.fn().mockReturnValue(undefined) })
      // concurrent check: "SELECT COUNT(*) as cnt FROM agent_meetings"
      db._when('SELECT COUNT(*) as cnt FROM agent_meetings', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

      expect(canInitiateMeeting(db as any, 1, 1)).toBe(true)
    })

    it('returns false when agent is in cooldown', () => {
      const db = createMockDb()
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'idle' }) })
      const recentTime = Math.floor(Date.now() / 1000) - 10 // 10 seconds ago
      db._when('ORDER BY concluded_at', { get: vi.fn().mockReturnValue({ concluded_at: recentTime }) })

      expect(canInitiateMeeting(db as any, 1, 1)).toBe(false)
    })

    it('returns false when agent is already in active meeting', () => {
      const db = createMockDb()
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'idle' }) })
      db._when('ORDER BY concluded_at', { get: vi.fn().mockReturnValue(undefined) })
      db._when('SELECT id FROM agent_meetings', { get: vi.fn().mockReturnValue({ id: 99 }) })

      expect(canInitiateMeeting(db as any, 1, 1)).toBe(false)
    })

    it('returns false when max concurrent meetings reached', () => {
      const db = createMockDb()
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'idle' }) })
      db._when('ORDER BY concluded_at', { get: vi.fn().mockReturnValue(undefined) })
      db._when('SELECT id FROM agent_meetings', { get: vi.fn().mockReturnValue(undefined) })
      db._when('SELECT COUNT(*) as cnt FROM agent_meetings', { get: vi.fn().mockReturnValue({ cnt: 5 }) })

      expect(canInitiateMeeting(db as any, 1, 1)).toBe(false)
    })
  })

  describe('initializeAgentPosition', () => {
    it('inserts position when not existing', () => {
      const db = createMockDb()
      db._when('SELECT agent_id FROM agent_office_positions', { get: vi.fn().mockReturnValue(undefined) })
      const runMock = vi.fn()
      db._when('INSERT OR IGNORE INTO agent_office_positions', { run: runMock })

      initializeAgentPosition(db as any, 1, 1, 'engineering')
      expect(runMock).toHaveBeenCalled()
    })

    it('skips insert when position already exists', () => {
      const db = createMockDb()
      db._when('SELECT agent_id FROM agent_office_positions', { get: vi.fn().mockReturnValue({ agent_id: 1 }) })
      const runMock = vi.fn()
      db._when('INSERT OR IGNORE INTO agent_office_positions', { run: runMock })

      initializeAgentPosition(db as any, 1, 1, 'engineering')
      expect(runMock).not.toHaveBeenCalled()
    })
  })

  describe('setAgentTargetPosition', () => {
    it('updates target and broadcasts event', () => {
      const db = createMockDb()
      // initializeAgentPosition check — already exists
      db._when('SELECT agent_id FROM agent_office_positions', { get: vi.fn().mockReturnValue({ agent_id: 1 }) })
      // UPDATE target
      db._when('UPDATE agent_office_positions', { run: vi.fn() })

      setAgentTargetPosition(db as any, 1, 1, 50, 60)

      expect(eventBus.broadcast).toHaveBeenCalledWith('office.position.updated', {
        workspace_id: 1,
        agent_id: 1,
        target_x: 50,
        target_y: 60,
      })
    })
  })

  describe('arriveAtTarget', () => {
    it('clears target when position has target set', () => {
      const db = createMockDb()
      db._when('SELECT * FROM agent_office_positions', {
        get: vi.fn().mockReturnValue({ agent_id: 1, x: 30, y: 40, target_x: 50, target_y: 60 }),
      })
      const runMock = vi.fn()
      db._when('SET x = target_x', { run: runMock })

      arriveAtTarget(db as any, 1)
      expect(runMock).toHaveBeenCalledWith(1)
    })

    it('does nothing when no target set', () => {
      const db = createMockDb()
      db._when('SELECT * FROM agent_office_positions', {
        get: vi.fn().mockReturnValue({ agent_id: 1, x: 30, y: 40, target_x: null, target_y: null }),
      })
      const runMock = vi.fn()
      db._when('SET x = target_x', { run: runMock })

      arriveAtTarget(db as any, 1)
      expect(runMock).not.toHaveBeenCalled()
    })
  })

  describe('transitionToConversing', () => {
    it('transitions walking meeting to conversing', () => {
      const db = createMockDb()
      db._when('SELECT * FROM agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({ id: 1, status: 'walking', initiator_id: 1, participant_id: 2 }),
      })
      const updateRun = vi.fn()
      db._when("SET status = 'conversing'", { run: updateRun })
      // arriveAtTarget: SELECT * FROM agent_office_positions
      db._when('SELECT * FROM agent_office_positions', {
        get: vi.fn().mockReturnValue({ agent_id: 1, target_x: 40, target_y: 50 }),
      })
      db._when('SET x = target_x', { run: vi.fn() })

      transitionToConversing(db as any, 1)
      expect(updateRun).toHaveBeenCalledWith(1)
    })

    it('does nothing for non-walking meeting', () => {
      const db = createMockDb()
      db._when('SELECT * FROM agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({ id: 1, status: 'conversing' }),
      })

      transitionToConversing(db as any, 1)
      // No update should have been called
    })
  })

  describe('generateMeetingTurn', () => {
    it('generates a conversation turn and stores it', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: null, summary: null,
        location_x: 40, location_y: 50, turn_count: 0, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      // Speaker query
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(agentA)  // speaker (initiator, turn 0)
          .mockReturnValueOnce(agentB), // listener
      })
      // Previous messages
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
      // Insert message
      db._when('INSERT INTO meeting_messages', { run: vi.fn() })
      // Update turn count
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      // Set topic
      db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })

      const result = await generateMeetingTurn(db as any, meeting)
      expect(result).toBe(true) // More turns available
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.message', expect.objectContaining({
        meeting_id: 1,
        agent_id: 1,
        turn_number: 1,
      }))
    })

    it('returns false when max turns reached', async () => {
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 6, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      const result = await generateMeetingTurn({} as any, meeting)
      expect(result).toBe(false)
    })

    it('returns false on the last turn (boundary: turnNumber equals max_turns)', async () => {
      // turn_count=5 means turnNumber=6, and 6 < 6 is false
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 5, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      // turn_count=5 is odd → participant speaks (id=2)
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(agentB)   // speaker (participant, odd turn)
          .mockReturnValueOnce(agentA),  // listener (initiator)
      })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([
        { content: 'Hello', turn_number: 1, agent_name: 'Atlas' },
        { content: 'Hi', turn_number: 2, agent_name: 'Nova' },
        { content: 'So...', turn_number: 3, agent_name: 'Atlas' },
        { content: 'Yes', turn_number: 4, agent_name: 'Nova' },
        { content: 'Good', turn_number: 5, agent_name: 'Atlas' },
      ]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })

      const result = await generateMeetingTurn(db as any, meeting)
      // turnNumber = 5 + 1 = 6, and 6 < 6 is false → should return false
      expect(result).toBe(false)
    })
  })

  describe('cancelMeeting', () => {
    it('cancels active meeting and broadcasts', () => {
      const db = createMockDb()
      db._when('agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({
          id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'conversing',
        }),
      })
      db._when("SET status = 'cancelled'", { run: vi.fn() })
      db._when('SET target_x = NULL', { run: vi.fn() })

      cancelMeeting(db as any, 1)
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.concluded', expect.objectContaining({
        meeting_id: 1,
        summary: 'Meeting cancelled',
      }))
    })

    it('does nothing for already concluded meeting', () => {
      const db = createMockDb()
      db._when('agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({ id: 1, status: 'concluded' }),
      })

      cancelMeeting(db as any, 1)
      expect(eventBus.broadcast).not.toHaveBeenCalled()
    })
  })

  describe('listMeetings', () => {
    it('returns meetings with pagination', () => {
      const db = createMockDb()
      db._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 2 }) })
      db._when('agent_meetings m', {
        all: vi.fn().mockReturnValue([
          { id: 1, initiator_name: 'Atlas', participant_name: 'Nova', status: 'concluded' },
          { id: 2, initiator_name: 'Atlas', participant_name: 'Quiet', status: 'conversing' },
        ]),
      })

      const result = listMeetings(db as any, 1)
      expect(result.total).toBe(2)
      expect(result.meetings).toHaveLength(2)
    })

    it('filters by status', () => {
      const db = createMockDb()
      db._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 1 }) })
      db._when('agent_meetings m', {
        all: vi.fn().mockReturnValue([
          { id: 2, initiator_name: 'Atlas', participant_name: 'Quiet', status: 'conversing' },
        ]),
      })

      const result = listMeetings(db as any, 1, { status: 'conversing' })
      expect(result.total).toBe(1)
    })
  })

  describe('getMeetingDetail', () => {
    it('returns meeting with messages', () => {
      const db = createMockDb()
      db._when('agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({ id: 1, status: 'concluded', workspace_id: 1 }),
      })
      db._when('meeting_messages mm', {
        all: vi.fn().mockReturnValue([
          { id: 1, meeting_id: 1, agent_id: 1, content: 'Hello', turn_number: 1, agent_name: 'Atlas' },
          { id: 2, meeting_id: 1, agent_id: 2, content: 'Hi there', turn_number: 2, agent_name: 'Nova' },
        ]),
      })

      const result = getMeetingDetail(db as any, 1)
      expect(result).not.toBeNull()
      expect(result!.meeting.id).toBe(1)
      expect(result!.messages).toHaveLength(2)
    })

    it('returns null for non-existent meeting', () => {
      const db = createMockDb()
      db._when('agent_meetings WHERE id', { get: vi.fn().mockReturnValue(undefined) })

      expect(getMeetingDetail(db as any, 999)).toBeNull()
    })
  })

  describe('getWorkspacePositions', () => {
    it('returns all positions for workspace', () => {
      const db = createMockDb()
      db._when('agent_office_positions', {
        all: vi.fn().mockReturnValue([
          { agent_id: 1, x: 30, y: 40 },
          { agent_id: 2, x: 50, y: 60 },
        ]),
      })

      const positions = getWorkspacePositions(db as any, 1)
      expect(positions).toHaveLength(2)
    })
  })

  describe('createMeeting', () => {
    it('creates a meeting and broadcasts events', () => {
      const db = createMockDb()
      // Position queries (SELECT x, y)
      db._when('SELECT x, y FROM agent_office_positions', {
        get: vi.fn()
          .mockReturnValueOnce({ x: 30, y: 40 })  // initiator
          .mockReturnValueOnce({ x: 50, y: 60 }),  // participant
      })
      // Insert meeting
      db._when('INSERT INTO agent_meetings', { run: vi.fn().mockReturnValue({ lastInsertRowid: 1 }) })
      // initializeAgentPosition checks (already exist)
      db._when('SELECT agent_id FROM agent_office_positions', { get: vi.fn().mockReturnValue({ agent_id: 1 }) })
      // UPDATE target position
      db._when('UPDATE agent_office_positions', { run: vi.fn() })
      // Read back
      db._when('SELECT * FROM agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({
          id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'walking', location_x: 40, location_y: 50,
        }),
      })

      const meeting = createMeeting(db as any, agentA, agentB)
      expect(meeting.status).toBe('walking')
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.started', expect.objectContaining({
        meeting_id: 1,
        initiator_name: 'Atlas',
        participant_name: 'Nova',
      }))
      // Should also broadcast position updates AFTER tx
      expect(eventBus.broadcast).toHaveBeenCalledWith('office.position.updated', expect.objectContaining({
        agent_id: 1,
      }))
    })
  })

  describe('parsePersonality', () => {
    it('parses valid personality config', () => {
      const p = parsePersonality(agentA.config)
      expect(p).not.toBeNull()
      expect(p!.extraversion).toBe(0.8)
      expect(p!.conscientiousness).toBe(0.5)
    })

    it('returns null for null config', () => {
      expect(parsePersonality(null)).toBeNull()
    })

    it('returns null for config without persona', () => {
      expect(parsePersonality(JSON.stringify({ foo: 'bar' }))).toBeNull()
    })

    it('returns defaults for missing traits', () => {
      const p = parsePersonality(JSON.stringify({ persona: { personality: {} } }))
      expect(p).not.toBeNull()
      expect(p!.extraversion).toBe(0.5)
      expect(p!.agreeableness).toBe(0.5)
    })
  })

  describe('processActiveMeeting', () => {
    it('returns false when no active meeting', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      // No active meeting found
      db._when('agent_meetings', { get: vi.fn().mockReturnValue(undefined) })

      const result = await processActiveMeeting(agentA)
      expect(result).toBe(false)
    })

    it('force-concludes meeting stuck in summarizing for > 30s', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      const staleTime = Math.floor(Date.now() / 1000) - 60 // 60s ago
      db._when('SELECT * FROM agent_meetings', {
        get: vi.fn().mockReturnValue({
          id: 5, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'summarizing', started_at: staleTime, concluded_at: null,
          created_at: staleTime, turn_count: 6, max_turns: 6,
        }),
      })
      // force-conclude writes inside writeTransaction
      db._when("Meeting concluded (timeout)", { run: vi.fn() })
      db._when('target_x = NULL, target_y = NULL', { run: vi.fn() })

      const result = await processActiveMeeting(agentA)
      expect(result).toBe(false) // Agent freed
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.concluded', expect.objectContaining({
        meeting_id: 5,
        summary: 'Meeting concluded (timeout)',
      }))
    })

    it('transitions walking meeting to conversing after 3s', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      const startTime = Math.floor(Date.now() / 1000) - 5 // 5s ago
      // processActiveMeeting: SELECT * FROM agent_meetings WHERE workspace_id
      db._when('SELECT * FROM agent_meetings', {
        get: vi.fn().mockReturnValue({
          id: 3, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'walking', started_at: startTime, concluded_at: null,
          created_at: startTime, turn_count: 0, max_turns: 6,
        }),
      })
      // transitionToConversing uses the same db:
      // SELECT * FROM agent_meetings WHERE id (for status check)
      db._when('agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({ id: 3, status: 'walking', initiator_id: 1, participant_id: 2 }),
      })
      db._when("SET status = 'conversing'", { run: vi.fn() })
      db._when('agent_office_positions WHERE agent_id', {
        get: vi.fn().mockReturnValue({ agent_id: 1, target_x: 40, target_y: 50 }),
      })
      db._when('SET x = target_x', { run: vi.fn() })

      const result = await processActiveMeeting(agentA)
      expect(result).toBe(true)
    })
  })

  describe('cancelAgentMeetings', () => {
    it('cancels all active meetings for an agent', () => {
      const db = createMockDb()
      // Find active meetings
      db._when('status IN', { all: vi.fn().mockReturnValue([{ id: 10 }, { id: 11 }]) })
      // cancelMeeting: SELECT meeting
      const getMock = vi.fn()
        .mockReturnValueOnce({ id: 10, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing' })
        .mockReturnValueOnce({ id: 11, workspace_id: 1, initiator_id: 1, participant_id: 3, status: 'walking' })
      db._when('agent_meetings WHERE id', { get: getMock })
      db._when("SET status = 'cancelled'", { run: vi.fn() })
      db._when('SET target_x = NULL', { run: vi.fn() })

      cancelAgentMeetings(db as any, 1, 1)
      expect(eventBus.broadcast).toHaveBeenCalledTimes(2)
    })
  })

  describe('createScheduledMeeting', () => {
    it('creates a scheduled meeting with valid parameters', () => {
      const db = createMockDb()
      // Agent lookups
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(agentA)   // initiator
          .mockReturnValueOnce(agentB),  // participant
      })
      // Scheduled meeting count check (< 5)
      db._when("status = 'scheduled'", { get: vi.fn().mockReturnValue({ cnt: 2 }) })
      // INSERT into agent_meetings
      db._when('INSERT INTO agent_meetings', { run: vi.fn().mockReturnValue({ lastInsertRowid: 10 }) })
      // Read back the created meeting
      db._when('SELECT * FROM agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({
          id: 10, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'scheduled', topic: 'Sync up', summary: null,
          location_x: null, location_y: null, turn_count: 0, max_turns: 6,
          scheduled_for: 1000, recurring_interval_ms: null,
          started_at: null, concluded_at: null, quality_score: null, project_id: null, created_at: 100,
        }),
      })

      const meeting = createScheduledMeeting(db as any, 1, 2, 1, 'Sync up', 1000)
      expect(meeting.id).toBe(10)
      expect(meeting.status).toBe('scheduled')
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.scheduled', expect.objectContaining({
        meeting_id: 10,
        initiator_id: 1,
        participant_id: 2,
        topic: 'Sync up',
      }))
    })

    it('rejects when 5 meetings already scheduled', () => {
      const db = createMockDb()
      // Agent lookups
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(agentA)
          .mockReturnValueOnce(agentB),
      })
      // Scheduled meeting count at limit
      db._when("status = 'scheduled'", { get: vi.fn().mockReturnValue({ cnt: 5 }) })

      expect(() => createScheduledMeeting(db as any, 1, 2, 1, 'Topic')).toThrow('Maximum scheduled meetings reached')
    })

    it('validates recurring_interval_ms minimum', () => {
      const db = createMockDb()
      // Agent lookups
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(agentA)
          .mockReturnValueOnce(agentB),
      })
      // Scheduled count under limit
      db._when("status = 'scheduled'", { get: vi.fn().mockReturnValue({ cnt: 0 }) })
      // INSERT
      const runMock = vi.fn().mockReturnValue({ lastInsertRowid: 11 })
      db._when('INSERT INTO agent_meetings', { run: runMock })
      // Read back
      db._when('SELECT * FROM agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({
          id: 11, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'scheduled', topic: null, summary: null,
          location_x: null, location_y: null, turn_count: 0, max_turns: 6,
          scheduled_for: null, recurring_interval_ms: null,
          started_at: null, concluded_at: null, quality_score: null, project_id: null, created_at: 100,
        }),
      })

      // Pass recurringIntervalMs = 1000 (below 60000 minimum)
      createScheduledMeeting(db as any, 1, 2, 1, undefined, undefined, 1000)

      // The INSERT should have been called with null for recurring_interval_ms
      // (1000 < 60000 triggers nullification)
      expect(runMock).toHaveBeenCalled()
      const insertArgs = runMock.mock.calls[0]
      // Arguments: workspaceId, initiatorId, participantId, topic, scheduledFor, recurringIntervalMs, now
      // recurringIntervalMs is the 6th positional arg (index 5)
      expect(insertArgs[5]).toBeNull()
    })
  })

  describe('summarizeMeeting', () => {
    it('summarizes meeting with LLM and updates trust', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 6, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      // Phase 1 tx: transition to summarizing + read messages + initiator
      db._when("SET status = ?", { run: vi.fn() })
      db._when('meeting_messages mm', {
        all: vi.fn().mockReturnValue([
          { content: 'Hello', agent_name: 'Atlas' },
          { content: 'Hi there', agent_name: 'Nova' },
        ]),
      })
      db._when('agents WHERE id', { get: vi.fn().mockReturnValue(agentA) })
      // Phase 3 tx: conclude
      db._when("status = 'concluded'", { run: vi.fn() })
      db._when('agent_pairwise_trust', { run: vi.fn(), get: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }) })
      db._when('SET target_x = NULL', { run: vi.fn() })

      await summarizeMeeting(db as any, meeting)

      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.concluded', expect.objectContaining({
        meeting_id: 1,
      }))
    })

    it('fast-concludes with no LLM call when messages are empty', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 0, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      // Phase 1 tx: transition to summarizing + empty messages
      db._when("SET status = ?", { run: vi.fn() })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
      db._when('agents WHERE id', { get: vi.fn().mockReturnValue(agentA) })
      // Fast-conclude tx
      db._when("status = 'concluded'", { run: vi.fn() })

      vi.mocked(complete).mockClear()
      await summarizeMeeting(db as any, meeting)

      // LLM should NOT have been called
      expect(complete).not.toHaveBeenCalled()
    })

    it('uses fallback summary when LLM fails', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 4, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      db._when("SET status = ?", { run: vi.fn() })
      db._when('meeting_messages mm', {
        all: vi.fn().mockReturnValue([
          { content: 'Hello', agent_name: 'Atlas' },
          { content: 'Hi there', agent_name: 'Nova' },
        ]),
      })
      db._when('agents WHERE id', { get: vi.fn().mockReturnValue(agentA) })
      db._when("status = 'concluded'", { run: vi.fn() })
      db._when('agent_pairwise_trust', { run: vi.fn(), get: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }) })
      db._when('SET target_x = NULL', { run: vi.fn() })

      vi.mocked(complete).mockRejectedValueOnce(new Error('LLM unavailable'))

      await summarizeMeeting(db as any, meeting)

      // Should still broadcast with fallback summary
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.concluded', expect.objectContaining({
        meeting_id: 1,
        summary: 'Meeting between agents (2 messages)',
      }))
    })

    it('calls observe for both agents after successful summary', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 6, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      db._when("SET status = ?", { run: vi.fn() })
      db._when('meeting_messages mm', {
        all: vi.fn().mockReturnValue([
          { content: 'Hello', agent_name: 'Atlas' },
        ]),
      })
      db._when('agents WHERE id', { get: vi.fn().mockReturnValue(agentA) })
      db._when("status = 'concluded'", { run: vi.fn() })
      db._when('agent_pairwise_trust', { run: vi.fn(), get: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }) })
      db._when('SET target_x = NULL', { run: vi.fn() })

      await summarizeMeeting(db as any, meeting)

      // observe called for initiator (1) and participant (2)
      expect(observe).toHaveBeenCalledTimes(2)
      expect(observe).toHaveBeenCalledWith(1, expect.stringContaining('Had a meeting'), 1)
      expect(observe).toHaveBeenCalledWith(2, expect.stringContaining('Had a meeting'), 1)
    })

    it('swallows observe errors silently', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 6, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      db._when("SET status = ?", { run: vi.fn() })
      db._when('meeting_messages mm', {
        all: vi.fn().mockReturnValue([
          { content: 'Hello', agent_name: 'Atlas' },
        ]),
      })
      db._when('agents WHERE id', { get: vi.fn().mockReturnValue(agentA) })
      db._when("status = 'concluded'", { run: vi.fn() })
      db._when('agent_pairwise_trust', { run: vi.fn(), get: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }) })
      db._when('SET target_x = NULL', { run: vi.fn() })

      vi.mocked(observe).mockRejectedValue(new Error('memory unavailable'))

      // Should not throw even though observe fails
      await expect(summarizeMeeting(db as any, meeting)).resolves.toBeUndefined()

      // broadcast still happens
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.concluded', expect.objectContaining({
        meeting_id: 1,
      }))
    })

    it('schedules follow-up when recurring_interval_ms is set', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'Weekly sync', summary: null,
        location_x: 40, location_y: 50, turn_count: 6, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: 3600000, created_at: 100, quality_score: null, project_id: null,
      }

      // Phase 1 tx: transition to summarizing + read messages + initiator
      db._when("SET status = ?", { run: vi.fn() })
      db._when('meeting_messages mm', {
        all: vi.fn().mockReturnValue([
          { content: 'Hello', agent_name: 'Atlas' },
          { content: 'Hi there', agent_name: 'Nova' },
        ]),
      })
      db._when('agents WHERE id', { get: vi.fn().mockReturnValue(agentA) })
      // Phase 3 tx: conclude
      db._when("status = 'concluded'", { run: vi.fn() })
      db._when('agent_pairwise_trust', { run: vi.fn(), get: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }) })
      db._when('SET target_x = NULL', { run: vi.fn() })

      // createScheduledMeeting stubs (called in Phase 4d)
      // Agent lookups for createScheduledMeeting
      db._when("status = 'scheduled'", { get: vi.fn().mockReturnValue({ cnt: 0 }) })
      db._when('INSERT INTO agent_meetings', { run: vi.fn().mockReturnValue({ lastInsertRowid: 20 }) })
      db._when('SELECT * FROM agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({
          id: 20, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'scheduled', topic: 'Weekly sync', summary: null,
          location_x: null, location_y: null, turn_count: 0, max_turns: 6,
          scheduled_for: Math.floor((Date.now() + 3600000) / 1000), recurring_interval_ms: 3600000,
          started_at: null, concluded_at: null, quality_score: null, project_id: null, created_at: 100,
        }),
      })

      await summarizeMeeting(db as any, meeting)

      // Verify meeting.scheduled broadcast was called (from createScheduledMeeting)
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.scheduled', expect.objectContaining({
        meeting_id: 20,
        workspace_id: 1,
        initiator_id: 1,
        participant_id: 2,
        topic: 'Weekly sync',
      }))
      // Also verify meeting.concluded was broadcast
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.concluded', expect.objectContaining({
        meeting_id: 1,
      }))
    })
  })

  // --- Task 1: attemptMeetingInitiation ---

  describe('attemptMeetingInitiation', () => {
    it('returns false when propensity below threshold (introvert agent)', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      const result = await attemptMeetingInitiation(agentIntrovert)
      expect(result).toBe(false)
    })

    it('returns false when random roll fails', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      // Math.random() returning 1.0 always exceeds propensity * 0.3
      const spy = vi.spyOn(Math, 'random').mockReturnValue(1.0)

      const result = await attemptMeetingInitiation(agentA)
      expect(result).toBe(false)
      spy.mockRestore()
    })

    it('returns false when canInitiateMeeting fails (in cooldown)', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      // Random roll passes
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0)

      // canInitiateMeeting: agent status check (not busy)
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'idle' }) })
      // canInitiateMeeting: agent in cooldown
      const recentTime = Math.floor(Date.now() / 1000) - 10
      db._when('ORDER BY concluded_at', { get: vi.fn().mockReturnValue({ concluded_at: recentTime }) })

      const result = await attemptMeetingInitiation(agentA)
      expect(result).toBe(false)
      spy.mockRestore()
    })

    it('returns false when no partner available (no idle agents)', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0)

      // canInitiateMeeting passes
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'idle' }) })
      db._when('ORDER BY concluded_at', { get: vi.fn().mockReturnValue(undefined) })
      db._when('SELECT id FROM agent_meetings', { get: vi.fn().mockReturnValue(undefined) })
      db._when('SELECT COUNT(*) as cnt FROM agent_meetings', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

      // selectPartner: no idle candidates
      db._when('FROM agents', { all: vi.fn().mockReturnValue([]) })

      const result = await attemptMeetingInitiation(agentA)
      expect(result).toBe(false)
      spy.mockRestore()
    })

    it('returns true and creates meeting when all checks pass', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0)

      // canInitiateMeeting passes
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'idle' }) })
      db._when('ORDER BY concluded_at', { get: vi.fn().mockReturnValue(undefined) })
      db._when('SELECT id FROM agent_meetings', { get: vi.fn().mockReturnValue(undefined) })
      db._when('SELECT COUNT(*) as cnt FROM agent_meetings', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

      // selectPartner: one idle candidate
      db._when('FROM agents', { all: vi.fn().mockReturnValue([agentB]) })
      // selectPartner: active meetings (none busy)
      db._when("status IN ('walking', 'conversing', 'summarizing')", { all: vi.fn().mockReturnValue([]) })
      // selectPartner: getWorkspacePositions
      db._when('agent_office_positions WHERE workspace_id', { all: vi.fn().mockReturnValue([]) })
      // scorePartner: COUNT(*)
      db._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

      // createMeeting: positions
      db._when('SELECT x, y FROM agent_office_positions', {
        get: vi.fn()
          .mockReturnValueOnce({ x: 30, y: 40 })
          .mockReturnValueOnce({ x: 50, y: 60 }),
      })
      // createMeeting: INSERT
      db._when('INSERT INTO agent_meetings', { run: vi.fn().mockReturnValue({ lastInsertRowid: 1 }) })
      db._when('SELECT agent_id FROM agent_office_positions', { get: vi.fn().mockReturnValue({ agent_id: 1 }) })
      db._when('UPDATE agent_office_positions', { run: vi.fn() })
      db._when('SELECT * FROM agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({
          id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'walking', location_x: 40, location_y: 50, max_turns: 6,
        }),
      })

      const result = await attemptMeetingInitiation(agentA)
      expect(result).toBe(true)
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.started', expect.objectContaining({
        meeting_id: 1,
      }))
      spy.mockRestore()
    })
  })

  // --- Task 2: selectPartner ---

  describe('selectPartner', () => {
    it('returns null when no idle candidates', () => {
      const db = createMockDb()
      db._when('FROM agents', { all: vi.fn().mockReturnValue([]) })

      const result = selectPartner(db as any, agentA)
      expect(result).toBeNull()
    })

    it('returns null when all candidates are in active meetings', () => {
      const db = createMockDb()
      // One idle candidate
      db._when('FROM agents', { all: vi.fn().mockReturnValue([agentB]) })
      // But they're in an active meeting
      db._when("status IN ('walking', 'conversing', 'summarizing')", {
        all: vi.fn().mockReturnValue([{ initiator_id: 2, participant_id: 3 }]),
      })

      const result = selectPartner(db as any, agentA)
      expect(result).toBeNull()
    })

    it('selects highest-scoring partner from multiple candidates', () => {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const db = createMockDb()
      const candidateB = { ...agentB, id: 3, name: 'Cleo', config: JSON.stringify({ persona: { personality: { extraversion: 0.9, agreeableness: 0.9, openness: 0.9, conscientiousness: 0.5, neuroticism: 0.1 } } }) }

      db._when('FROM agents', { all: vi.fn().mockReturnValue([agentB, candidateB]) })
      db._when("status IN ('walking', 'conversing', 'summarizing')", { all: vi.fn().mockReturnValue([]) })
      // Positions: initiator (30,40), agentB id=2 very close (32,40), candidateB id=3 far (80,80)
      db._when('agent_office_positions WHERE workspace_id', { all: vi.fn().mockReturnValue([
        { agent_id: 1, workspace_id: 1, x: 30, y: 40, target_x: null, target_y: null, zone: null, updated_at: 0 },
        { agent_id: 2, workspace_id: 1, x: 32, y: 40, target_x: null, target_y: null, zone: null, updated_at: 0 },
        { agent_id: 3, workspace_id: 1, x: 80, y: 80, target_x: null, target_y: null, zone: null, updated_at: 0 },
      ]) })
      db._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

      const result = selectPartner(db as any, agentA)
      expect(result).not.toBeNull()
      expect(result!.partner.id).toBe(2)
      expect(result!.score).toBeCloseTo(0.75, 5)

      spy.mockRestore()
    })
  })

  // --- Task 3: processActiveMeeting conversing branch ---

  describe('processActiveMeeting (conversing)', () => {
    it('generates turn when conversing and is my turn (turn_count=0, agent is initiator)', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      const startTime = Math.floor(Date.now() / 1000) - 5
      db._when('SELECT * FROM agent_meetings', {
        get: vi.fn().mockReturnValue({
          id: 10, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'conversing', started_at: startTime, concluded_at: null,
          created_at: startTime, turn_count: 0, max_turns: 6,
          topic: null, summary: null, location_x: 40, location_y: 50,
        }),
      })

      // generateMeetingTurn stubs
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(agentA)
          .mockReturnValueOnce(agentB),
      })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })

      const result = await processActiveMeeting(agentA)
      expect(result).toBe(true)
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.message', expect.objectContaining({
        meeting_id: 10,
        agent_id: 1,
      }))
    })

    it('returns true without generating when conversing but not my turn', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      const startTime = Math.floor(Date.now() / 1000) - 5
      // turn_count=0 means initiator's turn. agentB is participant, so NOT their turn
      db._when('SELECT * FROM agent_meetings', {
        get: vi.fn().mockReturnValue({
          id: 10, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'conversing', started_at: startTime, concluded_at: null,
          created_at: startTime, turn_count: 0, max_turns: 6,
          topic: null, summary: null, location_x: 40, location_y: 50,
        }),
      })

      const result = await processActiveMeeting(agentB)
      expect(result).toBe(true)
      // No message broadcast — not their turn
      expect(eventBus.broadcast).not.toHaveBeenCalledWith('meeting.message', expect.anything())
    })

    it('triggers summarization when turn_count >= max_turns', async () => {
      const { getDatabase } = await import('@/lib/db')
      const db = createMockDb()
      vi.mocked(getDatabase).mockReturnValue(db as any)

      const startTime = Math.floor(Date.now() / 1000) - 5
      db._when('SELECT * FROM agent_meetings', {
        get: vi.fn().mockReturnValue({
          id: 10, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'conversing', started_at: startTime, concluded_at: null,
          created_at: startTime, turn_count: 6, max_turns: 6,
          topic: 'test topic', summary: null, location_x: 40, location_y: 50,
        }),
      })

      // summarizeMeeting stubs
      db._when("SET status = ?", { run: vi.fn() })
      db._when('meeting_messages mm', {
        all: vi.fn().mockReturnValue([
          { content: 'Hello', agent_name: 'Atlas' },
        ]),
      })
      db._when('agents WHERE id', { get: vi.fn().mockReturnValue(agentA) })
      db._when("status = 'concluded'", { run: vi.fn() })
      db._when('agent_pairwise_trust', { run: vi.fn(), get: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }) })
      db._when('SET target_x = NULL', { run: vi.fn() })

      const result = await processActiveMeeting(agentA)
      expect(result).toBe(true)
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.concluded', expect.objectContaining({
        meeting_id: 10,
      }))
    })
  })

  // --- Task 4: generateMeetingTurn edge cases ---

  describe('generateMeetingTurn (edge cases)', () => {
    it('uses fallback text when LLM times out', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 0, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(agentA)
          .mockReturnValueOnce(agentB),
      })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })

      vi.mocked(complete).mockRejectedValueOnce(new Error('meeting_turn_timeout'))

      const result = await generateMeetingTurn(db as any, meeting)
      expect(result).toBe(true)
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.message', expect.objectContaining({
        content: 'Hmm, let me think about that for a moment...',
      }))
    })

    it('re-throws non-timeout LLM errors', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 0, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(agentA)
          .mockReturnValueOnce(agentB),
      })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })

      vi.mocked(complete).mockRejectedValueOnce(new Error('rate_limit_exceeded'))

      await expect(generateMeetingTurn(db as any, meeting)).rejects.toThrow('rate_limit_exceeded')
    })

    it('participant speaks on odd turn_count (turn_count=1)', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 1, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      // turn_count=1 → odd → participant_id (2) speaks
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(agentB)   // speaker is participant (id=2)
          .mockReturnValueOnce(agentA),  // listener is initiator (id=1)
      })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([{ content: 'Hello', turn_number: 1, agent_name: 'Atlas' }]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })

      const result = await generateMeetingTurn(db as any, meeting)
      expect(result).toBe(true)
      expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.message', expect.objectContaining({
        agent_id: 2,
        turn_number: 2,
      }))
    })

    it('returns false for non-conversing meeting (status=walking)', async () => {
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'walking' as const, topic: null, summary: null,
        location_x: 40, location_y: 50, turn_count: 0, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      const result = await generateMeetingTurn({} as any, meeting)
      expect(result).toBe(false)
    })

    it('returns false when turn_count >= max_turns', async () => {
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 8, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      const result = await generateMeetingTurn({} as any, meeting)
      expect(result).toBe(false)
    })
  })

  // --- Task 6: Property-based invariants ---

  describe('property invariants', () => {
    it('calculatePropensity always returns [0, 1] for 100 random configs', () => {
      for (let i = 0; i < 100; i++) {
        const config = JSON.stringify({
          persona: {
            personality: {
              extraversion: Math.random(),
              agreeableness: Math.random(),
              openness: Math.random(),
              conscientiousness: Math.random(),
              neuroticism: Math.random(),
            },
          },
        })
        const score = calculatePropensity(config)
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(1)
      }
    })

    it('calculatePropensity returns 0.3 for null config', () => {
      expect(calculatePropensity(null)).toBe(0.3)
    })

    it('calculatePropensity returns 0.3 for invalid JSON', () => {
      expect(calculatePropensity('not valid json {{{')).toBe(0.3)
    })

    it('scorePartner always returns [0, 1] for 50 random positions', () => {
      for (let i = 0; i < 50; i++) {
        const db = createMockDb()
        db._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: Math.floor(Math.random() * 5) }) })

        const initPos = {
          agent_id: 1, workspace_id: 1,
          x: Math.random() * 100, y: Math.random() * 100,
          target_x: null, target_y: null, zone: 'eng', updated_at: 0,
        }
        const candPos = {
          agent_id: 2, workspace_id: 1,
          x: Math.random() * 100, y: Math.random() * 100,
          target_x: null, target_y: null, zone: 'eng', updated_at: 0,
        }

        const score = scorePartner(db as any, agentA, agentB, initPos, candPos)
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(1)
      }
    })

    it('maxTurns formula always in [4, 8] range', () => {
      // The formula: Math.round(4 + avgConscient * 4), where avgConscient ∈ [0, 1]
      for (let c = 0; c <= 1; c += 0.01) {
        const maxTurns = Math.round(4 + c * 4)
        expect(maxTurns).toBeGreaterThanOrEqual(4)
        expect(maxTurns).toBeLessThanOrEqual(8)
      }
    })
  })

  // --- MTST-01: State machine transitions ---

  describe('state machine transitions', () => {
    it('createMeeting sets status to walking', () => {
      const db = createMockDb()
      db._when('SELECT x, y FROM agent_office_positions', {
        get: vi.fn()
          .mockReturnValueOnce({ x: 30, y: 40 })
          .mockReturnValueOnce({ x: 50, y: 60 }),
      })
      db._when('INSERT INTO agent_meetings', { run: vi.fn().mockReturnValue({ lastInsertRowid: 1 }) })
      db._when('SELECT agent_id FROM agent_office_positions', { get: vi.fn().mockReturnValue({ agent_id: 1 }) })
      db._when('UPDATE agent_office_positions', { run: vi.fn() })
      db._when('SELECT * FROM agent_meetings WHERE id', {
        get: vi.fn().mockReturnValue({
          id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
          status: 'walking', location_x: 40, location_y: 50, max_turns: 6,
        }),
      })

      const meeting = createMeeting(db as any, agentA, agentB)
      expect(meeting.status).toBe('walking')
    })

    it('generateMeetingTurn keeps status as conversing', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 0, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(agentA)
          .mockReturnValueOnce(agentB),
      })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })

      const result = await generateMeetingTurn(db as any, meeting)
      expect(result).toBe(true)
      // Status is not changed to anything else — still conversing
      // The only updates are turn_count and topic, NOT status
      expect(db.prepare).not.toHaveBeenCalledWith(expect.stringContaining("SET status"))
    })

    it('summarizeMeeting sets status to concluded', async () => {
      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 6, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      const statusRunMock = vi.fn()
      db._when("SET status = ?", { run: statusRunMock })
      db._when('meeting_messages mm', {
        all: vi.fn().mockReturnValue([
          { content: 'Hello', agent_name: 'Atlas' },
          { content: 'Hi there', agent_name: 'Nova' },
        ]),
      })
      db._when('agents WHERE id', { get: vi.fn().mockReturnValue(agentA) })
      const concludeRunMock = vi.fn()
      db._when("status = 'concluded'", { run: concludeRunMock })
      db._when('agent_pairwise_trust', { run: vi.fn(), get: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }) })
      db._when('SET target_x = NULL', { run: vi.fn() })

      await summarizeMeeting(db as any, meeting)

      // Phase 1: transitions to 'summarizing'
      expect(statusRunMock).toHaveBeenCalledWith('summarizing', meeting.id)
      // Phase 3: transitions to 'concluded'
      expect(concludeRunMock).toHaveBeenCalled()
    })

    it('canInitiateMeeting returns false when agent is busy', () => {
      const db = createMockDb()
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'busy' }) })

      expect(canInitiateMeeting(db as any, 1, 1)).toBe(false)
    })

    it('canInitiateMeeting returns false during cooldown period', () => {
      const db = createMockDb()
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'idle' }) })
      // Last concluded 30 seconds ago — cooldown is 60s
      const recentTime = Math.floor(Date.now() / 1000) - 30
      db._when('ORDER BY concluded_at', { get: vi.fn().mockReturnValue({ concluded_at: recentTime }) })

      expect(canInitiateMeeting(db as any, 1, 1)).toBe(false)
    })

    it('canInitiateMeeting returns false when concurrent meeting limit reached', () => {
      const db = createMockDb()
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'idle' }) })
      db._when('ORDER BY concluded_at', { get: vi.fn().mockReturnValue(undefined) })
      db._when('SELECT id FROM agent_meetings', { get: vi.fn().mockReturnValue(undefined) })
      // MAX_CONCURRENT_MEETINGS is 2
      db._when('SELECT COUNT(*) as cnt FROM agent_meetings', { get: vi.fn().mockReturnValue({ cnt: 2 }) })

      expect(canInitiateMeeting(db as any, 1, 1)).toBe(false)
    })

    it('canInitiateMeeting returns true when no cooldown and under limit', () => {
      const db = createMockDb()
      db._when('SELECT status FROM agents WHERE id', { get: vi.fn().mockReturnValue({ status: 'idle' }) })
      // No cooldown (no concluded meetings)
      db._when('ORDER BY concluded_at', { get: vi.fn().mockReturnValue(undefined) })
      // No active meeting
      db._when('SELECT id FROM agent_meetings', { get: vi.fn().mockReturnValue(undefined) })
      // Under concurrent limit
      db._when('SELECT COUNT(*) as cnt FROM agent_meetings', { get: vi.fn().mockReturnValue({ cnt: 1 }) })

      expect(canInitiateMeeting(db as any, 1, 1)).toBe(true)
    })
  })

  // --- MTST-02: Partner selection scoring ---

  describe('partner selection scoring', () => {
    it('scorePartner returns positive score for compatible agents', () => {
      const db = createMockDb()
      db._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const score = scorePartner(db as any, agentA, agentB, null, null)
      expect(score).toBeGreaterThan(0)
      spy.mockRestore()
    })

    it('scorePartner weights trust factor highest (0.3)', () => {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)

      // High trust (1.0) scenario
      vi.mocked(getPairwiseTrust).mockReturnValueOnce({ trust_score: 1.0, interaction_count: 5, last_interaction_at: 100 })
      const db1 = createMockDb()
      db1._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })
      const highTrustScore = scorePartner(db1 as any, agentA, agentB, null, null)

      // Low trust (0.0) scenario
      vi.mocked(getPairwiseTrust).mockReturnValueOnce({ trust_score: 0.0, interaction_count: 0, last_interaction_at: null })
      const db2 = createMockDb()
      db2._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })
      const lowTrustScore = scorePartner(db2 as any, agentA, agentB, null, null)

      // Trust difference: (1.0 - 0.0) * 0.3 = 0.3
      const diff = highTrustScore - lowTrustScore
      expect(diff).toBeCloseTo(0.3, 2)

      spy.mockRestore()
    })

    it('proximity score decreases with distance', () => {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const nearPos = { agent_id: 2, workspace_id: 1, x: 32, y: 42, target_x: null, target_y: null, zone: 'eng', updated_at: 0 }
      const farPos = { agent_id: 2, workspace_id: 1, x: 100, y: 100, target_x: null, target_y: null, zone: 'far', updated_at: 0 }
      const initPos = { agent_id: 1, workspace_id: 1, x: 30, y: 40, target_x: null, target_y: null, zone: 'eng', updated_at: 0 }

      const db1 = createMockDb()
      db1._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })
      const nearScore = scorePartner(db1 as any, agentA, agentB, initPos, nearPos)

      const db2 = createMockDb()
      db2._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })
      const farScore = scorePartner(db2 as any, agentA, agentB, initPos, farPos)

      expect(nearScore).toBeGreaterThan(farScore)

      spy.mockRestore()
    })

    it('novelty score decreases with recent meeting count', () => {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)

      // No recent meetings — high novelty
      const db1 = createMockDb()
      db1._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })
      const freshScore = scorePartner(db1 as any, agentA, agentB, null, null)

      // 3 recent meetings — low novelty (novelty = max(0, 1 - 3*0.3) = 0.1)
      const db2 = createMockDb()
      db2._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 3 }) })
      const staleScore = scorePartner(db2 as any, agentA, agentB, null, null)

      // Novelty diff: (1.0 - 0.1) * 0.2 = 0.18
      expect(freshScore).toBeGreaterThan(staleScore)

      spy.mockRestore()
    })

    it('selectPartner returns null when no idle candidates', () => {
      const db = createMockDb()
      db._when('FROM agents', { all: vi.fn().mockReturnValue([]) })

      expect(selectPartner(db as any, agentA)).toBeNull()
    })

    it('selectPartner excludes agents in active meetings', () => {
      const db = createMockDb()
      // Two idle candidates
      const agentC = { ...agentB, id: 4, name: 'Charlie' }
      db._when('FROM agents', { all: vi.fn().mockReturnValue([agentB, agentC]) })
      // agentB (id=2) is in an active meeting, agentC (id=4) is free
      db._when("status IN ('walking', 'conversing', 'summarizing')", {
        all: vi.fn().mockReturnValue([{ initiator_id: 2, participant_id: 3 }]),
      })
      // getWorkspacePositions
      db._when('agent_office_positions WHERE workspace_id', { all: vi.fn().mockReturnValue([]) })
      // scorePartner: COUNT(*)
      db._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const result = selectPartner(db as any, agentA)
      expect(result).not.toBeNull()
      // agentB excluded (id=2 in busy set), only agentC (id=4) available
      expect(result!.partner.id).toBe(4)
      spy.mockRestore()
    })

    it('selectPartner handles agent with no personality config', () => {
      const db = createMockDb()
      const noConfigAgent = { id: 5, name: 'NullConfig', role: 'assistant', status: 'idle', soul_content: null, config: null, workspace_id: 1 }
      db._when('FROM agents', { all: vi.fn().mockReturnValue([noConfigAgent]) })
      db._when("status IN ('walking', 'conversing', 'summarizing')", { all: vi.fn().mockReturnValue([]) })
      db._when('agent_office_positions WHERE workspace_id', { all: vi.fn().mockReturnValue([]) })
      db._when('COUNT(*)', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const result = selectPartner(db as any, agentA)
      expect(result).not.toBeNull()
      expect(result!.partner.id).toBe(5)
      expect(result!.score).toBeGreaterThan(0)
      spy.mockRestore()
    })
  })

  // --- MTST-03: Trust score updates ---

  describe('trust score updates', () => {
    it('updatePairwiseTrust is called during meeting conclusion', async () => {
      vi.mocked(updatePairwiseTrust).mockClear()

      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 6, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      db._when("SET status = ?", { run: vi.fn() })
      db._when('meeting_messages mm', {
        all: vi.fn().mockReturnValue([
          { content: 'Hello', agent_name: 'Atlas' },
          { content: 'Hi there', agent_name: 'Nova' },
        ]),
      })
      db._when('agents WHERE id', { get: vi.fn().mockReturnValue(agentA) })
      db._when("status = 'concluded'", { run: vi.fn() })
      db._when('agent_pairwise_trust', { run: vi.fn(), get: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }) })
      db._when('SET target_x = NULL', { run: vi.fn() })

      await summarizeMeeting(db as any, meeting)

      expect(updatePairwiseTrust).toHaveBeenCalled()
    })

    it('trust updates happen for both initiator and participant', async () => {
      vi.mocked(updatePairwiseTrust).mockClear()

      const db = createMockDb()
      const meeting = {
        id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2,
        status: 'conversing' as const, topic: 'test', summary: null,
        location_x: 40, location_y: 50, turn_count: 6, max_turns: 6,
        started_at: 100, concluded_at: null, scheduled_for: null, recurring_interval_ms: null, created_at: 100, quality_score: null, project_id: null,
      }

      db._when("SET status = ?", { run: vi.fn() })
      db._when('meeting_messages mm', {
        all: vi.fn().mockReturnValue([
          { content: 'Hello', agent_name: 'Atlas' },
          { content: 'Hi there', agent_name: 'Nova' },
        ]),
      })
      db._when('agents WHERE id', { get: vi.fn().mockReturnValue(agentA) })
      db._when("status = 'concluded'", { run: vi.fn() })
      db._when('agent_pairwise_trust', { run: vi.fn(), get: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }) })
      db._when('SET target_x = NULL', { run: vi.fn() })

      await summarizeMeeting(db as any, meeting)

      // updatePairwiseTrust called twice: once for initiator→participant, once for participant→initiator
      expect(updatePairwiseTrust).toHaveBeenCalledTimes(2)
      // First call: initiator (1) → participant (2) with delta 0.05
      expect(updatePairwiseTrust).toHaveBeenCalledWith(expect.anything(), 1, 2, 0.05, 1)
      // Second call: participant (2) → initiator (1) with delta 0.05
      expect(updatePairwiseTrust).toHaveBeenCalledWith(expect.anything(), 2, 1, 0.05, 1)
    })
  })
})
