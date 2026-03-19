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

vi.mock('@/lib/meeting-actions', () => ({
  extractMeetingActions: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/meeting-outputs', () => ({
  extractMeetingOutputs: vi.fn().mockResolvedValue({ action_items: [], decisions: [], artifacts: [] }),
}))

import { generateMeetingTurn, summarizeMeeting } from '@/lib/meeting-engine'
import type { MeetingRow } from '@/lib/meeting-engine'
import { complete } from '@/lib/llm/router'
import { eventBus } from '@/lib/event-bus'

// --- Recorded LLM responses (no live calls) ---

const RECORDED = {
  turn1: { text: 'Hello Nova, I wanted to discuss the API design. Have you reviewed the spec?', tokenCount: { input: 150, output: 30 }, cost: 0.001, latencyMs: 500, model: 'test' },
  turn2: { text: 'Yes! I think we should use REST for CRUD and GraphQL for complex queries.', tokenCount: { input: 200, output: 35 }, cost: 0.001, latencyMs: 600, model: 'test' },
  turn3: { text: 'Good point. What about authentication? JWT or session-based?', tokenCount: { input: 250, output: 25 }, cost: 0.001, latencyMs: 450, model: 'test' },
  turn4: { text: 'JWT with refresh tokens would work best for our mobile clients.', tokenCount: { input: 300, output: 30 }, cost: 0.001, latencyMs: 550, model: 'test' },
  summary: { text: 'Meeting discussed API design decisions: REST for CRUD, GraphQL for queries, JWT auth with refresh tokens for mobile.', tokenCount: { input: 400, output: 40 }, cost: 0.002, latencyMs: 800, model: 'test' },
  qualityScore: { text: '{"coherence": 4, "actionability": 3, "role_adherence": 5}', tokenCount: { input: 500, output: 15 }, cost: 0.001, latencyMs: 400, model: 'test' },
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

describe('meeting integration — full conversation flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes a 4-turn meeting with recorded responses', async () => {
    const turns = [RECORDED.turn1, RECORDED.turn2, RECORDED.turn3, RECORDED.turn4]
    const insertRunMock = vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 })
    const turnCountRunMock = vi.fn()
    const topicRunMock = vi.fn()

    // Track accumulated messages across turns
    const accumulatedMessages: Array<{ content: string; turn_number: number; agent_name: string }> = []

    for (let i = 0; i < 4; i++) {
      vi.mocked(complete).mockResolvedValueOnce(turns[i])

      const db = createMockDb()
      const isInitiatorTurn = i % 2 === 0
      const currentSpeaker = isInitiatorTurn ? speaker : { ...listener, soul_content: null, config: null, workspace_id: 1 }
      const currentListener = isInitiatorTurn ? listener : speaker

      db._when('FROM agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(currentSpeaker)
          .mockReturnValueOnce(currentListener),
      })
      db._when('SELECT mm.content', { all: vi.fn().mockReturnValue([...accumulatedMessages]) })
      db._when('INSERT INTO meeting_messages', { run: insertRunMock })
      db._when('UPDATE agent_meetings SET turn_count', { run: turnCountRunMock })
      if (i === 0) {
        db._when('UPDATE agent_meetings SET topic', { run: topicRunMock })
      }

      const meeting = makeMeeting({ turn_count: i, topic: i > 0 ? 'API design' : null, max_turns: 6 })
      const result = await generateMeetingTurn(db as any, meeting)

      expect(result).toBe(true)

      // Accumulate for next turn's context
      accumulatedMessages.push({
        content: turns[i].text,
        turn_number: i + 1,
        agent_name: isInitiatorTurn ? speaker.name : listener.name,
      })
    }

    // Verify: insert called 4 times total
    expect(insertRunMock).toHaveBeenCalledTimes(4)

    // Verify: turn_count incremented each time
    expect(turnCountRunMock).toHaveBeenCalledTimes(4)
    expect(turnCountRunMock).toHaveBeenNthCalledWith(1, 1, 100) // turn 1
    expect(turnCountRunMock).toHaveBeenNthCalledWith(2, 2, 100) // turn 2
    expect(turnCountRunMock).toHaveBeenNthCalledWith(3, 3, 100) // turn 3
    expect(turnCountRunMock).toHaveBeenNthCalledWith(4, 4, 100) // turn 4

    // Verify: topic set on first turn only
    expect(topicRunMock).toHaveBeenCalledTimes(1)
    const topicArg = topicRunMock.mock.calls[0][0] as string
    expect(topicArg).toBe(RECORDED.turn1.text.slice(0, 100))
  })

  it('meeting summary is generated after last turn', async () => {
    vi.mocked(complete).mockResolvedValueOnce(RECORDED.summary)
    // Second complete call for quality evaluation
    vi.mocked(complete).mockResolvedValueOnce(RECORDED.qualityScore)

    const messages = [
      { content: RECORDED.turn1.text, agent_name: 'Atlas' },
      { content: RECORDED.turn2.text, agent_name: 'Nova' },
      { content: RECORDED.turn3.text, agent_name: 'Atlas' },
      { content: RECORDED.turn4.text, agent_name: 'Nova' },
    ]

    // Use a single mock that tracks all SET status calls by inspecting args
    const statusCalls: Array<any[]> = []
    const statusRunMock = vi.fn((...args: any[]) => { statusCalls.push(args) })

    const db = createMockDb()
    // Atomic guard: check status before transition
    db._when('SELECT status FROM agent_meetings WHERE id', { get: vi.fn().mockReturnValue({ status: 'conversing' }) })
    // Both "SET status = 'summarizing'" and "SET status = 'concluded', summary = ?" match this fragment
    db._when('UPDATE agent_meetings SET status', { run: statusRunMock })
    db._when('SELECT mm.content', { all: vi.fn().mockReturnValue(messages) })
    db._when('FROM agents WHERE id', {
      get: vi.fn().mockReturnValue(speaker),
    })
    db._when('UPDATE agent_office_positions SET target_x = NULL', { run: vi.fn() })
    db._when('UPDATE agent_meetings SET quality_score', { run: vi.fn() })
    db._when('SELECT name FROM agents', { get: vi.fn().mockReturnValue({ name: 'Nova' }) })

    const meeting = makeMeeting({ turn_count: 4, max_turns: 4, topic: 'API design' })
    await summarizeMeeting(db as any, meeting)

    // Verify: status set to summarizing (first call) then concluded with summary (second call)
    expect(statusRunMock).toHaveBeenCalledTimes(2)
    // First call: SET status = 'summarizing' WHERE id = ? (status is in SQL, not a param)
    expect(statusCalls[0]).toEqual([100])
    // Second call: SET status = 'concluded', summary = ?, concluded_at = ...
    expect(statusCalls[1][0]).toBe(RECORDED.summary.text) // summary
    expect(statusCalls[1][1]).toBe(100) // meeting id

    // Verify: meeting.concluded broadcast
    const concludedBroadcast = vi.mocked(eventBus.broadcast).mock.calls.find(
      (c) => c[0] === 'meeting.concluded',
    )
    expect(concludedBroadcast).toBeDefined()
    expect((concludedBroadcast![1] as any).summary).toBe(RECORDED.summary.text)
  })

  it('turns alternate between initiator and participant', async () => {
    const turns = [RECORDED.turn1, RECORDED.turn2, RECORDED.turn3, RECORDED.turn4]
    const speakerIds: number[] = []

    for (let i = 0; i < 4; i++) {
      vi.mocked(complete).mockResolvedValueOnce(turns[i])

      const isInitiatorTurn = i % 2 === 0
      const currentSpeaker = isInitiatorTurn ? speaker : { ...listener, soul_content: null, config: null, workspace_id: 1 }
      const currentListener = isInitiatorTurn ? listener : speaker

      const db = createMockDb()
      db._when('FROM agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(currentSpeaker)
          .mockReturnValueOnce(currentListener),
      })
      db._when('SELECT mm.content', { all: vi.fn().mockReturnValue([]) })
      db._when('INSERT INTO meeting_messages', {
        run: vi.fn((...args: any[]) => {
          // args: meeting.id, speaker.id, responseText, turnNumber
          speakerIds.push(args[1] as number)
          return { changes: 1, lastInsertRowid: i + 1 }
        }),
      })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      if (i === 0) {
        db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })
      }

      const meeting = makeMeeting({ turn_count: i, topic: i > 0 ? 'test' : null })
      await generateMeetingTurn(db as any, meeting)
    }

    // Verify: odd turns = initiator (id=1), even turns = participant (id=2)
    expect(speakerIds[0]).toBe(speaker.id)   // turn_count=0 → initiator
    expect(speakerIds[1]).toBe(listener.id)  // turn_count=1 → participant
    expect(speakerIds[2]).toBe(speaker.id)   // turn_count=2 → initiator
    expect(speakerIds[3]).toBe(listener.id)  // turn_count=3 → participant
  })

  it('meeting messages table populated with correct turn numbers', async () => {
    const turns = [RECORDED.turn1, RECORDED.turn2, RECORDED.turn3, RECORDED.turn4]
    const insertedTurnNumbers: number[] = []

    for (let i = 0; i < 4; i++) {
      vi.mocked(complete).mockResolvedValueOnce(turns[i])

      const isInitiatorTurn = i % 2 === 0
      const currentSpeaker = isInitiatorTurn ? speaker : { ...listener, soul_content: null, config: null, workspace_id: 1 }
      const currentListener = isInitiatorTurn ? listener : speaker

      const db = createMockDb()
      db._when('FROM agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce(currentSpeaker)
          .mockReturnValueOnce(currentListener),
      })
      db._when('SELECT mm.content', { all: vi.fn().mockReturnValue([]) })
      db._when('INSERT INTO meeting_messages', {
        run: vi.fn((...args: any[]) => {
          // args: meeting.id, speaker.id, content, turn_number
          insertedTurnNumbers.push(args[3] as number)
          return { changes: 1, lastInsertRowid: i + 1 }
        }),
      })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      if (i === 0) {
        db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })
      }

      const meeting = makeMeeting({ turn_count: i, topic: i > 0 ? 'test' : null })
      await generateMeetingTurn(db as any, meeting)
    }

    // turn_number = turn_count + 1 (1-indexed)
    expect(insertedTurnNumbers).toEqual([1, 2, 3, 4])
  })
})

describe('meeting integration — quality scoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('quality score JSON stored after meeting conclusion', async () => {
    // First call: summary LLM response
    vi.mocked(complete).mockResolvedValueOnce(RECORDED.summary)
    // Second call: quality evaluation LLM response
    vi.mocked(complete).mockResolvedValueOnce(RECORDED.qualityScore)

    const messages = [
      { content: RECORDED.turn1.text, agent_name: 'Atlas' },
      { content: RECORDED.turn2.text, agent_name: 'Nova' },
      { content: RECORDED.turn3.text, agent_name: 'Atlas' },
      { content: RECORDED.turn4.text, agent_name: 'Nova' },
    ]

    const qualityRunMock = vi.fn()

    const db = createMockDb()
    db._when('SELECT status FROM agent_meetings WHERE id', { get: vi.fn().mockReturnValue({ status: 'conversing' }) })
    db._when('UPDATE agent_meetings SET status', { run: vi.fn() })
    db._when('SELECT mm.content', { all: vi.fn().mockReturnValue(messages) })
    db._when('FROM agents WHERE id', {
      get: vi.fn().mockReturnValue(speaker),
    })
    db._when("UPDATE agent_meetings SET status = 'concluded'", { run: vi.fn() })
    db._when('UPDATE agent_office_positions SET target_x = NULL', { run: vi.fn() })
    db._when('UPDATE agent_meetings SET quality_score', { run: qualityRunMock })
    db._when('SELECT name FROM agents', { get: vi.fn().mockReturnValue({ name: 'Nova' }) })

    const meeting = makeMeeting({ turn_count: 4, max_turns: 4, topic: 'API design' })
    await summarizeMeeting(db as any, meeting)

    // Verify: quality_score column updated with parsed JSON
    expect(qualityRunMock).toHaveBeenCalledTimes(1)
    const storedJson = JSON.parse(qualityRunMock.mock.calls[0][0] as string)
    expect(storedJson).toEqual({ coherence: 4, actionability: 3, role_adherence: 5 })
    expect(qualityRunMock.mock.calls[0][1]).toBe(100) // meeting id
  })

  it('malformed quality JSON falls back to neutral scores', async () => {
    // First call: summary LLM response
    vi.mocked(complete).mockResolvedValueOnce(RECORDED.summary)
    // Second call: quality evaluation returns malformed JSON (strings instead of numbers)
    vi.mocked(complete).mockResolvedValueOnce({
      text: '{"coherence": "high", "actionability": "medium", "role_adherence": "excellent"}',
      tokenCount: { input: 500, output: 15 },
      cost: 0.001,
      latencyMs: 400,
      model: 'test',
    })

    const messages = [
      { content: RECORDED.turn1.text, agent_name: 'Atlas' },
      { content: RECORDED.turn2.text, agent_name: 'Nova' },
      { content: RECORDED.turn3.text, agent_name: 'Atlas' },
      { content: RECORDED.turn4.text, agent_name: 'Nova' },
    ]

    const qualityRunMock = vi.fn()
    const statusCalls: Array<any[]> = []
    const statusRunMock = vi.fn((...args: any[]) => { statusCalls.push(args) })

    const db = createMockDb()
    db._when('SELECT status FROM agent_meetings WHERE id', { get: vi.fn().mockReturnValue({ status: 'conversing' }) })
    db._when('UPDATE agent_meetings SET status', { run: statusRunMock })
    db._when('SELECT mm.content', { all: vi.fn().mockReturnValue(messages) })
    db._when('FROM agents WHERE id', {
      get: vi.fn().mockReturnValue(speaker),
    })
    db._when('UPDATE agent_office_positions SET target_x = NULL', { run: vi.fn() })
    db._when('UPDATE agent_meetings SET quality_score', { run: qualityRunMock })
    db._when('SELECT name FROM agents', { get: vi.fn().mockReturnValue({ name: 'Nova' }) })

    const meeting = makeMeeting({ turn_count: 4, max_turns: 4, topic: 'API design' })
    await summarizeMeeting(db as any, meeting)

    // Meeting still concludes successfully
    expect(statusRunMock).toHaveBeenCalledTimes(2)
    expect(statusCalls[0]).toEqual([100]) // SET status = 'summarizing' WHERE id = ?
    expect(statusCalls[1][0]).toBe(RECORDED.summary.text)
    expect(statusCalls[1][1]).toBe(100)

    // Quality score stored with neutral fallback (clampScore converts NaN → 3)
    expect(qualityRunMock).toHaveBeenCalledTimes(1)
    const storedJson = JSON.parse(qualityRunMock.mock.calls[0][0] as string)
    expect(storedJson).toEqual({ coherence: 3, actionability: 3, role_adherence: 3 })
    expect(qualityRunMock.mock.calls[0][1]).toBe(100)
  })

  it('action extraction skipped for meetings with fewer than 3 turns', async () => {
    const { extractMeetingActions } = await import('@/lib/meeting-actions')

    // Summary LLM call
    vi.mocked(complete).mockResolvedValueOnce(RECORDED.summary)
    // Quality eval LLM call (quality always runs regardless of message count)
    vi.mocked(complete).mockResolvedValueOnce(RECORDED.qualityScore)

    // Only 2 messages (fewer than 3) — action extraction should be skipped
    const messages = [
      { content: RECORDED.turn1.text, agent_name: 'Atlas' },
      { content: RECORDED.turn2.text, agent_name: 'Nova' },
    ]

    const qualityRunMock = vi.fn()

    const db = createMockDb()
    db._when('SELECT status FROM agent_meetings WHERE id', { get: vi.fn().mockReturnValue({ status: 'conversing' }) })
    db._when('UPDATE agent_meetings SET status', { run: vi.fn() })
    db._when('SELECT mm.content', { all: vi.fn().mockReturnValue(messages) })
    db._when('FROM agents WHERE id', {
      get: vi.fn().mockReturnValue(speaker),
    })
    db._when('UPDATE agent_office_positions SET target_x = NULL', { run: vi.fn() })
    db._when('UPDATE agent_meetings SET quality_score', { run: qualityRunMock })
    db._when('SELECT name FROM agents', { get: vi.fn().mockReturnValue({ name: 'Nova' }) })

    const meeting = makeMeeting({ turn_count: 2, max_turns: 2, topic: 'short meeting' })
    await summarizeMeeting(db as any, meeting)

    // complete called twice: once for summary, once for quality eval
    expect(vi.mocked(complete)).toHaveBeenCalledTimes(2)
    // quality_score IS updated (quality eval has no message count guard)
    expect(qualityRunMock).toHaveBeenCalledTimes(1)
    // action extraction should NOT be called (gated on messages.length >= 3)
    expect(vi.mocked(extractMeetingActions)).not.toHaveBeenCalled()
  })
})
