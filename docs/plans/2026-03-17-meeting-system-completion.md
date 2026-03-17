# Meeting System Completion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the meeting system with 5 features: meeting-driven task creation, trust-weighted collaborator suggestions, meeting scheduling, analytics dashboard, and conversation quality scoring — making the autonomous meeting engine production-useful for demo, operations, and research.

**Architecture:** Each feature is a self-contained module that hooks into the existing meeting lifecycle via the post-summarization async phase pattern. New DB columns added via phase migrations. New API routes follow existing REST conventions. Analytics panel uses recharts (already in project). All LLM calls outside transactions with timeouts and fallbacks.

**Tech Stack:** Next.js 16, TypeScript 5, SQLite (better-sqlite3), Vitest 2.1.5, recharts, next-intl, Zustand

---

## Prerequisites

Before starting, verify:
```bash
cd "/Users/oudaymneimneh/Mission Control"
pnpm typecheck   # 0 errors
pnpm test         # 1275/1275 pass
```

## Conventions Reference

- **DB mocks:** `createMockDb()` with `._when(sqlFragment, stmt)` in tests
- **Migrations:** `phase-migrations.ts`, function `{ id: 'phase_NNN_name', up: (db) => { db.exec(...) } }`
- **API routes:** `requireRole(request, 'viewer'|'operator')`, return `NextResponse.json({ data, total })`
- **Events:** `eventBus.broadcast('entity.action', { workspace_id, ...payload })` AFTER writeTransaction
- **LLM calls:** `complete([messages], { agentId, workspaceId, taskType })` with `Promise.race` timeout
- **i18n:** Keys in `messages/en.json` under feature namespace, accessed via `useTranslations('namespace')`
- **No Co-Authored-By trailers** on commits

---

## Feature 1: Meeting-Driven Task Creation

### Task 1: Migration — add meeting source columns to tasks

**Files:**
- Modify: `src/lib/phase-migrations.ts`

**Step 1: Add migration**

Add after the last migration entry in the `phaseMigrations` array:

```typescript
{
  id: 'phase_059_meeting_task_source',
  up: (db: Database.Database) => {
    const cols = db.pragma('table_info(tasks)') as Array<{ name: string }>
    const colNames = cols.map(c => c.name)
    if (!colNames.includes('source_type')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN source_type TEXT`)
    }
    if (!colNames.includes('source_id')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN source_id INTEGER`)
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source_type, source_id)`)
  }
}
```

**Step 2: Verify migration runs**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm typecheck`

**Step 3: Commit**

```bash
git add src/lib/phase-migrations.ts
git commit -m "feat: add source_type/source_id columns to tasks for meeting traceability"
```

---

### Task 2: Meeting action extraction module

**Files:**
- Create: `src/lib/meeting-actions.ts`
- Create: `src/lib/__tests__/meeting-actions.test.ts`

**Step 1: Write tests**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/llm/router', () => ({
  complete: vi.fn(),
  checkAgentBudget: vi.fn().mockReturnValue({ allowed: true }),
}))

import { extractMeetingActions } from '@/lib/meeting-actions'
import { complete } from '@/lib/llm/router'

describe('extractMeetingActions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('extracts actions from transcript', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: JSON.stringify([
        { title: 'Update deployment config', description: 'Switch staging to blue-green', assignee: 'Atlas' },
        { title: 'Review metrics dashboard', description: 'Check error rate trends', assignee: 'Nova' },
      ]),
      tokenCount: { input: 200, output: 100 }, cost: 0.002, latencyMs: 800, model: 'test',
    })

    const result = await extractMeetingActions({
      transcript: 'Atlas: Let me update the deployment config.\nNova: I will review the metrics.',
      summary: 'Discussed deployment pipeline improvements.',
      participants: [{ id: 1, name: 'Atlas' }, { id: 2, name: 'Nova' }],
      workspaceId: 1,
    })

    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('Update deployment config')
    expect(result[0].assignee_name).toBe('Atlas')
    expect(result[1].assignee_name).toBe('Nova')
  })

  it('returns empty array when LLM returns no actions', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: '[]', tokenCount: { input: 100, output: 5 }, cost: 0.001, latencyMs: 300, model: 'test',
    })

    const result = await extractMeetingActions({
      transcript: 'Atlas: Nice weather today.\nNova: Indeed.',
      summary: 'Casual chat.',
      participants: [{ id: 1, name: 'Atlas' }, { id: 2, name: 'Nova' }],
      workspaceId: 1,
    })

    expect(result).toHaveLength(0)
  })

  it('returns empty array on LLM timeout', async () => {
    vi.mocked(complete).mockRejectedValueOnce(new Error('timeout'))

    const result = await extractMeetingActions({
      transcript: 'Atlas: Let me fix the bug.',
      summary: 'Bug discussion.',
      participants: [{ id: 1, name: 'Atlas' }, { id: 2, name: 'Nova' }],
      workspaceId: 1,
    })

    expect(result).toHaveLength(0)
  })

  it('caps actions at 3 maximum', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: JSON.stringify([
        { title: 'A1', description: 'd1', assignee: 'Atlas' },
        { title: 'A2', description: 'd2', assignee: 'Nova' },
        { title: 'A3', description: 'd3', assignee: 'Atlas' },
        { title: 'A4', description: 'd4', assignee: 'Nova' },
      ]),
      tokenCount: { input: 200, output: 150 }, cost: 0.003, latencyMs: 900, model: 'test',
    })

    const result = await extractMeetingActions({
      transcript: 'Long meeting...',
      summary: 'Many action items.',
      participants: [{ id: 1, name: 'Atlas' }, { id: 2, name: 'Nova' }],
      workspaceId: 1,
    })

    expect(result).toHaveLength(3)
  })
})
```

**Step 2: Implement**

```typescript
// src/lib/meeting-actions.ts
import { logger } from '@/lib/logger'
import { complete } from '@/lib/llm/router'

interface MeetingActionInput {
  transcript: string
  summary: string
  participants: Array<{ id: number; name: string }>
  workspaceId: number
}

interface ExtractedAction {
  title: string
  description: string
  assignee_name: string
  assignee_id: number | null
}

const EXTRACTION_TIMEOUT_MS = 8_000
const MAX_ACTIONS = 3

export async function extractMeetingActions(input: MeetingActionInput): Promise<ExtractedAction[]> {
  const { transcript, summary, participants, workspaceId } = input
  const participantNames = participants.map(p => p.name).join(', ')

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const llmPromise = complete(
      [
        {
          role: 'system',
          content: `You extract action items from meeting transcripts. Return a JSON array of 0-3 items. Each item: {"title": "short title", "description": "one sentence", "assignee": "exact participant name"}. Participants: ${participantNames}. Return [] if no concrete actions were discussed. Only include specific, actionable commitments — not vague ideas.`,
        },
        {
          role: 'user',
          content: `Meeting summary: ${summary}\n\nTranscript:\n${transcript.slice(0, 2000)}`,
        },
      ],
      { agentId: participants[0]?.id ?? 0, workspaceId, taskType: 'extraction' }
    )

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('action_extraction_timeout')), EXTRACTION_TIMEOUT_MS)
    })

    const response = await Promise.race([llmPromise, timeoutPromise])
    const text = response.text.trim()

    // Parse JSON — handle markdown code blocks
    const jsonStr = text.replace(/^```json?\s*/, '').replace(/\s*```$/, '')
    const raw = JSON.parse(jsonStr)

    if (!Array.isArray(raw)) return []

    const actions: ExtractedAction[] = raw.slice(0, MAX_ACTIONS).map((item: any) => {
      const assigneeName = String(item.assignee || '').trim()
      const matchedParticipant = participants.find(
        p => p.name.toLowerCase() === assigneeName.toLowerCase()
      )
      return {
        title: String(item.title || '').slice(0, 200),
        description: String(item.description || '').slice(0, 500),
        assignee_name: matchedParticipant?.name ?? assigneeName,
        assignee_id: matchedParticipant?.id ?? null,
      }
    }).filter((a: ExtractedAction) => a.title.length > 0)

    return actions
  } catch (err) {
    logger.warn({ err }, 'Meeting action extraction failed')
    return []
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
```

**Step 3: Run tests, verify pass**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm vitest run src/lib/__tests__/meeting-actions.test.ts --reporter=verbose`

**Step 4: Commit**

```bash
git add src/lib/meeting-actions.ts src/lib/__tests__/meeting-actions.test.ts
git commit -m "feat: add meeting action extraction module with LLM + timeout + tests"
```

---

### Task 3: Wire action extraction into meeting lifecycle

**Files:**
- Modify: `src/lib/meeting-engine.ts` (add Phase 4b after observe calls)
- Modify: `src/lib/event-bus.ts` (add `meeting.actions_created` event type)

**Step 1: Add event type**

In `event-bus.ts`, after `meeting.concluded` line:

```typescript
'meeting.actions_created': { meeting_id: number; workspace_id: number; actions: Array<{ title: string; assignee_name: string }> }
```

**Step 2: Add action extraction to summarizeMeeting**

In `meeting-engine.ts`, after the Phase 4 observe calls (after line ~671), before Phase 5 broadcasts:

```typescript
  // Phase 4b: Extract action items (async, non-critical)
  if (messages.length >= 3) {
    try {
      const { extractMeetingActions } = await import('@/lib/meeting-actions')
      const actions = await extractMeetingActions({
        transcript,
        summary,
        participants: [
          { id: meeting.initiator_id, name: initiator.name },
          { id: meeting.participant_id, name: db.prepare('SELECT name FROM agents WHERE id = ?').get(meeting.participant_id)?.name || 'Unknown' },
        ],
        workspaceId: meeting.workspace_id,
      })

      if (actions.length > 0) {
        for (const action of actions) {
          try {
            db.prepare(`
              INSERT INTO tasks (title, description, assigned_to, status, priority, source_type, source_id, workspace_id, created_at, updated_at)
              VALUES (?, ?, ?, 'inbox', 'medium', 'meeting', ?, ?, unixepoch(), unixepoch())
            `).run(action.title, action.description, action.assignee_name, meeting.id, meeting.workspace_id)
          } catch { /* task creation is best-effort */ }
        }

        eventBus.broadcast('meeting.actions_created', {
          meeting_id: meeting.id,
          workspace_id: meeting.workspace_id,
          actions: actions.map(a => ({ title: a.title, assignee_name: a.assignee_name })),
        })
      }
    } catch (err) {
      logger.warn({ err, meetingId: meeting.id }, 'Action extraction failed')
    }
  }
```

**Step 3: Run full test suite**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm test`
Expected: All pass (action extraction is async import, won't break existing mocks)

**Step 4: Commit**

```bash
git add src/lib/meeting-engine.ts src/lib/event-bus.ts
git commit -m "feat: wire meeting action extraction into summarization lifecycle"
```

---

## Feature 2: Meeting Quality Scoring

### Task 4: Migration — add quality_score column

**Files:**
- Modify: `src/lib/phase-migrations.ts`

**Step 1: Add migration**

```typescript
{
  id: 'phase_060_meeting_quality',
  up: (db: Database.Database) => {
    const cols = db.pragma('table_info(agent_meetings)') as Array<{ name: string }>
    const colNames = cols.map(c => c.name)
    if (!colNames.includes('quality_score')) {
      db.exec(`ALTER TABLE agent_meetings ADD COLUMN quality_score TEXT`)
    }
    if (!colNames.includes('scheduled_for')) {
      db.exec(`ALTER TABLE agent_meetings ADD COLUMN scheduled_for INTEGER`)
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/phase-migrations.ts
git commit -m "feat: add quality_score and scheduled_for columns to agent_meetings"
```

---

### Task 5: Quality evaluation module

**Files:**
- Create: `src/lib/meeting-quality.ts`
- Create: `src/lib/__tests__/meeting-quality.test.ts`

**Step 1: Write tests**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/llm/router', () => ({
  complete: vi.fn(),
  checkAgentBudget: vi.fn().mockReturnValue({ allowed: true }),
}))

import { evaluateMeetingQuality, type QualityScore } from '@/lib/meeting-quality'
import { complete } from '@/lib/llm/router'

describe('evaluateMeetingQuality', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns parsed quality scores from LLM', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: JSON.stringify({ coherence: 4, actionability: 3, role_adherence: 5 }),
      tokenCount: { input: 150, output: 30 }, cost: 0.001, latencyMs: 400, model: 'test',
    })

    const result = await evaluateMeetingQuality('Atlas: Hi\nNova: Hello', 'Greeting exchange', 1, 1)
    expect(result.coherence).toBe(4)
    expect(result.actionability).toBe(3)
    expect(result.role_adherence).toBe(5)
  })

  it('returns neutral scores on LLM failure', async () => {
    vi.mocked(complete).mockRejectedValueOnce(new Error('timeout'))

    const result = await evaluateMeetingQuality('Atlas: Hi', 'Chat', 1, 1)
    expect(result).toEqual({ coherence: 3, actionability: 3, role_adherence: 3 })
  })

  it('clamps scores to 1-5 range', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: JSON.stringify({ coherence: 0, actionability: 7, role_adherence: -1 }),
      tokenCount: { input: 150, output: 30 }, cost: 0.001, latencyMs: 400, model: 'test',
    })

    const result = await evaluateMeetingQuality('Atlas: Hi', 'Chat', 1, 1)
    expect(result.coherence).toBe(1)
    expect(result.actionability).toBe(5)
    expect(result.role_adherence).toBe(1)
  })
})
```

**Step 2: Implement**

```typescript
// src/lib/meeting-quality.ts
import { logger } from '@/lib/logger'
import { complete } from '@/lib/llm/router'

export interface QualityScore {
  coherence: number      // 1-5
  actionability: number  // 1-5
  role_adherence: number // 1-5
}

const NEUTRAL_SCORE: QualityScore = { coherence: 3, actionability: 3, role_adherence: 3 }
const QUALITY_TIMEOUT_MS = 5_000

function clampScore(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 3
  return Math.max(1, Math.min(5, Math.round(n)))
}

export async function evaluateMeetingQuality(
  transcript: string,
  summary: string,
  agentId: number,
  workspaceId: number,
): Promise<QualityScore> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const llmPromise = complete(
      [
        {
          role: 'system',
          content: 'Rate this meeting transcript on 3 dimensions (1-5 each). Return JSON only: {"coherence": N, "actionability": N, "role_adherence": N}. coherence=logical flow, actionability=concrete outcomes discussed, role_adherence=agents stayed in character.',
        },
        { role: 'user', content: `Summary: ${summary}\n\nTranscript:\n${transcript.slice(0, 1500)}` },
      ],
      { agentId, workspaceId, taskType: 'evaluation' }
    )

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('quality_eval_timeout')), QUALITY_TIMEOUT_MS)
    })

    const response = await Promise.race([llmPromise, timeoutPromise])
    const text = response.text.trim().replace(/^```json?\s*/, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(text)

    return {
      coherence: clampScore(parsed.coherence),
      actionability: clampScore(parsed.actionability),
      role_adherence: clampScore(parsed.role_adherence),
    }
  } catch (err) {
    logger.warn({ err }, 'Meeting quality evaluation failed, using neutral scores')
    return NEUTRAL_SCORE
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
```

**Step 3: Run tests, verify pass. Commit.**

```bash
git add src/lib/meeting-quality.ts src/lib/__tests__/meeting-quality.test.ts
git commit -m "feat: add meeting quality evaluation module with 1-5 scoring"
```

---

### Task 6: Wire quality scoring into meeting lifecycle

**Files:**
- Modify: `src/lib/meeting-engine.ts`

In `summarizeMeeting`, after action extraction (Phase 4b), add Phase 4c:

```typescript
  // Phase 4c: Quality evaluation (async, non-critical)
  try {
    const { evaluateMeetingQuality } = await import('@/lib/meeting-quality')
    const quality = await evaluateMeetingQuality(transcript, summary, meeting.initiator_id, meeting.workspace_id)
    db.prepare('UPDATE agent_meetings SET quality_score = ? WHERE id = ?').run(JSON.stringify(quality), meeting.id)

    // Low-quality meeting triggers reflection
    const avg = (quality.coherence + quality.actionability + quality.role_adherence) / 3
    if (avg < 2.5) {
      const participantName = db.prepare('SELECT name FROM agents WHERE id = ?').get(meeting.participant_id) as { name: string } | undefined
      const reflection = `Recent meeting with ${participantName?.name || 'a colleague'} scored low on quality (${avg.toFixed(1)}/5). Consider being more focused and action-oriented in future meetings.`
      try { await observe(meeting.initiator_id, reflection, meeting.workspace_id) } catch { /* */ }
      try { await observe(meeting.participant_id, reflection, meeting.workspace_id) } catch { /* */ }
    }
  } catch (err) {
    logger.warn({ err, meetingId: meeting.id }, 'Quality evaluation failed')
  }
```

**Step 1: Make the edit. Step 2: Run `pnpm test`. Step 3: Commit.**

```bash
git add src/lib/meeting-engine.ts
git commit -m "feat: wire quality scoring into meeting lifecycle with low-quality reflection"
```

---

## Feature 3: Meeting Scheduling

### Task 7: Schedule meeting API + engine integration

**Files:**
- Create: `src/app/api/meetings/schedule/route.ts`
- Modify: `src/lib/meeting-engine.ts` (add `createScheduledMeeting` function)
- Modify: `src/lib/simulation-engine.ts` (add P0 scheduled meeting check)
- Modify: `src/lib/event-bus.ts` (add `meeting.scheduled` event)

**Step 1: Add event type to event-bus.ts**

```typescript
'meeting.scheduled': { meeting_id: number; workspace_id: number; initiator_id: number; participant_id: number; initiator_name: string; participant_name: string; topic: string | null; scheduled_for: number | null }
```

**Step 2: Add createScheduledMeeting to meeting-engine.ts**

```typescript
export function createScheduledMeeting(
  db: Database.Database,
  initiatorId: number,
  participantId: number,
  workspaceId: number,
  topic?: string,
  scheduledFor?: number,
): MeetingRow {
  // Validate both agents exist
  const initiator = db.prepare('SELECT id, name, role, status, soul_content, config, workspace_id FROM agents WHERE id = ?').get(initiatorId) as AgentForMeeting | undefined
  const participant = db.prepare('SELECT id, name, role, status, soul_content, config, workspace_id FROM agents WHERE id = ?').get(participantId) as AgentForMeeting | undefined
  if (!initiator || !participant) throw new Error('Agent not found')
  if (initiator.workspace_id !== workspaceId || participant.workspace_id !== workspaceId) throw new Error('Agents must be in same workspace')

  // Check scheduled meeting limit (max 5 per workspace)
  const scheduled = db.prepare(`SELECT COUNT(*) as cnt FROM agent_meetings WHERE workspace_id = ? AND status = 'scheduled'`).get(workspaceId) as { cnt: number }
  if (scheduled.cnt >= 5) throw new Error('Maximum scheduled meetings reached')

  const maxTurns = 6 // Default for scheduled meetings
  const now = Math.floor(Date.now() / 1000)

  const meeting = writeTransaction(db, (tx) => {
    const result = tx.prepare(`
      INSERT INTO agent_meetings (workspace_id, initiator_id, participant_id, status, topic, max_turns, scheduled_for, created_at)
      VALUES (?, ?, ?, 'scheduled', ?, ?, ?, ?)
    `).run(workspaceId, initiatorId, participantId, topic || null, maxTurns, scheduledFor || null, now)
    return tx.prepare('SELECT * FROM agent_meetings WHERE id = ?').get(Number(result.lastInsertRowid)) as MeetingRow
  })

  eventBus.broadcast('meeting.scheduled', {
    meeting_id: meeting.id,
    workspace_id: workspaceId,
    initiator_id: initiatorId,
    participant_id: participantId,
    initiator_name: initiator.name,
    participant_name: participant.name,
    topic: topic || null,
    scheduled_for: scheduledFor || null,
  })

  return meeting
}
```

**Step 3: Add P0 check to simulation-engine.ts**

In `agentTick`, before the "Priority 1" block:

```typescript
  // Priority 0: Scheduled meetings — check if any are ready to start
  try {
    if (!this.config.dryRun) {
      const db = getDatabase()
      const now = Math.floor(Date.now() / 1000)
      const scheduled = db.prepare(`
        SELECT * FROM agent_meetings
        WHERE workspace_id = ? AND status = 'scheduled'
          AND (initiator_id = ? OR participant_id = ?)
          AND (scheduled_for IS NULL OR scheduled_for <= ?)
        LIMIT 1
      `).get(agent.workspace_id, agent.id, agent.id, now) as MeetingRow | undefined

      if (scheduled && canInitiateMeeting(db, scheduled.initiator_id, scheduled.workspace_id)) {
        const initiator = db.prepare('SELECT id, name, role, status, soul_content, config, workspace_id FROM agents WHERE id = ?').get(scheduled.initiator_id) as AgentForMeeting
        const participant = db.prepare('SELECT id, name, role, status, soul_content, config, workspace_id FROM agents WHERE id = ?').get(scheduled.participant_id) as AgentForMeeting
        if (initiator && participant) {
          // Delete the scheduled row and create a real meeting
          db.prepare('DELETE FROM agent_meetings WHERE id = ?').run(scheduled.id)
          createMeeting(db, initiator, participant)
          state.lastActionTime = now
          return
        }
      }
    }
  } catch (err) {
    logger.warn({ err, agentId: agent.id }, 'Scheduled meeting check failed')
  }
```

**Step 4: Create API route**

```typescript
// src/app/api/meetings/schedule/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { createScheduledMeeting } from '@/lib/meeting-engine'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const { initiator_id, participant_id, topic, scheduled_for } = body

  if (!initiator_id || !participant_id) {
    return NextResponse.json({ error: 'initiator_id and participant_id required' }, { status: 400 })
  }
  if (initiator_id === participant_id) {
    return NextResponse.json({ error: 'Cannot schedule meeting with self' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const meeting = createScheduledMeeting(db, initiator_id, participant_id, workspaceId, topic, scheduled_for)
    return NextResponse.json({ data: meeting }, { status: 201 })
  } catch (err: any) {
    const msg = err?.message || 'Failed to schedule meeting'
    const status = msg.includes('not found') ? 404 : msg.includes('Maximum') ? 429 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
```

**Step 5: Run tests. Commit.**

```bash
git add src/lib/meeting-engine.ts src/lib/simulation-engine.ts src/lib/event-bus.ts src/app/api/meetings/schedule/route.ts
git commit -m "feat: add meeting scheduling — API, P0 engine integration, scheduled status"
```

---

## Feature 4: Trust-Weighted Collaborator Suggestions

### Task 8: Collaborator suggestion API

**Files:**
- Modify: `src/lib/persona-engine.ts` (add `suggestCollaborators` function)
- Create: `src/app/api/agents/[id]/collaborators/route.ts`
- Create: `src/lib/__tests__/suggest-collaborators.test.ts`

**Step 1: Write tests**

```typescript
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
  })

  it('returns empty array when no trust data', () => {
    const db = createMockDb()
    db._when('agent_pairwise_trust', { all: vi.fn().mockReturnValue([]) })

    const result = suggestCollaborators(db as any, 1, 1)
    expect(result).toHaveLength(0)
  })
})
```

**Step 2: Implement in persona-engine.ts**

```typescript
export function suggestCollaborators(
  db: Database.Database,
  agentId: number,
  workspaceId: number,
  limit = 5,
): Array<{ agent_id: number; name: string; role: string; trust_score: number; interaction_count: number }> {
  const trustEdges = db.prepare(`
    SELECT target_agent_id, trust_score, interaction_count
    FROM agent_pairwise_trust
    WHERE source_agent_id = ? AND workspace_id = ?
      AND interaction_count >= 2
    ORDER BY trust_score DESC
    LIMIT ?
  `).all(agentId, workspaceId, limit) as Array<{ target_agent_id: number; trust_score: number; interaction_count: number }>

  if (trustEdges.length === 0) return []

  const ids = trustEdges.map(e => e.target_agent_id)
  const placeholders = ids.map(() => '?').join(',')
  const agents = db.prepare(`SELECT id, name, role, status FROM agents WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: number; name: string; role: string; status: string }>
  const agentMap = new Map(agents.map(a => [a.id, a]))

  return trustEdges
    .map(edge => {
      const agent = agentMap.get(edge.target_agent_id)
      if (!agent) return null
      return {
        agent_id: edge.target_agent_id,
        name: agent.name,
        role: agent.role,
        trust_score: edge.trust_score,
        interaction_count: edge.interaction_count,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}
```

**Step 3: Create API route**

```typescript
// src/app/api/agents/[id]/collaborators/route.ts
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
```

**Step 4: Run tests. Commit.**

```bash
git add src/lib/persona-engine.ts src/lib/__tests__/suggest-collaborators.test.ts src/app/api/agents/[id]/collaborators/route.ts
git commit -m "feat: add trust-weighted collaborator suggestions API"
```

---

## Feature 5: Meeting Analytics Dashboard

### Task 9: Analytics aggregation API

**Files:**
- Create: `src/app/api/meetings/analytics/route.ts`

**Step 1: Implement**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'

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

    // Average turns per meeting
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

    // Meetings per agent
    const meetingsPerAgent = db.prepare(`
      SELECT a.name, COUNT(*) as meeting_count
      FROM (
        SELECT initiator_id as agent_id FROM agent_meetings WHERE workspace_id = ? AND status = 'concluded'
        UNION ALL
        SELECT participant_id as agent_id FROM agent_meetings WHERE workspace_id = ? AND status = 'concluded'
      ) sub
      JOIN agents a ON sub.agent_id = a.id
      GROUP BY a.id ORDER BY meeting_count DESC
    `).all(workspaceId, workspaceId) as Array<{ name: string; meeting_count: number }>

    // Average quality scores
    const qualityAvg = db.prepare(`
      SELECT quality_score FROM agent_meetings
      WHERE workspace_id = ? AND status = 'concluded' AND quality_score IS NOT NULL
      ORDER BY concluded_at DESC LIMIT 50
    `).all(workspaceId) as Array<{ quality_score: string }>

    const qualityScores = qualityAvg
      .map(r => { try { return JSON.parse(r.quality_score) } catch { return null } })
      .filter(Boolean)

    const avgQuality = qualityScores.length > 0 ? {
      coherence: qualityScores.reduce((s, q) => s + q.coherence, 0) / qualityScores.length,
      actionability: qualityScores.reduce((s, q) => s + q.actionability, 0) / qualityScores.length,
      role_adherence: qualityScores.reduce((s, q) => s + q.role_adherence, 0) / qualityScores.length,
    } : null

    return NextResponse.json({
      data: {
        meetings_per_day: meetingsPerDay,
        avg_turns: avgTurns.avg_turns ?? 0,
        top_pairs: topPairs,
        trust_network: trustNetwork,
        meetings_per_agent: meetingsPerAgent,
        avg_quality: avgQuality,
        total_concluded: meetingsPerDay.reduce((s, d) => s + d.count, 0),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to get analytics' }, { status: 500 })
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/meetings/analytics/route.ts
git commit -m "feat: add meeting analytics aggregation API"
```

---

### Task 10: Meeting analytics panel component

**Files:**
- Create: `src/components/panels/meeting-analytics-panel.tsx`
- Modify: `messages/en.json` (add ~20 analytics keys)

**Step 1: Add i18n keys to en.json**

Under `"office"` section, add:

```json
"analyticsTitle": "Meeting Analytics",
"analyticsMeetingTrend": "Meetings / Day",
"analyticsMeetingsPerAgent": "Meetings per Agent",
"analyticsTopPairs": "Top Pairs",
"analyticsTrustNetwork": "Trust Network",
"analyticsQualityScores": "Avg Quality",
"analyticsCoherence": "Coherence",
"analyticsActionability": "Actionability",
"analyticsRoleAdherence": "Role Adherence",
"analyticsNoData": "No meeting data yet. Meetings will appear here as agents interact.",
"analyticsTotalMeetings": "Total Concluded",
"analyticsAvgTurns": "Avg Turns",
"analyticsMeetings": "meetings",
"analyticsScore": "{score}/5"
```

**Step 2: Create the analytics panel**

```typescript
// src/components/panels/meeting-analytics-panel.tsx
'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

interface AnalyticsData {
  meetings_per_day: Array<{ day: string; count: number }>
  avg_turns: number
  top_pairs: Array<{ initiator_name: string; participant_name: string; meeting_count: number }>
  trust_network: Array<{ source_name: string; target_name: string; trust_score: number; interaction_count: number }>
  meetings_per_agent: Array<{ name: string; meeting_count: number }>
  avg_quality: { coherence: number; actionability: number; role_adherence: number } | null
  total_concluded: number
}

export function MeetingAnalyticsPanel() {
  const t = useTranslations('office')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const res = await fetch('/api/meetings/analytics')
        if (res.ok) {
          const json = await res.json()
          setData(json.data)
        }
      } catch { /* best-effort */ }
      setLoading(false)
    }
    fetchAnalytics()
    const interval = setInterval(fetchAnalytics, 30_000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [])

  if (loading) return <div className="text-muted-foreground text-sm p-6">{t('meetingPanelLoading')}</div>
  if (!data) return <div className="text-muted-foreground text-sm p-6">{t('analyticsNoData')}</div>

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">{t('analyticsTitle')}</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-void-cyan">{data.total_concluded}</div>
          <div className="text-xs text-muted-foreground">{t('analyticsTotalMeetings')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-void-mint">{data.avg_turns.toFixed(1)}</div>
          <div className="text-xs text-muted-foreground">{t('analyticsAvgTurns')}</div>
        </div>
        {data.avg_quality && (
          <>
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-void-amber">{data.avg_quality.coherence.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">{t('analyticsCoherence')}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-violet-400">{data.avg_quality.actionability.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">{t('analyticsActionability')}</div>
            </div>
          </>
        )}
      </div>

      {/* Meeting trend chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">{t('analyticsMeetingTrend')}</h2>
        <div className="h-48">
          {data.meetings_per_day.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('analyticsNoData')}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.meetings_per_day}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--void-cyan))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Meetings per agent */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">{t('analyticsMeetingsPerAgent')}</h2>
        <div className="h-48">
          {data.meetings_per_agent.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('analyticsNoData')}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.meetings_per_agent}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="meeting_count" fill="hsl(var(--void-cyan))" name={t('analyticsMeetings')} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top pairs table */}
      {data.top_pairs.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">{t('analyticsTopPairs')}</h2>
          <div className="space-y-2">
            {data.top_pairs.slice(0, 8).map((pair, i) => (
              <div key={i} className="flex items-center justify-between text-sm border-b border-border/30 pb-1.5">
                <span className="text-foreground">{pair.initiator_name} + {pair.participant_name}</span>
                <span className="text-muted-foreground font-mono text-xs">{pair.meeting_count} {t('analyticsMeetings')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trust network */}
      {data.trust_network.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">{t('analyticsTrustNetwork')}</h2>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {data.trust_network.slice(0, 20).map((edge, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-foreground w-24 truncate">{edge.source_name}</span>
                <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-void-cyan rounded-full"
                    style={{ width: `${Math.round(edge.trust_score * 100)}%` }}
                  />
                </div>
                <span className="text-muted-foreground w-24 truncate text-right">{edge.target_name}</span>
                <span className="text-muted-foreground font-mono w-10 text-right">{edge.trust_score.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add src/components/panels/meeting-analytics-panel.tsx messages/en.json
git commit -m "feat: add meeting analytics panel with trend charts, trust network, quality scores"
```

---

### Task 11: Wire analytics panel into meeting panel

**Files:**
- Modify: `src/components/panels/meeting-panel.tsx` (add analytics tab/link)

Add an "Analytics" button at the bottom of the meeting panel that opens the analytics view. Implementation: add a `showAnalytics` state, and conditionally render `<MeetingAnalyticsPanel />` instead of the meetings list when toggled.

**Step 1: Import and add toggle**

At the top of meeting-panel.tsx, add import:
```typescript
import { MeetingAnalyticsPanel } from '@/components/panels/meeting-analytics-panel'
```

Add state: `const [showAnalytics, setShowAnalytics] = useState(false)`

Before the return's closing `</div>`, add:
```typescript
<div className="border-t border-border/30 pt-2 mt-2">
  <Button variant="ghost" size="xs" onClick={() => setShowAnalytics(v => !v)}
    className="w-full h-auto px-2 py-1 text-[10px] font-mono border bg-secondary border-border text-muted-foreground hover:bg-muted">
    {showAnalytics ? t('meetingPanelHideAnalytics') : t('meetingPanelShowAnalytics')}
  </Button>
</div>
```

When `showAnalytics` is true, render `<MeetingAnalyticsPanel />` instead of the main panel content.

Add i18n keys: `"meetingPanelShowAnalytics": "Analytics"`, `"meetingPanelHideAnalytics": "Back to Meetings"`

**Step 2: Commit**

```bash
git add src/components/panels/meeting-panel.tsx messages/en.json
git commit -m "feat: wire analytics panel into meeting sidebar with toggle"
```

---

### Task 12: Update meeting panel to show quality scores and actions

**Files:**
- Modify: `src/components/panels/meeting-panel.tsx`

Add quality badges to recent meeting cards (if `quality_score` is present in the meeting data). Show "N actions created" on concluded meetings that generated tasks.

The API already returns `quality_score` from the `agent_meetings` table. Parse it and display as colored dots (green ≥4, amber ≥3, red <3).

**Step 1: Update recent meeting rendering**

In the recent meeting card, after the summary, add:
```typescript
{meeting.quality_score && (() => {
  try {
    const q = JSON.parse(meeting.quality_score)
    const avg = ((q.coherence + q.actionability + q.role_adherence) / 3).toFixed(1)
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[9px]">
        <span className={`w-1.5 h-1.5 rounded-full ${Number(avg) >= 4 ? 'bg-void-mint' : Number(avg) >= 3 ? 'bg-void-amber' : 'bg-void-crimson'}`} />
        <span className="text-muted-foreground">{t('analyticsScore', { score: avg })}</span>
      </div>
    )
  } catch { return null }
})()}
```

Update the `RecentMeeting` interface to include `quality_score: string | null`.

**Step 2: Commit**

```bash
git add src/components/panels/meeting-panel.tsx
git commit -m "feat: show quality scores on recent meeting cards"
```

---

### Task 13: Final verification

**Step 1: Typecheck**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm typecheck`
Expected: 0 errors

**Step 2: Run all tests**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm test`
Expected: All pass (1275+ tests, 0 failures)

**Step 3: Verify new test files pass**

Run: `cd "/Users/oudaymneimneh/Mission Control" && pnpm vitest run src/lib/__tests__/meeting-actions.test.ts src/lib/__tests__/meeting-quality.test.ts src/lib/__tests__/suggest-collaborators.test.ts --reporter=verbose`

---

## Usage Guide

### Quick Start
```bash
# 1. Start the server
SIMULATION_ENABLED=true pnpm dev

# 2. Register agents with personality configs (via UI or API)
# 3. Open http://localhost:3000/office
# 4. Click "Meetings" toggle — panel appears
# 5. Agents will autonomously start meeting within 1-2 minutes
```

### Manual Operations
```bash
# Schedule a specific meeting
curl -X POST http://localhost:3000/api/meetings/schedule \
  -H "x-api-key: KEY" -H "Content-Type: application/json" \
  -d '{"initiator_id": 1, "participant_id": 2, "topic": "Sprint planning"}'

# Get collaborator suggestions
curl http://localhost:3000/api/agents/1/collaborators?limit=3 \
  -H "x-api-key: KEY"

# View analytics
curl http://localhost:3000/api/meetings/analytics -H "x-api-key: KEY"
```

### Scenarios
| Scenario | How |
|---|---|
| **Onboard new agent** | Register agent → personality drives meeting frequency → trust builds through meetings → collaborator suggestions emerge |
| **Team formation** | Schedule meetings between agents who should collaborate → trust builds → future autonomous meetings favor these pairs |
| **Quality monitoring** | Check analytics panel → quality scores show conversation health → low-quality meetings trigger reflections that improve future conversations |
| **Task generation** | Meetings with 3+ turns auto-extract action items → tasks appear in task board with `source_type: meeting` → traceable to meeting transcript |
| **Trust analysis** | Analytics panel shows trust network → identify isolated agents → schedule meetings to build connections |

---

## Success Metrics

| Feature | Metric | Target |
|---|---|---|
| Action extraction | Actions created per meeting (3+ turns) | 0.5-2.0 avg |
| Quality scoring | Avg quality across all dimensions | ≥ 3.5/5 |
| Scheduling | Scheduled meetings execute on time | 100% |
| Collaborator suggestions | Suggestions match high-trust partners | Top-3 by trust score |
| Analytics | Data accuracy vs raw SQL queries | Exact match |
| Overall | Typecheck + tests pass | 0 errors, 0 failures |
