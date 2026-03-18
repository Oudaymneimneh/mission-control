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
  complete: vi.fn(),
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

import { generateMeetingTurn } from '@/lib/meeting-engine'
import type { MeetingRow } from '@/lib/meeting-engine'
import { complete } from '@/lib/llm/router'
import { buildSystemPrompt } from '@/lib/persona-engine'
import { eventBus } from '@/lib/event-bus'

// --- Recorded LLM responses (no live calls) ---

const RECORDED = {
  greeting: { text: 'Hey Nova, I was thinking about our deployment pipeline. Have you had a chance to look at the latest metrics?', tokenCount: { input: 150, output: 25 }, cost: 0.001, latencyMs: 500, model: 'test' },
  response: { text: 'Yes! The error rates dropped significantly after we switched to blue-green deployments.', tokenCount: { input: 200, output: 35 }, cost: 0.001, latencyMs: 600, model: 'test' },
  followup: { text: 'That makes sense. Let me pull up the staging config so we can plan the migration steps together.', tokenCount: { input: 250, output: 20 }, cost: 0.001, latencyMs: 450, model: 'test' },
}

// --- Mock DB helper ---

function createMockDb() {
  const calls: Array<{ sql: string; stmt: any }> = []
  function _when(sqlFragment: string, stmt: any) { calls.push({ sql: sqlFragment, stmt }) }
  const db = {
    prepare: vi.fn((sql: string) => {
      const match = calls.find((c) => sql.includes(c.sql))
      if (match) return match.stmt
      return { get: vi.fn(), run: vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 0 }), all: vi.fn().mockReturnValue([]) }
    }),
    _when,
  }
  return db
}

// --- Test agents ---

const speaker = {
  id: 1,
  name: 'Atlas',
  role: 'engineer',
  soul_content: 'A meticulous engineer who values precision.',
  config: JSON.stringify({ persona: { personality: { extraversion: 0.8, agreeableness: 0.7, openness: 0.6, conscientiousness: 0.5, neuroticism: 0.3 } } }),
  workspace_id: 1,
}

const listener = {
  id: 2,
  name: 'Nova',
  role: 'designer',
}

// --- Meeting fixture ---

function makeMeeting(overrides: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: 100,
    workspace_id: 1,
    initiator_id: speaker.id,
    participant_id: listener.id,
    status: 'conversing',
    topic: null,
    summary: null,
    location_x: 30,
    location_y: 40,
    turn_count: 0,
    max_turns: 6,
    started_at: Math.floor(Date.now() / 1000),
    concluded_at: null,
    scheduled_for: null,
    recurring_interval_ms: null,
    created_at: Math.floor(Date.now() / 1000),
    quality_score: null,
    project_id: null,
    ...overrides,
  }
}

// --- Tests ---

describe('meeting conversation quality', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('turn coherence', () => {
    it('first turn generates non-empty content within length bounds', async () => {
      vi.mocked(complete).mockResolvedValueOnce(RECORDED.greeting)

      const db = createMockDb()
      db._when('FROM agents WHERE id', { get: vi.fn().mockReturnValueOnce(speaker).mockReturnValueOnce(listener) })
      db._when('SELECT mm.content', { all: vi.fn().mockReturnValue([]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }) })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })

      const meeting = makeMeeting({ turn_count: 0 })
      const result = await generateMeetingTurn(db as any, meeting)

      expect(result).toBe(true)

      // Verify broadcast content
      const broadcastCall = vi.mocked(eventBus.broadcast).mock.calls.find(
        (c) => c[0] === 'meeting.message',
      )
      expect(broadcastCall).toBeDefined()
      const payload = broadcastCall![1] as { content: string }
      expect(payload.content.length).toBeGreaterThan(10)
      expect(payload.content.length).toBeLessThan(500)
      expect(payload.content).not.toContain('undefined')
      expect(payload.content).not.toContain('null')
      expect(payload.content).not.toContain('[object')
    })

    it('subsequent turns include conversation context in prompt', async () => {
      vi.mocked(complete).mockResolvedValueOnce(RECORDED.followup)

      const previousMessages = [
        { content: RECORDED.greeting.text, turn_number: 1, agent_name: 'Atlas' },
        { content: RECORDED.response.text, turn_number: 2, agent_name: 'Nova' },
      ]

      const db = createMockDb()
      db._when('FROM agents WHERE id', { get: vi.fn().mockReturnValueOnce(speaker).mockReturnValueOnce(listener) })
      db._when('SELECT mm.content', { all: vi.fn().mockReturnValue(previousMessages) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 3 }) })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })

      const meeting = makeMeeting({ turn_count: 2, topic: 'deployment pipeline' })
      await generateMeetingTurn(db as any, meeting)

      // Verify complete() was called with prompt containing previous speaker names and topic
      const completeCall = vi.mocked(complete).mock.calls[0]
      const messages = completeCall[0] as Array<{ role: string; content: string }>
      const userPrompt = messages.find((m) => m.role === 'user')!.content

      expect(userPrompt).toContain('Atlas')
      expect(userPrompt).toContain('Nova')
      expect(userPrompt).toContain('deployment pipeline')
    })
  })

  describe('role adherence', () => {
    it('system prompt includes persona context', async () => {
      vi.mocked(complete).mockResolvedValueOnce(RECORDED.greeting)

      const db = createMockDb()
      db._when('FROM agents WHERE id', { get: vi.fn().mockReturnValueOnce(speaker).mockReturnValueOnce(listener) })
      db._when('SELECT mm.content', { all: vi.fn().mockReturnValue([]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }) })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })

      const meeting = makeMeeting({ turn_count: 0 })
      await generateMeetingTurn(db as any, meeting)

      expect(buildSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Atlas',
          role: 'engineer',
          soul_content: 'A meticulous engineer who values precision.',
        }),
      )
    })
  })

  describe('turn structure', () => {
    it('topic is set from first message only', async () => {
      vi.mocked(complete).mockResolvedValueOnce(RECORDED.greeting)

      const topicRunMock = vi.fn()
      const db = createMockDb()
      db._when('FROM agents WHERE id', { get: vi.fn().mockReturnValueOnce(speaker).mockReturnValueOnce(listener) })
      db._when('SELECT mm.content', { all: vi.fn().mockReturnValue([]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }) })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET topic', { run: topicRunMock })

      // turn_count=0 and no topic → should set topic
      const meeting = makeMeeting({ turn_count: 0, topic: null })
      await generateMeetingTurn(db as any, meeting)

      expect(topicRunMock).toHaveBeenCalled()
      // Topic should be truncated to 100 chars from the response text
      const topicArg = topicRunMock.mock.calls[0][0] as string
      expect(topicArg.length).toBeLessThanOrEqual(100)
      expect(topicArg.length).toBeGreaterThan(0)
    })
  })
})
