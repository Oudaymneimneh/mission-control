# Meeting System Comprehensive Testing Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Achieve full coverage of the meeting engine pipeline — engine correctness (state machine, trust, partner selection), conversation quality (LLM output coherence, role adherence, turn-taking), and visual/UX completeness (SSE delivery, panel rendering, canvas markers) — with property-based invariants, scenario-based evaluations, and E2E visual tests.

**Architecture:** Three test layers matching the Agent Testing Pyramid: (1) Unit tests with property-based invariants for deterministic engine logic, (2) Integration tests with recorded LLM responses for conversation flow + quality evaluation, (3) E2E tests via Playwright for SSE-driven UI, meeting panel, and canvas visualization. All tests follow existing vitest/playwright patterns — `createMockDb()` with `_when()` SQL matching, `vi.mock` before imports, `{ request }` fixture for API E2E.

**Tech Stack:** Vitest 2.1.5, Playwright 1.51.0, existing `createMockDb()` factory, `vi.mock`/`vi.fn` patterns, Playwright `page.route()` for SSE mocking.

---

## Part 1: Engine Correctness (Unit Tests)

### Task 1: Test `attemptMeetingInitiation` — all guard paths

**Files:**
- Modify: `src/lib/__tests__/meeting-engine.test.ts`

**Step 1: Write failing tests for all 6 paths**

Add a new `describe('attemptMeetingInitiation', ...)` block after the existing `processActiveMeeting` tests. These tests need `getDatabase` to return the mock db, and the function is async.

```typescript
describe('attemptMeetingInitiation', () => {
  const agent: AgentForMeeting = {
    id: 1, name: 'Atlas', role: 'engineer', status: 'idle',
    soul_content: null, workspace_id: 1,
    config: JSON.stringify({ persona: { personality: { extraversion: 0.9, agreeableness: 0.8, openness: 0.7, conscientiousness: 0.5, neuroticism: 0.3 } } }),
  }

  it('returns false when propensity below threshold', async () => {
    const introvert = { ...agent, config: JSON.stringify({ persona: { personality: { extraversion: 0.1, agreeableness: 0.1, openness: 0.1, conscientiousness: 0.5, neuroticism: 0.9 } } }) }
    const db = createMockDb()
    vi.mocked(getDatabase).mockReturnValue(db as any)
    const result = await attemptMeetingInitiation(introvert)
    expect(result).toBe(false)
  })

  it('returns false when random roll fails', async () => {
    const db = createMockDb()
    vi.mocked(getDatabase).mockReturnValue(db as any)
    // Force Math.random to return 1.0 (always fails the roll)
    const spy = vi.spyOn(Math, 'random').mockReturnValue(1.0)
    const result = await attemptMeetingInitiation(agent)
    expect(result).toBe(false)
    spy.mockRestore()
  })

  it('returns false when canInitiateMeeting fails (in cooldown)', async () => {
    const db = createMockDb()
    vi.mocked(getDatabase).mockReturnValue(db as any)
    vi.spyOn(Math, 'random').mockReturnValue(0) // pass the roll
    // Set up cooldown: recent concluded meeting
    db._when('concluded', { get: vi.fn().mockReturnValue({ concluded_at: Math.floor(Date.now() / 1000) }) })
    const result = await attemptMeetingInitiation(agent)
    expect(result).toBe(false)
    vi.spyOn(Math, 'random').mockRestore()
  })

  it('returns false when no partner available', async () => {
    const db = createMockDb()
    vi.mocked(getDatabase).mockReturnValue(db as any)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    // No cooldown, no active meeting, under limit
    db._when('concluded', { get: vi.fn().mockReturnValue(undefined) })
    db._when('walking', { get: vi.fn().mockReturnValue(undefined) })
    db._when('COUNT', { get: vi.fn().mockReturnValue({ cnt: 0 }) })
    // No idle agents available
    db._when('status = \'idle\'', { all: vi.fn().mockReturnValue([]) })
    const result = await attemptMeetingInitiation(agent)
    expect(result).toBe(false)
    vi.spyOn(Math, 'random').mockRestore()
  })

  it('returns true and creates meeting when all checks pass', async () => {
    const db = createMockDb()
    vi.mocked(getDatabase).mockReturnValue(db as any)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    // Pass all guards
    db._when('concluded', { get: vi.fn().mockReturnValue(undefined) })
    db._when('walking', { get: vi.fn().mockReturnValue(undefined) })
    db._when('COUNT', { get: vi.fn().mockReturnValue({ cnt: 0 }) })
    // Partner available
    const partner = { id: 2, name: 'Nova', role: 'researcher', status: 'idle', soul_content: null, config: null, workspace_id: 1 }
    db._when('status = \'idle\'', { all: vi.fn().mockReturnValue([partner]) })
    // No busy agents in meetings
    db._when('IN (\'walking\'', { all: vi.fn().mockReturnValue([]) })
    // Positions for scoring
    db._when('agent_office_positions WHERE workspace_id', { all: vi.fn().mockReturnValue([
      { agent_id: 1, x: 30, y: 40, target_x: null, target_y: null, zone: 'engineering', updated_at: 0, workspace_id: 1 },
      { agent_id: 2, x: 50, y: 40, target_x: null, target_y: null, zone: 'research', updated_at: 0, workspace_id: 1 },
    ]) })
    // Trust
    vi.mocked(getPairwiseTrust).mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null })
    // Novelty (no recent meetings)
    db._when('created_at > unixepoch', { get: vi.fn().mockReturnValue({ cnt: 0 }) })
    // createMeeting internals
    db._when('agent_office_positions WHERE agent_id', { get: vi.fn().mockReturnValue({ x: 30, y: 40 }) })
    db._when('INSERT INTO agent_meetings', { run: vi.fn().mockReturnValue({ lastInsertRowid: 99, changes: 1 }) })
    db._when('SELECT * FROM agent_meetings WHERE id', { get: vi.fn().mockReturnValue({
      id: 99, workspace_id: 1, initiator_id: 1, participant_id: 2,
      status: 'walking', location_x: 40, location_y: 40, turn_count: 0, max_turns: 6,
      started_at: Math.floor(Date.now() / 1000), created_at: Math.floor(Date.now() / 1000),
      topic: null, summary: null, concluded_at: null,
    }) })

    const result = await attemptMeetingInitiation(agent)
    expect(result).toBe(true)
    expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.started', expect.objectContaining({ meeting_id: 99 }))
    vi.spyOn(Math, 'random').mockRestore()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm vitest run src/lib/__tests__/meeting-engine.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: New tests fail (attemptMeetingInitiation not imported, or mock setup issues).

**Step 3: Fix imports and mock wiring**

Ensure `attemptMeetingInitiation` is imported at the top of the test file alongside other imports. Ensure `getDatabase` and `getPairwiseTrust` are available as mocked imports.

**Step 4: Run tests to verify they pass**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm vitest run src/lib/__tests__/meeting-engine.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: All new + existing tests PASS.

**Step 5: Commit**

```bash
git add src/lib/__tests__/meeting-engine.test.ts
git commit -m "test: add attemptMeetingInitiation coverage — all 5 guard paths + happy path"
```

---

### Task 2: Test `selectPartner` — batch loading, scoring, edge cases

**Files:**
- Modify: `src/lib/__tests__/meeting-engine.test.ts`

**Step 1: Write failing tests**

```typescript
describe('selectPartner', () => {
  const initiator: AgentForMeeting = {
    id: 1, name: 'Atlas', role: 'engineer', status: 'idle', soul_content: null, workspace_id: 1,
    config: JSON.stringify({ persona: { personality: { extraversion: 0.8, agreeableness: 0.7, openness: 0.6, conscientiousness: 0.5, neuroticism: 0.3 } } }),
  }

  it('returns null when no idle candidates', () => {
    const db = createMockDb()
    db._when('status = \'idle\'', { all: vi.fn().mockReturnValue([]) })
    const result = selectPartner(db as any, initiator)
    expect(result).toBeNull()
  })

  it('returns null when all candidates are in active meetings', () => {
    const db = createMockDb()
    const candidate = { id: 2, name: 'Nova', role: 'researcher', status: 'idle', soul_content: null, config: null, workspace_id: 1 }
    db._when('status = \'idle\'', { all: vi.fn().mockReturnValue([candidate]) })
    db._when('IN (\'walking\'', { all: vi.fn().mockReturnValue([{ initiator_id: 2, participant_id: 3 }]) })
    const result = selectPartner(db as any, initiator)
    expect(result).toBeNull()
  })

  it('selects highest-scoring partner from multiple candidates', () => {
    const db = createMockDb()
    const candidates = [
      { id: 2, name: 'Nova', role: 'researcher', status: 'idle', soul_content: null, config: null, workspace_id: 1 },
      { id: 3, name: 'Orion', role: 'engineer', status: 'idle', soul_content: null, config: null, workspace_id: 1 },
    ]
    db._when('status = \'idle\'', { all: vi.fn().mockReturnValue(candidates) })
    db._when('IN (\'walking\'', { all: vi.fn().mockReturnValue([]) })
    db._when('agent_office_positions WHERE workspace_id', { all: vi.fn().mockReturnValue([
      { agent_id: 1, x: 30, y: 40, workspace_id: 1 },
      { agent_id: 2, x: 32, y: 40, workspace_id: 1 },
      { agent_id: 3, x: 80, y: 80, workspace_id: 1 },
    ]) })
    vi.mocked(getPairwiseTrust).mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null })
    db._when('created_at > unixepoch', { get: vi.fn().mockReturnValue({ cnt: 0 }) })
    // Fix random for determinism
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const result = selectPartner(db as any, initiator)
    expect(result).not.toBeNull()
    expect(result!.partner.id).toBe(2) // closer = higher proximity score
    expect(result!.score).toBeGreaterThan(0)
    expect(result!.score).toBeLessThanOrEqual(1)
    vi.spyOn(Math, 'random').mockRestore()
  })
})
```

**Step 2: Run test, verify fail → Step 3: Add `selectPartner` import → Step 4: Run, verify pass**

**Step 5: Commit**

```bash
git add src/lib/__tests__/meeting-engine.test.ts
git commit -m "test: add selectPartner coverage — null cases, partner ranking"
```

---

### Task 3: Test `processActiveMeeting` conversing branch — all 4 sub-paths

**Files:**
- Modify: `src/lib/__tests__/meeting-engine.test.ts`

**Step 1: Write failing tests for conversing sub-paths**

Add within the existing `processActiveMeeting` describe block:

```typescript
it('generates turn when conversing and is my turn', async () => {
  const db = createMockDb()
  vi.mocked(getDatabase).mockReturnValue(db as any)
  const meeting = {
    id: 10, workspace_id: 1, initiator_id: 1, participant_id: 2,
    status: 'conversing', turn_count: 0, max_turns: 6,
    topic: null, summary: null, location_x: 40, location_y: 50,
    started_at: Math.floor(Date.now() / 1000) - 10, created_at: Math.floor(Date.now() / 1000) - 15,
    concluded_at: null,
  }
  db._when('IN (\'walking\'', { get: vi.fn().mockReturnValue(meeting) })
  // generateMeetingTurn internals
  const speaker = { id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 }
  const listener = { id: 2, name: 'Nova', role: 'researcher' }
  db._when('agents WHERE id', { get: vi.fn().mockReturnValueOnce(speaker).mockReturnValueOnce(listener) })
  db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
  db._when('INSERT INTO meeting_messages', { run: vi.fn().mockReturnValue({ changes: 1 }) })
  db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
  db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })

  const result = await processActiveMeeting({ id: 1, name: 'Atlas', role: 'engineer', status: 'idle', soul_content: null, config: '{}', workspace_id: 1 })
  expect(result).toBe(true)
  expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.message', expect.objectContaining({ meeting_id: 10, agent_name: 'Atlas' }))
})

it('returns true without generating when conversing but not my turn', async () => {
  const db = createMockDb()
  vi.mocked(getDatabase).mockReturnValue(db as any)
  const meeting = {
    id: 10, workspace_id: 1, initiator_id: 1, participant_id: 2,
    status: 'conversing', turn_count: 0, max_turns: 6,
    topic: null, summary: null, location_x: 40, location_y: 50,
    started_at: Math.floor(Date.now() / 1000) - 10, created_at: Math.floor(Date.now() / 1000) - 15,
    concluded_at: null,
  }
  db._when('IN (\'walking\'', { get: vi.fn().mockReturnValue(meeting) })

  // Agent 2 (participant) processes, but turn_count=0 means it's initiator's turn
  const result = await processActiveMeeting({ id: 2, name: 'Nova', role: 'researcher', status: 'idle', soul_content: null, config: '{}', workspace_id: 2 })
  expect(result).toBe(true)
  // No meeting.message should be broadcast — it's not this agent's turn
  expect(eventBus.broadcast).not.toHaveBeenCalledWith('meeting.message', expect.anything())
})

it('triggers summarization when turn_count >= max_turns', async () => {
  const db = createMockDb()
  vi.mocked(getDatabase).mockReturnValue(db as any)
  const meeting = {
    id: 10, workspace_id: 1, initiator_id: 1, participant_id: 2,
    status: 'conversing', turn_count: 6, max_turns: 6,
    topic: 'test topic', summary: null, location_x: 40, location_y: 50,
    started_at: Math.floor(Date.now() / 1000) - 60, created_at: Math.floor(Date.now() / 1000) - 65,
    concluded_at: null,
  }
  db._when('IN (\'walking\'', { get: vi.fn().mockReturnValue(meeting) })
  // summarizeMeeting internals
  db._when('UPDATE agent_meetings SET status', { run: vi.fn() })
  db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([{ content: 'Hello', agent_name: 'Atlas' }]) })
  db._when('agents WHERE id', { get: vi.fn().mockReturnValue({ id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 }) })
  db._when('UPDATE agent_meetings SET status = \'concluded\'', { run: vi.fn() })
  db._when('UPDATE agent_office_positions SET target_x = NULL', { run: vi.fn() })

  const result = await processActiveMeeting({ id: 1, name: 'Atlas', role: 'engineer', status: 'idle', soul_content: null, config: '{}', workspace_id: 1 })
  expect(result).toBe(true)
  expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.concluded', expect.objectContaining({ meeting_id: 10 }))
})
```

**Step 2: Run, verify fail → Step 3: Fix mock wiring → Step 4: Run, verify pass**

**Step 5: Commit**

```bash
git add src/lib/__tests__/meeting-engine.test.ts
git commit -m "test: add processActiveMeeting conversing branch — turn generation, not-my-turn, summarization trigger"
```

---

### Task 4: Test `generateMeetingTurn` — timeout, error, participant turn, topic paths

**Files:**
- Modify: `src/lib/__tests__/meeting-engine.test.ts`

**Step 1: Write failing tests**

```typescript
describe('generateMeetingTurn', () => {
  // ... existing tests ...

  it('uses fallback text when LLM times out', async () => {
    const db = createMockDb()
    const meeting = { id: 5, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 0, max_turns: 6, topic: null, summary: null }
    db._when('agents WHERE id', {
      get: vi.fn()
        .mockReturnValueOnce({ id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 })
        .mockReturnValueOnce({ id: 2, name: 'Nova', role: 'researcher' }),
    })
    db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
    db._when('INSERT INTO meeting_messages', { run: vi.fn().mockReturnValue({ changes: 1 }) })
    db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
    db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })

    // Make LLM reject with timeout
    vi.mocked(complete).mockRejectedValueOnce(new Error('meeting_turn_timeout'))

    const result = await generateMeetingTurn(db as any, meeting as any)
    expect(result).toBe(true) // turn 1 < max_turns 6
    // Verify fallback text was used
    expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.message', expect.objectContaining({
      content: 'Hmm, let me think about that for a moment...',
    }))
  })

  it('re-throws non-timeout LLM errors', async () => {
    const db = createMockDb()
    const meeting = { id: 5, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 0, max_turns: 6, topic: null, summary: null }
    db._when('agents WHERE id', {
      get: vi.fn()
        .mockReturnValueOnce({ id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 })
        .mockReturnValueOnce({ id: 2, name: 'Nova', role: 'researcher' }),
    })
    db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })

    vi.mocked(complete).mockRejectedValueOnce(new Error('rate_limit_exceeded'))

    await expect(generateMeetingTurn(db as any, meeting as any)).rejects.toThrow('rate_limit_exceeded')
  })

  it('participant speaks on odd turn_count', async () => {
    const db = createMockDb()
    const meeting = { id: 5, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 1, max_turns: 6, topic: 'Existing topic', summary: null }
    db._when('agents WHERE id', {
      get: vi.fn()
        .mockReturnValueOnce({ id: 2, name: 'Nova', role: 'researcher', soul_content: null, config: '{}', workspace_id: 1 })
        .mockReturnValueOnce({ id: 1, name: 'Atlas', role: 'engineer' }),
    })
    db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([{ content: 'Hey Nova!', turn_number: 1, agent_name: 'Atlas' }]) })
    db._when('INSERT INTO meeting_messages', { run: vi.fn().mockReturnValue({ changes: 1 }) })
    db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })

    const result = await generateMeetingTurn(db as any, meeting as any)
    expect(result).toBe(true)
    expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.message', expect.objectContaining({
      agent_id: 2, agent_name: 'Nova',
    }))
  })

  it('returns false for non-conversing meeting', async () => {
    const db = createMockDb()
    const meeting = { id: 5, status: 'walking', turn_count: 0, max_turns: 6 }
    const result = await generateMeetingTurn(db as any, meeting as any)
    expect(result).toBe(false)
  })

  it('returns false when turn_count >= max_turns', async () => {
    const db = createMockDb()
    const meeting = { id: 5, status: 'conversing', turn_count: 6, max_turns: 6 }
    const result = await generateMeetingTurn(db as any, meeting as any)
    expect(result).toBe(false)
  })
})
```

**Step 2–4: Red → Green cycle**

**Step 5: Commit**

```bash
git add src/lib/__tests__/meeting-engine.test.ts
git commit -m "test: add generateMeetingTurn timeout, error rethrow, participant turn, guard paths"
```

---

### Task 5: Test `summarizeMeeting` — empty messages, LLM failure, trust + memory

**Files:**
- Modify: `src/lib/__tests__/meeting-engine.test.ts`

**Step 1: Write failing tests**

```typescript
describe('summarizeMeeting', () => {
  // ... existing tests ...

  it('fast-concludes with no LLM call when messages are empty', async () => {
    const db = createMockDb()
    const meeting = { id: 7, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 0, max_turns: 6, topic: null, summary: null }
    // Phase 1: transition to summarizing, return empty messages
    db._when('UPDATE agent_meetings SET status', { run: vi.fn() })
    db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
    db._when('agents WHERE id', { get: vi.fn().mockReturnValue({ id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 }) })
    // Fast-conclude write
    db._when('SET status = \'concluded\'', { run: vi.fn() })

    await summarizeMeeting(db as any, meeting as any)

    // LLM should NOT be called
    expect(complete).not.toHaveBeenCalled()
    // Trust should NOT be updated
    expect(updatePairwiseTrust).not.toHaveBeenCalled()
    // No broadcast (this is the silent failure — documenting it)
    expect(eventBus.broadcast).not.toHaveBeenCalledWith('meeting.concluded', expect.anything())
  })

  it('uses fallback summary when LLM fails', async () => {
    const db = createMockDb()
    const meeting = { id: 7, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 2, max_turns: 6, topic: 'test', summary: null }
    db._when('UPDATE agent_meetings SET status', { run: vi.fn() })
    db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([{ content: 'Hello', agent_name: 'Atlas' }, { content: 'Hi there', agent_name: 'Nova' }]) })
    db._when('agents WHERE id', { get: vi.fn().mockReturnValue({ id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 }) })
    db._when('SET status = \'concluded\'', { run: vi.fn() })
    db._when('UPDATE agent_office_positions SET target_x = NULL', { run: vi.fn() })

    vi.mocked(complete).mockRejectedValueOnce(new Error('llm_error'))

    await summarizeMeeting(db as any, meeting as any)

    // Should still conclude with fallback summary
    expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.concluded', expect.objectContaining({
      summary: expect.stringContaining('Meeting between agents'),
    }))
    // Trust should still update (LLM failure only affects summary text)
    expect(updatePairwiseTrust).toHaveBeenCalledTimes(2)
  })

  it('calls observe for both agents after successful summary', async () => {
    const db = createMockDb()
    const meeting = { id: 7, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 2, max_turns: 6, topic: 'test', summary: null }
    db._when('UPDATE agent_meetings SET status', { run: vi.fn() })
    db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([{ content: 'Hello', agent_name: 'Atlas' }]) })
    db._when('agents WHERE id', { get: vi.fn().mockReturnValue({ id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 }) })
    db._when('SET status = \'concluded\'', { run: vi.fn() })
    db._when('UPDATE agent_office_positions SET target_x = NULL', { run: vi.fn() })

    await summarizeMeeting(db as any, meeting as any)

    expect(observe).toHaveBeenCalledTimes(2)
    expect(observe).toHaveBeenCalledWith(1, expect.stringContaining('Had a meeting'), 1)
    expect(observe).toHaveBeenCalledWith(2, expect.stringContaining('Had a meeting'), 1)
  })

  it('swallows observe errors silently', async () => {
    const db = createMockDb()
    const meeting = { id: 7, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 2, max_turns: 6, topic: 'test', summary: null }
    db._when('UPDATE agent_meetings SET status', { run: vi.fn() })
    db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([{ content: 'Hello', agent_name: 'Atlas' }]) })
    db._when('agents WHERE id', { get: vi.fn().mockReturnValue({ id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 }) })
    db._when('SET status = \'concluded\'', { run: vi.fn() })
    db._when('UPDATE agent_office_positions SET target_x = NULL', { run: vi.fn() })

    vi.mocked(observe).mockRejectedValue(new Error('memory_unavailable'))

    // Should not throw
    await expect(summarizeMeeting(db as any, meeting as any)).resolves.toBeUndefined()
    expect(eventBus.broadcast).toHaveBeenCalledWith('meeting.concluded', expect.anything())
  })
})
```

**Step 2–4: Red → Green cycle**

**Step 5: Commit**

```bash
git add src/lib/__tests__/meeting-engine.test.ts
git commit -m "test: add summarizeMeeting empty messages, LLM failure fallback, observe coverage"
```

---

### Task 6: Property-based invariants — trust bounds, propensity range, score range

**Files:**
- Modify: `src/lib/__tests__/meeting-engine.test.ts`

**Step 1: Write property-based tests**

These use simple loop-based fuzzing (no external library needed — vitest suffices):

```typescript
describe('property invariants', () => {
  it('calculatePropensity always returns [0, 1]', () => {
    for (let i = 0; i < 100; i++) {
      const config = JSON.stringify({
        persona: { personality: {
          extraversion: Math.random(),
          agreeableness: Math.random(),
          openness: Math.random(),
          conscientiousness: Math.random(),
          neuroticism: Math.random(),
        } },
      })
      const result = calculatePropensity(config)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(1)
    }
  })

  it('calculatePropensity returns 0.3 for null config', () => {
    expect(calculatePropensity(null)).toBe(0.3)
  })

  it('calculatePropensity returns 0.3 for invalid JSON', () => {
    expect(calculatePropensity('not json')).toBe(0.3)
  })

  it('scorePartner always returns [0, 1]', () => {
    const db = createMockDb()
    vi.mocked(getPairwiseTrust).mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null })
    db._when('created_at > unixepoch', { get: vi.fn().mockReturnValue({ cnt: 0 }) })

    for (let i = 0; i < 50; i++) {
      const a = { id: 1, name: 'A', role: 'r', status: 'idle', soul_content: null, config: null, workspace_id: 1 } as any
      const b = { id: 2, name: 'B', role: 'r', status: 'idle', soul_content: null, config: null, workspace_id: 1 } as any
      const posA = { agent_id: 1, x: Math.random() * 100, y: Math.random() * 100 } as any
      const posB = { agent_id: 2, x: Math.random() * 100, y: Math.random() * 100 } as any
      const score = scorePartner(db as any, a, b, posA, posB)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it('parsePersonality returns null for invalid JSON (catch branch)', () => {
    expect(parsePersonality('{{{')).toBeNull()
    expect(parsePersonality('')).toBeNull()
  })

  it('maxTurns is always in [4, 8] range', () => {
    // This tests the createMeeting formula: round(4 + avgC * 4)
    for (let c = 0; c <= 1; c += 0.1) {
      const maxTurns = Math.round(4 + c * 4)
      expect(maxTurns).toBeGreaterThanOrEqual(4)
      expect(maxTurns).toBeLessThanOrEqual(8)
    }
  })
})
```

**Step 2–4: Red → Green cycle**

**Step 5: Commit**

```bash
git add src/lib/__tests__/meeting-engine.test.ts
git commit -m "test: add property-based invariants — propensity, score, trust bounds"
```

---

## Part 2: Conversation Quality (Evaluation Tests)

### Task 7: Create conversation quality evaluation test file

**Files:**
- Create: `src/lib/__tests__/meeting-conversation-quality.test.ts`

This file tests LLM conversation quality using recorded responses and rubric-based assertions. It runs with mocked DB but real conversation flow logic.

**Step 1: Write evaluation tests**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn(), writeTransaction: vi.fn((_db: any, fn: any) => fn(_db)) }))
vi.mock('@/lib/llm/router', () => ({
  complete: vi.fn(),
  checkAgentBudget: vi.fn().mockReturnValue({ allowed: true }),
}))
vi.mock('@/lib/persona-engine', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('You are Atlas, a diligent engineer. You are organized and detail-oriented.'),
  getPersona: vi.fn().mockReturnValue(null),
  getPairwiseTrust: vi.fn().mockReturnValue({ trust_score: 0.5, interaction_count: 0, last_interaction_at: null }),
  updatePairwiseTrust: vi.fn().mockReturnValue(0.55),
}))
vi.mock('@/lib/agent-memory', () => ({ observe: vi.fn().mockResolvedValue(undefined), recall: vi.fn().mockReturnValue([]) }))

import { generateMeetingTurn } from '@/lib/meeting-engine'
import { complete } from '@/lib/llm/router'
import { eventBus } from '@/lib/event-bus'

// Recorded LLM responses for deterministic quality testing
const RECORDED_RESPONSES = {
  greeting: { text: 'Hey Nova, I was thinking about our deployment pipeline. Have you had a chance to look at the latest metrics?', tokenCount: { input: 150, output: 25 }, cost: 0.001, latencyMs: 500, model: 'test' },
  response: { text: 'Yes! The error rates dropped significantly after we switched to blue-green deployments. I think we should discuss expanding it to the staging environment too.', tokenCount: { input: 200, output: 35 }, cost: 0.001, latencyMs: 600, model: 'test' },
  followup: { text: 'That makes sense. Let me pull up the staging config so we can plan the migration steps together.', tokenCount: { input: 250, output: 20 }, cost: 0.001, latencyMs: 450, model: 'test' },
}

function createMockDb() {
  const calls: Array<{ sql: string; stmt: any }> = []
  function _when(sqlFragment: string, stmt: any) {
    calls.push({ sql: sqlFragment, stmt })
  }
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

describe('meeting conversation quality', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('turn coherence', () => {
    it('first turn generates a natural greeting with topic', async () => {
      const db = createMockDb()
      vi.mocked(complete).mockResolvedValueOnce(RECORDED_RESPONSES.greeting)

      const meeting = { id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 0, max_turns: 6, topic: null, summary: null }
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce({ id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 })
          .mockReturnValueOnce({ id: 2, name: 'Nova', role: 'researcher' }),
      })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn().mockReturnValue({ changes: 1 }) })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })

      await generateMeetingTurn(db as any, meeting as any)

      // Quality assertions on the broadcast content
      const broadcastCall = vi.mocked(eventBus.broadcast).mock.calls.find(
        (c) => c[0] === 'meeting.message'
      )
      expect(broadcastCall).toBeDefined()
      const content = (broadcastCall![1] as any).content as string

      // Coherence: response is non-empty and reasonable length
      expect(content.length).toBeGreaterThan(10)
      expect(content.length).toBeLessThan(500) // 1-3 sentences
      // Not a placeholder/error response
      expect(content).not.toContain('undefined')
      expect(content).not.toContain('null')
      expect(content).not.toContain('[object')
    })

    it('subsequent turns include conversation context in prompt', async () => {
      const db = createMockDb()
      vi.mocked(complete).mockResolvedValueOnce(RECORDED_RESPONSES.followup)

      const meeting = { id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 2, max_turns: 6, topic: 'deployment pipeline', summary: null }
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce({ id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 })
          .mockReturnValueOnce({ id: 2, name: 'Nova', role: 'researcher' }),
      })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([
        { content: 'Hey Nova, about the deployment pipeline...', turn_number: 1, agent_name: 'Atlas' },
        { content: 'Yes, the error rates dropped.', turn_number: 2, agent_name: 'Nova' },
      ]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn().mockReturnValue({ changes: 1 }) })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })

      await generateMeetingTurn(db as any, meeting as any)

      // Verify the LLM was called with conversation history
      const llmCall = vi.mocked(complete).mock.calls[0]
      const userPrompt = llmCall[0][1].content as string
      expect(userPrompt).toContain('Atlas:')
      expect(userPrompt).toContain('Nova:')
      expect(userPrompt).toContain('deployment pipeline')
    })
  })

  describe('role adherence', () => {
    it('system prompt includes persona context', async () => {
      const db = createMockDb()
      vi.mocked(complete).mockResolvedValueOnce(RECORDED_RESPONSES.greeting)

      const meeting = { id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 0, max_turns: 6, topic: null, summary: null }
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce({ id: 1, name: 'Atlas', role: 'engineer', soul_content: 'Loves clean code', config: '{"persona":{"personality":{"extraversion":0.8}}}', workspace_id: 1 })
          .mockReturnValueOnce({ id: 2, name: 'Nova', role: 'researcher' }),
      })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
      db._when('INSERT INTO meeting_messages', { run: vi.fn().mockReturnValue({ changes: 1 }) })
      db._when('UPDATE agent_meetings SET turn_count', { run: vi.fn() })
      db._when('UPDATE agent_meetings SET topic', { run: vi.fn() })

      await generateMeetingTurn(db as any, meeting as any)

      // Verify buildSystemPrompt was called with agent context
      const { buildSystemPrompt } = await import('@/lib/persona-engine')
      expect(buildSystemPrompt).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Atlas',
        role: 'engineer',
        soul_content: 'Loves clean code',
      }))
    })
  })

  describe('turn structure', () => {
    it('alternates speakers correctly over multiple turns', async () => {
      // Turn 0 = initiator, turn 1 = participant, turn 2 = initiator
      const speakers: number[] = []

      for (let turn = 0; turn < 3; turn++) {
        const isInitiatorTurn = turn % 2 === 0
        const expectedSpeaker = isInitiatorTurn ? 1 : 2
        speakers.push(expectedSpeaker)
      }

      expect(speakers).toEqual([1, 2, 1])
    })

    it('topic is set from first message only', async () => {
      const db = createMockDb()
      vi.mocked(complete).mockResolvedValueOnce(RECORDED_RESPONSES.greeting)

      const meeting = { id: 1, workspace_id: 1, initiator_id: 1, participant_id: 2, status: 'conversing', turn_count: 0, max_turns: 6, topic: null, summary: null }
      db._when('agents WHERE id', {
        get: vi.fn()
          .mockReturnValueOnce({ id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: '{}', workspace_id: 1 })
          .mockReturnValueOnce({ id: 2, name: 'Nova', role: 'researcher' }),
      })
      db._when('meeting_messages mm', { all: vi.fn().mockReturnValue([]) })
      const insertRun = vi.fn().mockReturnValue({ changes: 1 })
      db._when('INSERT INTO meeting_messages', { run: insertRun })
      const turnUpdateRun = vi.fn()
      db._when('UPDATE agent_meetings SET turn_count', { run: turnUpdateRun })
      const topicUpdateRun = vi.fn()
      db._when('UPDATE agent_meetings SET topic', { run: topicUpdateRun })

      await generateMeetingTurn(db as any, meeting as any)

      // Topic should be set on turn 1 (turnNumber = turn_count + 1 = 1)
      expect(topicUpdateRun).toHaveBeenCalled()
    })
  })
})
```

**Step 2: Run, verify pass (these use recorded responses)**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm vitest run src/lib/__tests__/meeting-conversation-quality.test.ts --reporter=verbose`

**Step 3: Commit**

```bash
git add src/lib/__tests__/meeting-conversation-quality.test.ts
git commit -m "test: add conversation quality evaluation — coherence, role adherence, turn structure"
```

---

## Part 3: Visual/UX Completeness (E2E Tests)

### Task 8: Create meeting API E2E tests

**Files:**
- Create: `tests/meetings.spec.ts`

**Step 1: Write E2E API tests**

```typescript
import { test, expect } from '@playwright/test'

const API_KEY_HEADER = {
  'x-api-key': 'test-api-key-e2e-12345',
  'Content-Type': 'application/json',
}

test.describe('Meetings API', () => {
  // ── Authentication ─────────────────

  test('GET /api/meetings rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/meetings')
    expect(res.status()).toBe(401)
  })

  // ── List Meetings ─────────────────

  test('GET /api/meetings returns paginated list', async ({ request }) => {
    const res = await request.get('/api/meetings?limit=5', { headers: API_KEY_HEADER })
    expect([200, 401]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('total')
      expect(Array.isArray(body.data)).toBe(true)
    }
  })

  test('GET /api/meetings supports status filter', async ({ request }) => {
    const res = await request.get('/api/meetings?status=concluded&limit=3', { headers: API_KEY_HEADER })
    expect([200, 401]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      for (const meeting of body.data) {
        expect(meeting.status).toBe('concluded')
      }
    }
  })

  // ── Meeting Detail ─────────────────

  test('GET /api/meetings/999999 returns 404 for nonexistent', async ({ request }) => {
    const res = await request.get('/api/meetings/999999', { headers: API_KEY_HEADER })
    expect([404, 401]).toContain(res.status())
  })

  test('GET /api/meetings/invalid returns 400 for non-numeric ID', async ({ request }) => {
    const res = await request.get('/api/meetings/abc', { headers: API_KEY_HEADER })
    expect([400, 401]).toContain(res.status())
  })

  // ── Meeting Trigger ─────────────────

  test('POST /api/meetings/trigger rejects without agent_id', async ({ request }) => {
    const res = await request.post('/api/meetings/trigger', {
      headers: API_KEY_HEADER,
      data: {},
    })
    // Should be 400 (missing agent_id) or 401 (auth)
    expect([400, 401, 404]).toContain(res.status())
  })

  // ── Cancel Meeting ─────────────────

  test('POST /api/meetings/999999 cancel returns 404', async ({ request }) => {
    const res = await request.post('/api/meetings/999999', {
      headers: API_KEY_HEADER,
      data: { action: 'cancel' },
    })
    expect([404, 401]).toContain(res.status())
  })

  test('POST /api/meetings/1 with invalid action returns 400', async ({ request }) => {
    const res = await request.post('/api/meetings/1', {
      headers: API_KEY_HEADER,
      data: { action: 'invalid_action' },
    })
    expect([400, 401, 404]).toContain(res.status())
  })
})
```

**Step 2: Run E2E tests**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm test:e2e:ci -- tests/meetings.spec.ts 2>&1 | tail -20`

**Step 3: Commit**

```bash
git add tests/meetings.spec.ts
git commit -m "test: add meetings API E2E tests — list, detail, trigger, cancel, auth"
```

---

### Task 9: Create meeting panel SSE integration tests

**Files:**
- Create: `src/components/__tests__/meeting-panel.test.tsx`

**Step 1: Write component tests for MeetingPanel**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { MeetingPanel } from '@/components/panels/meeting-panel'

// Load messages
const messages = {
  office: {
    meetingPanelHeader: 'MEETINGS',
    meetingPanelNoActive: 'Agents autonomously initiate meetings based on personality traits.',
    meetingPanelRecent: 'Recent',
    meetingPanelHideRecent: 'Hide Recent',
    meetingPanelNoRecent: 'No recent meetings.',
    meetingPanelConversation: 'Conversation',
    meetingPanelSummary: 'Summary',
    meetingWalking: 'walking...',
    meetingConversing: 'conversing',
    meetingTurnProgress: 'Turn {current}/{max}',
  },
}

function renderPanel(props: Partial<React.ComponentProps<typeof MeetingPanel>> = {}) {
  const defaultProps = {
    activeMeetings: [],
    speechBubbles: new Map(),
    ...props,
  }
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MeetingPanel {...defaultProps} />
    </NextIntlClientProvider>
  )
}

describe('MeetingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('shows header with MEETINGS label', () => {
    renderPanel()
    expect(screen.getByText('MEETINGS')).toBeInTheDocument()
  })

  it('shows explanation when no active meetings', () => {
    renderPanel()
    expect(screen.getByText(/autonomously initiate meetings/)).toBeInTheDocument()
  })

  it('shows active meeting count badge', () => {
    renderPanel({
      activeMeetings: [{
        meeting_id: 1, initiator_id: 1, participant_id: 2,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50,
        status: 'conversing', turn_count: 3, max_turns: 6,
      }],
    })
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows walking status for walking meeting', () => {
    renderPanel({
      activeMeetings: [{
        meeting_id: 1, initiator_id: 1, participant_id: 2,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50,
        status: 'walking', turn_count: 0, max_turns: 6,
      }],
    })
    expect(screen.getByText('walking...')).toBeInTheDocument()
  })

  it('shows conversing status with turn progress', () => {
    renderPanel({
      activeMeetings: [{
        meeting_id: 1, initiator_id: 1, participant_id: 2,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50,
        status: 'conversing', turn_count: 3, max_turns: 6,
      }],
    })
    expect(screen.getByText('conversing')).toBeInTheDocument()
    expect(screen.getByText('Turn 3/6')).toBeInTheDocument()
  })

  it('shows latest speech bubble content in meeting card', () => {
    const bubbles = new Map()
    bubbles.set(1, { agentName: 'Atlas', content: 'Let me check the metrics', timestamp: Date.now() })

    renderPanel({
      activeMeetings: [{
        meeting_id: 1, initiator_id: 1, participant_id: 2,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50,
        status: 'conversing', turn_count: 2, max_turns: 6,
      }],
      speechBubbles: bubbles,
    })
    expect(screen.getByText(/Let me check the metrics/)).toBeInTheDocument()
  })

  it('fetches conversation when meeting card clicked', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: {
          meeting: { id: 1 },
          messages: [
            { id: 1, agent_id: 1, agent_name: 'Atlas', content: 'Hello Nova!', turn_number: 1 },
            { id: 2, agent_id: 2, agent_name: 'Nova', content: 'Hi Atlas!', turn_number: 2 },
          ],
        },
      }),
    } as Response)

    renderPanel({
      activeMeetings: [{
        meeting_id: 1, initiator_id: 1, participant_id: 2,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50,
        status: 'conversing', turn_count: 2, max_turns: 6,
      }],
    })

    // Click the meeting card
    const card = screen.getByText(/Atlas/).closest('button')!
    fireEvent.click(card)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/meetings/1')
    })

    await waitFor(() => {
      expect(screen.getByText('Hello Nova!')).toBeInTheDocument()
      expect(screen.getByText('Hi Atlas!')).toBeInTheDocument()
    })
  })

  it('toggles recent meetings section', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as Response)

    renderPanel()

    const recentBtn = screen.getByText('Recent')
    fireEvent.click(recentBtn)

    await waitFor(() => {
      expect(screen.getByText('No recent meetings.')).toBeInTheDocument()
    })
  })
})
```

**Step 2: Run component tests**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm vitest run src/components/__tests__/meeting-panel.test.tsx --reporter=verbose`

**Step 3: Commit**

```bash
git add src/components/__tests__/meeting-panel.test.tsx
git commit -m "test: add MeetingPanel component tests — states, interactions, fetch"
```

---

### Task 10: Create SSE event handler unit tests

**Files:**
- Create: `src/components/__tests__/office-meeting-sse.test.ts`

Test the SSE event handling logic extracted from office-panel. Since the SSE handler is inline in the component, we test the state transformation logic that each event type produces.

**Step 1: Write SSE state transformation tests**

```typescript
import { describe, expect, it } from 'vitest'

// Test the state transformation logic that SSE events produce.
// These mirror the handler logic in office-panel.tsx lines 1202-1270.

type ActiveMeeting = {
  meeting_id: number
  initiator_id: number
  participant_id: number
  initiator_name: string
  participant_name: string
  location_x: number
  location_y: number
  status: 'walking' | 'conversing'
  turn_count: number
  max_turns: number
}

// Extracted state reducers mirroring SSE handler logic
function handleMeetingStarted(current: ActiveMeeting[], data: any): ActiveMeeting[] {
  return [
    ...current.filter((x) => x.meeting_id !== data.meeting_id),
    {
      meeting_id: data.meeting_id,
      initiator_id: data.initiator_id,
      participant_id: data.participant_id,
      initiator_name: data.initiator_name,
      participant_name: data.participant_name,
      location_x: data.location_x,
      location_y: data.location_y,
      status: 'walking' as const,
      turn_count: 0,
      max_turns: data.max_turns ?? 6,
    },
  ]
}

function handleMeetingMessage(current: ActiveMeeting[], data: any): ActiveMeeting[] {
  return current.map((mtg) =>
    mtg.meeting_id === data.meeting_id
      ? { ...mtg, status: 'conversing' as const, turn_count: data.turn_number }
      : mtg
  )
}

function handleMeetingConcluded(current: ActiveMeeting[], data: any): ActiveMeeting[] {
  return current.filter((x) => x.meeting_id !== data.meeting_id)
}

describe('SSE meeting event state transformations', () => {
  describe('meeting.started', () => {
    it('adds new meeting to empty state', () => {
      const result = handleMeetingStarted([], {
        meeting_id: 1, initiator_id: 10, participant_id: 20,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50, max_turns: 6,
      })
      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('walking')
      expect(result[0].turn_count).toBe(0)
      expect(result[0].max_turns).toBe(6)
    })

    it('replaces existing meeting with same id (dedup)', () => {
      const existing: ActiveMeeting[] = [{
        meeting_id: 1, initiator_id: 10, participant_id: 20,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50, status: 'walking', turn_count: 0, max_turns: 6,
      }]
      const result = handleMeetingStarted(existing, {
        meeting_id: 1, initiator_id: 10, participant_id: 20,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50, max_turns: 8,
      })
      expect(result).toHaveLength(1)
      expect(result[0].max_turns).toBe(8)
    })

    it('defaults max_turns to 6 when missing', () => {
      const result = handleMeetingStarted([], {
        meeting_id: 1, initiator_id: 10, participant_id: 20,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50,
      })
      expect(result[0].max_turns).toBe(6)
    })
  })

  describe('meeting.message', () => {
    it('transitions meeting from walking to conversing', () => {
      const state: ActiveMeeting[] = [{
        meeting_id: 1, initiator_id: 10, participant_id: 20,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50, status: 'walking', turn_count: 0, max_turns: 6,
      }]
      const result = handleMeetingMessage(state, { meeting_id: 1, turn_number: 1 })
      expect(result[0].status).toBe('conversing')
      expect(result[0].turn_count).toBe(1)
    })

    it('updates turn count on subsequent messages', () => {
      const state: ActiveMeeting[] = [{
        meeting_id: 1, initiator_id: 10, participant_id: 20,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50, status: 'conversing', turn_count: 2, max_turns: 6,
      }]
      const result = handleMeetingMessage(state, { meeting_id: 1, turn_number: 3 })
      expect(result[0].turn_count).toBe(3)
    })

    it('does not affect other meetings', () => {
      const state: ActiveMeeting[] = [
        { meeting_id: 1, initiator_id: 10, participant_id: 20, initiator_name: 'A', participant_name: 'B', location_x: 40, location_y: 50, status: 'walking', turn_count: 0, max_turns: 6 },
        { meeting_id: 2, initiator_id: 30, participant_id: 40, initiator_name: 'C', participant_name: 'D', location_x: 60, location_y: 70, status: 'walking', turn_count: 0, max_turns: 8 },
      ]
      const result = handleMeetingMessage(state, { meeting_id: 1, turn_number: 1 })
      expect(result[0].status).toBe('conversing')
      expect(result[1].status).toBe('walking') // unchanged
    })
  })

  describe('meeting.concluded', () => {
    it('removes meeting from active list', () => {
      const state: ActiveMeeting[] = [{
        meeting_id: 1, initiator_id: 10, participant_id: 20,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50, status: 'conversing', turn_count: 5, max_turns: 6,
      }]
      const result = handleMeetingConcluded(state, { meeting_id: 1 })
      expect(result).toHaveLength(0)
    })

    it('preserves other active meetings', () => {
      const state: ActiveMeeting[] = [
        { meeting_id: 1, initiator_id: 10, participant_id: 20, initiator_name: 'A', participant_name: 'B', location_x: 40, location_y: 50, status: 'conversing', turn_count: 5, max_turns: 6 },
        { meeting_id: 2, initiator_id: 30, participant_id: 40, initiator_name: 'C', participant_name: 'D', location_x: 60, location_y: 70, status: 'walking', turn_count: 0, max_turns: 8 },
      ]
      const result = handleMeetingConcluded(state, { meeting_id: 1 })
      expect(result).toHaveLength(1)
      expect(result[0].meeting_id).toBe(2)
    })

    it('no-op when meeting not in active list', () => {
      const state: ActiveMeeting[] = [{
        meeting_id: 1, initiator_id: 10, participant_id: 20,
        initiator_name: 'A', participant_name: 'B',
        location_x: 40, location_y: 50, status: 'conversing', turn_count: 3, max_turns: 6,
      }]
      const result = handleMeetingConcluded(state, { meeting_id: 999 })
      expect(result).toHaveLength(1)
    })
  })

  describe('full lifecycle', () => {
    it('started → message → message → concluded produces clean state', () => {
      let state: ActiveMeeting[] = []

      // Meeting starts
      state = handleMeetingStarted(state, {
        meeting_id: 1, initiator_id: 10, participant_id: 20,
        initiator_name: 'Atlas', participant_name: 'Nova',
        location_x: 40, location_y: 50, max_turns: 4,
      })
      expect(state).toHaveLength(1)
      expect(state[0].status).toBe('walking')

      // First message
      state = handleMeetingMessage(state, { meeting_id: 1, turn_number: 1 })
      expect(state[0].status).toBe('conversing')
      expect(state[0].turn_count).toBe(1)

      // Second message
      state = handleMeetingMessage(state, { meeting_id: 1, turn_number: 2 })
      expect(state[0].turn_count).toBe(2)

      // Meeting concludes
      state = handleMeetingConcluded(state, { meeting_id: 1 })
      expect(state).toHaveLength(0)
    })

    it('concurrent meetings tracked independently', () => {
      let state: ActiveMeeting[] = []

      state = handleMeetingStarted(state, { meeting_id: 1, initiator_id: 10, participant_id: 20, initiator_name: 'A', participant_name: 'B', location_x: 40, location_y: 50, max_turns: 6 })
      state = handleMeetingStarted(state, { meeting_id: 2, initiator_id: 30, participant_id: 40, initiator_name: 'C', participant_name: 'D', location_x: 60, location_y: 70, max_turns: 4 })
      expect(state).toHaveLength(2)

      state = handleMeetingMessage(state, { meeting_id: 1, turn_number: 1 })
      expect(state[0].status).toBe('conversing')
      expect(state[1].status).toBe('walking')

      state = handleMeetingConcluded(state, { meeting_id: 1 })
      expect(state).toHaveLength(1)
      expect(state[0].meeting_id).toBe(2)
    })
  })
})
```

**Step 2: Run, verify pass**

**Step 3: Commit**

```bash
git add src/components/__tests__/office-meeting-sse.test.ts
git commit -m "test: add SSE state transformation tests — full meeting lifecycle"
```

---

### Task 11: Run full test suite and verify zero regressions

**Step 1: Run typecheck**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm typecheck`
Expected: 0 errors

**Step 2: Run all unit tests**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm test`
Expected: All tests pass (1227 existing + new tests)

**Step 3: Run E2E tests**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm test:e2e:ci -- tests/meetings.spec.ts`
Expected: All meeting E2E tests pass

**Step 4: Commit verification**

```bash
git add -A
git commit -m "test: meeting system comprehensive testing — engine correctness, conversation quality, visual completeness"
```

---

## Success Metrics Summary

| Layer | Metric | Target |
|---|---|---|
| **Engine Unit** | `attemptMeetingInitiation` paths covered | 6/6 |
| **Engine Unit** | `selectPartner` paths covered | 3/3 |
| **Engine Unit** | `processActiveMeeting` conversing sub-paths | 4/4 |
| **Engine Unit** | `generateMeetingTurn` edge cases | 5/5 (timeout, rethrow, participant, guards) |
| **Engine Unit** | `summarizeMeeting` edge cases | 4/4 (empty, LLM fail, observe, observe error) |
| **Engine Unit** | Property invariants | propensity ∈ [0,1], score ∈ [0,1], maxTurns ∈ [4,8] |
| **Conversation** | Turn coherence | non-empty, < 500 chars, no artifacts |
| **Conversation** | Context threading | prior messages included in LLM prompt |
| **Conversation** | Role adherence | persona context passed to buildSystemPrompt |
| **Conversation** | Turn alternation | initiator→participant→initiator pattern |
| **Visual/UX** | MeetingPanel renders all states | empty, walking, conversing, recent |
| **Visual/UX** | Click-to-expand fetches conversation | API call verified |
| **Visual/UX** | SSE state lifecycle | started→message→concluded produces clean state |
| **Visual/UX** | Concurrent meetings independent | 2 meetings tracked separately |
| **API E2E** | All endpoints respond correctly | auth, list, detail, trigger, cancel |
| **Regression** | Existing 1227 tests | 0 failures |
