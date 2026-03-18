# Living Office v3.0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a project-centric dashboard where users create departments/teams, assign projects, start the office simulation, and watch AI agents autonomously meet, produce decisions, tasks, and artifacts.

**Architecture:** Project-Centric Dashboard. 3 database migrations add hierarchy + output tables. 7 new API routes serve teams/projects/decisions/artifacts. 3 new UI panels (Teams, Projects list, Project detail) plus persona editor and simulation controls in header. Meeting engine enhanced to link meetings to projects and extract structured output.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, SQLite (better-sqlite3), Tailwind CSS 3, Zustand 5, pnpm, Vitest, Playwright

---

## Gate 1: Database Schema (Tasks 1-3)

### Task 1: Migration phase_062 — Departments & Project Wiring

**Files:**
- Modify: `src/lib/phase-migrations.ts` (append after line 604)
- Test: `pnpm test -- --grep migration` (existing migration tests)

**Step 1: Write the migration**

Add to the `registerMigrations([...])` array in `src/lib/phase-migrations.ts`, after the `phase_061_recurring_meetings` entry:

```typescript
{
  id: 'phase_062_departments_project_wiring',
  up: (db: Database.Database) => {
    // teams.parent_id for 2-level hierarchy (department -> team)
    const teamCols = db.pragma('table_info(teams)') as Array<{ name: string }>
    if (!teamCols.some(c => c.name === 'parent_id')) {
      db.exec(`ALTER TABLE teams ADD COLUMN parent_id INTEGER REFERENCES teams(id) ON DELETE CASCADE`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_teams_parent ON teams(parent_id)`)
    }

    // projects.team_id for organizational ownership
    const projCols = db.pragma('table_info(projects)') as Array<{ name: string }>
    if (!projCols.some(c => c.name === 'team_id')) {
      db.exec(`ALTER TABLE projects ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id)`)
    }

    // agent_meetings.project_id for contextual association
    const mtgCols = db.pragma('table_info(agent_meetings)') as Array<{ name: string }>
    if (!mtgCols.some(c => c.name === 'project_id')) {
      db.exec(`ALTER TABLE agent_meetings ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_meetings_project ON agent_meetings(project_id)`)
    }
  }
},
```

**Step 2: Verify migration runs**

Run: `pnpm dev` (triggers migration on startup) then check DB:
```bash
sqlite3 .data/mission-control.db "PRAGMA table_info(teams)" | grep parent_id
sqlite3 .data/mission-control.db "PRAGMA table_info(projects)" | grep team_id
sqlite3 .data/mission-control.db "PRAGMA table_info(agent_meetings)" | grep project_id
```
Expected: All three columns present.

**Step 3: Verify idempotency**

Run: Restart dev server again. No errors. Migration skips silently.

**Step 4: Commit**

```bash
git add src/lib/phase-migrations.ts
git commit -m "feat: add phase_062 migration — departments, project-team, meeting-project wiring"
```

---

### Task 2: Migration phase_063 — Project Decisions Table

**Files:**
- Modify: `src/lib/phase-migrations.ts` (append after phase_062)

**Step 1: Write the migration**

```typescript
{
  id: 'phase_063_project_decisions',
  up: (db: Database.Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        meeting_id INTEGER REFERENCES agent_meetings(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        decided_by TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_project ON project_decisions(project_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_meeting ON project_decisions(meeting_id);
    `)
  }
},
```

**Step 2: Verify**

```bash
sqlite3 .data/mission-control.db ".schema project_decisions"
```
Expected: Table exists with all columns and indexes.

**Step 3: Commit**

```bash
git add src/lib/phase-migrations.ts
git commit -m "feat: add phase_063 migration — project_decisions table"
```

---

### Task 3: Migration phase_064 — Project Artifacts Table

**Files:**
- Modify: `src/lib/phase-migrations.ts` (append after phase_063)

**Step 1: Write the migration**

```typescript
{
  id: 'phase_064_project_artifacts',
  up: (db: Database.Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        meeting_id INTEGER REFERENCES agent_meetings(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        artifact_type TEXT NOT NULL DEFAULT 'document',
        created_by_agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_project ON project_artifacts(project_id);
    `)
  }
},
```

**Step 2: Verify**

```bash
sqlite3 .data/mission-control.db ".schema project_artifacts"
```

**Step 3: Run typecheck + existing tests**

Run: `pnpm typecheck && pnpm test`
Expected: Zero TS errors, all 1314+ tests pass.

**Step 4: Commit**

```bash
git add src/lib/phase-migrations.ts
git commit -m "feat: add phase_064 migration — project_artifacts table"
```

**--- GATE 1 CHECKPOINT ---**
Run: `pnpm typecheck && pnpm test`
Verify: All columns exist in DB. All existing tests pass. Zero TS errors.

---

## Gate 2: API Routes (Tasks 4-10)

### Task 4: Teams API — Add parent_id Support (Departments)

**Files:**
- Modify: `src/app/api/teams/route.ts`
- Test: `src/app/api/teams/__tests__/route.test.ts` (create if not exists)

**Step 1: Write failing tests**

Create `src/app/api/teams/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock DB for testing
const mockDb = {
  prepare: vi.fn().mockReturnValue({
    all: vi.fn().mockReturnValue([]),
    run: vi.fn().mockReturnValue({ lastInsertRowid: 1 }),
    get: vi.fn(),
  }),
  pragma: vi.fn().mockReturnValue([]),
}

vi.mock('@/lib/db', () => ({
  getDatabase: () => mockDb,
}))

describe('GET /api/teams', () => {
  it('returns teams with parent_id in response', async () => {
    mockDb.prepare.mockReturnValueOnce({
      all: vi.fn().mockReturnValue([
        { id: 1, name: 'Engineering', parent_id: null, member_count: 3 },
        { id: 2, name: 'Frontend', parent_id: 1, member_count: 2 },
      ]),
    })
    // Test will fail until GET handler includes parent_id in query
  })
})

describe('POST /api/teams', () => {
  it('creates a department (parent_id = null)', async () => {
    // body: { name: 'Engineering' }
    // expected: 201, team with parent_id: null
  })

  it('creates a team inside department (parent_id = dept.id)', async () => {
    // body: { name: 'Frontend', parent_id: 1 }
    // expected: 201, team with parent_id: 1
  })

  it('rejects 3-level nesting (parent has a parent)', async () => {
    // body: { name: 'Sub-sub', parent_id: 2 } where team 2 has parent_id=1
    // expected: 400, error about max depth
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/teams/__tests__/route.test.ts`
Expected: FAIL

**Step 3: Modify GET handler**

In `src/app/api/teams/route.ts`, update the SELECT query to include `parent_id`:

```typescript
// In GET handler, modify the SQL query to include parent_id
const teams = db.prepare(`
  SELECT t.id, t.name, t.description, t.parent_id, t.workspace_id, t.created_at, t.updated_at,
    COUNT(tm.agent_id) as member_count
  FROM teams t
  LEFT JOIN team_members tm ON tm.team_id = t.id
  WHERE t.workspace_id = ?
  GROUP BY t.id
  ORDER BY t.parent_id IS NOT NULL, t.parent_id, t.name
`).all(workspaceId)
```

**Step 4: Modify POST handler**

Add `parent_id` to the Zod schema and INSERT:

```typescript
// In POST handler, add parent_id to schema
const schema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  parent_id: z.number().int().positive().optional().nullable(),
})

// Validate 2-level max depth
if (body.parent_id) {
  const parent = db.prepare('SELECT parent_id FROM teams WHERE id = ? AND workspace_id = ?')
    .get(body.parent_id, workspaceId) as { parent_id: number | null } | undefined
  if (!parent) {
    return NextResponse.json({ error: 'Parent team not found' }, { status: 404 })
  }
  if (parent.parent_id !== null) {
    return NextResponse.json({ error: 'Maximum hierarchy depth is 2 levels (department -> team)' }, { status: 400 })
  }
}

// Add parent_id to INSERT
const result = db.prepare(
  'INSERT INTO teams (name, description, parent_id, workspace_id) VALUES (?, ?, ?, ?)'
).run(body.name, body.description ?? null, body.parent_id ?? null, workspaceId)
```

**Step 5: Run tests**

Run: `pnpm test src/app/api/teams/__tests__/route.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/app/api/teams/route.ts src/app/api/teams/__tests__/route.test.ts
git commit -m "feat: add department hierarchy to teams API (parent_id, 2-level max)"
```

---

### Task 5: Projects API — Add team_id Support

**Files:**
- Modify: `src/app/api/projects/route.ts`
- Modify: `src/app/api/projects/[id]/route.ts`

**Step 1: Modify POST to accept team_id**

In `src/app/api/projects/route.ts` POST handler, add `team_id` to Zod schema:

```typescript
team_id: z.number().int().positive().optional().nullable(),
```

Add to INSERT statement:

```typescript
// Before INSERT, validate team_id if provided
if (body.team_id) {
  const team = db.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?')
    .get(body.team_id, workspaceId)
  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  }
}

// Add team_id column to INSERT
```

**Step 2: Modify GET to include team info**

Add LEFT JOIN to teams table in the GET query:

```typescript
const projects = db.prepare(`
  SELECT p.*, t.name as team_name, t.id as team_id,
    (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
    (SELECT COUNT(*) FROM agent_meetings WHERE project_id = p.id AND status = 'concluded') as meeting_count,
    (SELECT COUNT(*) FROM project_decisions WHERE project_id = p.id) as decision_count
  FROM projects p
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE p.workspace_id = ? AND (p.status = 'active' OR ? = 1)
  ORDER BY p.updated_at DESC
`).all(workspaceId, includeArchived ? 1 : 0)
```

**Step 3: Modify PATCH to allow team_id update**

In `src/app/api/projects/[id]/route.ts`, add team_id to updatable fields.

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/api/projects/route.ts src/app/api/projects/[id]/route.ts
git commit -m "feat: add team_id to projects API — team ownership"
```

---

### Task 6: Project Decisions API

**Files:**
- Create: `src/app/api/projects/[id]/decisions/route.ts`
- Test: `src/app/api/projects/[id]/decisions/__tests__/route.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest'

describe('GET /api/projects/:id/decisions', () => {
  it('returns decisions for a project', async () => {
    // expected: { decisions: [...] }
  })
})

describe('POST /api/projects/:id/decisions', () => {
  it('creates a decision', async () => {
    // body: { title, description, decided_by: ['Maya', 'Jordan'] }
    // expected: 201
  })
})
```

**Step 2: Implement route**

```typescript
import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole, getUserFromRequest } from '@/lib/auth'
import { z } from 'zod'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

  const db = getDatabase()
  const user = getUserFromRequest(request)
  const workspaceId = user?.workspace_id ?? 1

  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(projectId, workspaceId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const decisions = db.prepare(`
    SELECT d.*, m.topic as meeting_topic
    FROM project_decisions d
    LEFT JOIN agent_meetings m ON m.id = d.meeting_id
    WHERE d.project_id = ?
    ORDER BY d.created_at DESC
  `).all(projectId)

  return NextResponse.json({ decisions })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

  const db = getDatabase()
  const user = getUserFromRequest(request)
  const workspaceId = user?.workspace_id ?? 1

  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(projectId, workspaceId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const schema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    meeting_id: z.number().int().positive().optional(),
    decided_by: z.array(z.string()).optional(),
    status: z.enum(['active', 'superseded', 'reversed']).optional(),
  })

  const body = schema.parse(await request.json())

  const result = db.prepare(`
    INSERT INTO project_decisions (project_id, meeting_id, title, description, decided_by, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(projectId, body.meeting_id ?? null, body.title, body.description, JSON.stringify(body.decided_by ?? []), body.status ?? 'active')

  return NextResponse.json({ id: result.lastInsertRowid, ...body, project_id: projectId }, { status: 201 })
}
```

**Step 3: Run test**

Run: `pnpm test src/app/api/projects/[id]/decisions`
Expected: PASS

**Step 4: Commit**

```bash
git add src/app/api/projects/[id]/decisions/
git commit -m "feat: add project decisions API — GET/POST"
```

---

### Task 7: Project Artifacts API

**Files:**
- Create: `src/app/api/projects/[id]/artifacts/route.ts`

**Step 1: Implement route** (same pattern as decisions)

```typescript
import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole, getUserFromRequest } from '@/lib/auth'
import { z } from 'zod'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

  const db = getDatabase()
  const user = getUserFromRequest(request)
  const workspaceId = user?.workspace_id ?? 1

  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(projectId, workspaceId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const url = new URL(request.url)
  const typeFilter = url.searchParams.get('type')

  let query = `
    SELECT a.*, ag.name as created_by_name
    FROM project_artifacts a
    LEFT JOIN agents ag ON ag.id = a.created_by_agent_id
    WHERE a.project_id = ?
  `
  const queryParams: (number | string)[] = [projectId]

  if (typeFilter) {
    query += ' AND a.artifact_type = ?'
    queryParams.push(typeFilter)
  }

  query += ' ORDER BY a.created_at DESC'

  const artifacts = db.prepare(query).all(...queryParams)
  return NextResponse.json({ artifacts })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

  const db = getDatabase()
  const user = getUserFromRequest(request)
  const workspaceId = user?.workspace_id ?? 1

  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(projectId, workspaceId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const schema = z.object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(100000),
    artifact_type: z.enum(['document', 'spec', 'code', 'brief']).optional(),
    meeting_id: z.number().int().positive().optional(),
    created_by_agent_id: z.number().int().positive().optional(),
  })

  const body = schema.parse(await request.json())

  const result = db.prepare(`
    INSERT INTO project_artifacts (project_id, meeting_id, title, content, artifact_type, created_by_agent_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(projectId, body.meeting_id ?? null, body.title, body.content, body.artifact_type ?? 'document', body.created_by_agent_id ?? null)

  return NextResponse.json({ id: result.lastInsertRowid, ...body, project_id: projectId }, { status: 201 })
}
```

**Step 2: Commit**

```bash
git add src/app/api/projects/[id]/artifacts/
git commit -m "feat: add project artifacts API — GET/POST with type filter"
```

---

### Task 8: Project Activity Feed API

**Files:**
- Create: `src/app/api/projects/[id]/activity/route.ts`

**Step 1: Implement**

This endpoint aggregates meetings, decisions, artifacts, and tasks into a unified reverse-chronological feed:

```typescript
import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole, getUserFromRequest } from '@/lib/auth'

type ActivityItem = {
  type: 'meeting_started' | 'meeting_concluded' | 'decision' | 'artifact' | 'task'
  id: number
  title: string
  detail: string | null
  timestamp: number
  metadata: Record<string, unknown>
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

  const db = getDatabase()
  const user = getUserFromRequest(request)
  const workspaceId = user?.workspace_id ?? 1

  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(projectId, workspaceId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = 20
  const offset = (page - 1) * limit

  // Union query: meetings + decisions + artifacts + tasks
  const items = db.prepare(`
    SELECT * FROM (
      SELECT 'meeting' as type, m.id, COALESCE(m.topic, 'Meeting') as title, m.summary as detail,
        COALESCE(m.concluded_at, m.started_at, m.created_at) as timestamp, m.status,
        i.name as initiator_name, p.name as participant_name,
        m.turn_count, m.max_turns, m.quality_score
      FROM agent_meetings m
      LEFT JOIN agents i ON i.id = m.initiator_id
      LEFT JOIN agents p ON p.id = m.participant_id
      WHERE m.project_id = ?

      UNION ALL

      SELECT 'decision' as type, d.id, d.title, d.description as detail,
        d.created_at as timestamp, d.status,
        NULL, NULL, NULL, NULL, NULL
      FROM project_decisions d
      WHERE d.project_id = ?

      UNION ALL

      SELECT 'artifact' as type, a.id, a.title, a.artifact_type as detail,
        a.created_at as timestamp, NULL,
        ag.name, NULL, NULL, NULL, NULL
      FROM project_artifacts a
      LEFT JOIN agents ag ON ag.id = a.created_by_agent_id
      WHERE a.project_id = ?

      UNION ALL

      SELECT 'task' as type, t.id, t.title, t.status as detail,
        t.created_at as timestamp, t.priority,
        NULL, NULL, NULL, NULL, NULL
      FROM tasks t
      WHERE t.project_id = ?
    ) combined
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(projectId, projectId, projectId, projectId, limit, offset)

  const countRow = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM agent_meetings WHERE project_id = ?) +
      (SELECT COUNT(*) FROM project_decisions WHERE project_id = ?) +
      (SELECT COUNT(*) FROM project_artifacts WHERE project_id = ?) +
      (SELECT COUNT(*) FROM tasks WHERE project_id = ?) as total
  `).get(projectId, projectId, projectId, projectId) as { total: number }

  return NextResponse.json({
    activity: items,
    page,
    totalPages: Math.ceil(countRow.total / limit),
    total: countRow.total,
  })
}
```

**Step 2: Commit**

```bash
git add src/app/api/projects/[id]/activity/
git commit -m "feat: add project activity feed API — unified reverse-chronological feed"
```

---

### Task 9: Simulation Start — Wake All Agents

**Files:**
- Modify: `src/app/api/simulation/start/route.ts`

**Step 1: Read current implementation**

Read `src/app/api/simulation/start/route.ts` to understand existing behavior.

**Step 2: Add agent wake-up logic**

After `engine.start()`, add:

```typescript
// Wake all non-error agents
const db = getDatabase()
const wakeResult = db.prepare(
  "UPDATE agents SET status = 'idle', last_seen = unixepoch() WHERE status != 'error' AND workspace_id = ?"
).run(workspaceId)

return NextResponse.json({
  status: 'started',
  agents_woken: wakeResult.changes,
  config: engine.getStatus().config,
})
```

**Step 3: Modify stop route**

In `src/app/api/simulation/stop/route.ts`, add agent shutdown:

```typescript
// Set all agents to offline
const db = getDatabase()
db.prepare(
  "UPDATE agents SET status = 'offline', last_seen = unixepoch() WHERE workspace_id = ?"
).run(workspaceId)
```

**Step 4: Commit**

```bash
git add src/app/api/simulation/start/route.ts src/app/api/simulation/stop/route.ts
git commit -m "feat: Start/Stop Office wakes/sleeps all agents"
```

---

### Task 10: Gate 2 Checkpoint — API Validation

**Step 1: Run full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: Zero TS errors, all tests pass.

**Step 2: Manual API smoke test**

```bash
# Create department
curl -s -X POST http://localhost:4000/api/teams -H 'Content-Type: application/json' -d '{"name":"Engineering"}' | jq

# Create team in department (use department id from above)
curl -s -X POST http://localhost:4000/api/teams -H 'Content-Type: application/json' -d '{"name":"Frontend","parent_id":1}' | jq

# List teams with hierarchy
curl -s http://localhost:4000/api/teams | jq

# Create project with team
curl -s -X POST http://localhost:4000/api/projects -H 'Content-Type: application/json' -d '{"name":"UI Redesign","ticket_prefix":"UIR","team_id":2}' | jq

# Create decision
curl -s -X POST http://localhost:4000/api/projects/1/decisions -H 'Content-Type: application/json' -d '{"title":"Use CSS variables","description":"Agreed to use CSS custom properties for theming"}' | jq

# Get activity feed
curl -s http://localhost:4000/api/projects/1/activity | jq
```

**Step 3: Commit checkpoint**

```bash
git commit --allow-empty -m "checkpoint: Gate 2 passed — all API routes functional"
```

---

## Gate 3: Meeting Engine Changes (Tasks 11-13)

### Task 11: Project-Aware Meeting Creation

**Files:**
- Modify: `src/lib/meeting-engine.ts` (around line 302, createMeeting function)
- Test: `src/lib/__tests__/meeting-engine.test.ts`

**Step 1: Write failing test**

Add to the `createMeeting` describe block in `src/lib/__tests__/meeting-engine.test.ts`:

```typescript
describe('project-aware meetings', () => {
  it('sets project_id when both agents share a project', () => {
    db._when('SELECT id FROM project_agent_assignments', [
      { project_id: 5, agent_name: 'Alice' },
    ])
    db._when('SELECT id FROM project_agent_assignments', [
      { project_id: 5, agent_name: 'Bob' },
    ])
    // createMeeting should set project_id = 5
  })

  it('sets project_id from initiator when only initiator has a project', () => {
    // initiator has project_id=5, participant has none
    // meeting.project_id should be 5
  })

  it('sets project_id = null when neither has a project', () => {
    // neither agent has project assignment
    // meeting.project_id should be null
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/__tests__/meeting-engine.test.ts`

**Step 3: Implement project lookup in createMeeting**

Inside the `writeTransaction` in `createMeeting()`, after agent availability check but before INSERT:

```typescript
// Find shared project between agents
const initiatorProjects = tx.prepare(
  'SELECT project_id FROM project_agent_assignments WHERE agent_name = ?'
).all(initiator.name) as Array<{ project_id: number }>

const participantProjects = tx.prepare(
  'SELECT project_id FROM project_agent_assignments WHERE agent_name = ?'
).all(participant.name) as Array<{ project_id: number }>

const initiatorProjectIds = new Set(initiatorProjects.map(r => r.project_id))
const sharedProjectId = participantProjects.find(r => initiatorProjectIds.has(r.project_id))?.project_id
  ?? initiatorProjects[0]?.project_id
  ?? null

// Add project_id to the INSERT statement
```

**Step 4: Update INSERT to include project_id**

Modify the INSERT INTO agent_meetings to include `project_id` column with the resolved value.

**Step 5: Run tests**

Run: `pnpm test src/lib/__tests__/meeting-engine.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/meeting-engine.ts src/lib/__tests__/meeting-engine.test.ts
git commit -m "feat: meetings auto-link to project via agent assignments"
```

---

### Task 12: Project Context in Meeting Prompts

**Files:**
- Modify: `src/lib/meeting-engine.ts` (generateMeetingTurn function, around line 569)

**Step 1: Add project context to system prompt**

In `generateMeetingTurn`, after building the base system prompt, inject project context if meeting has project_id:

```typescript
// After existing system prompt building
if (meeting.project_id) {
  const project = db.prepare('SELECT name, description FROM projects WHERE id = ?')
    .get(meeting.project_id) as { name: string; description: string | null } | undefined
  if (project) {
    systemPrompt += `\n\n## Current Project\nYou are working on "${project.name}". ${project.description || ''}\nFocus your discussion on this project's goals and challenges.`
  }
}
```

**Step 2: Run existing tests to verify no regressions**

Run: `pnpm test src/lib/__tests__/meeting-engine.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/meeting-engine.ts
git commit -m "feat: inject project context into meeting system prompts"
```

---

### Task 13: Enhanced Meeting Output Extraction

**Files:**
- Create: `src/lib/meeting-outputs.ts`
- Test: `src/lib/__tests__/meeting-outputs.test.ts`
- Modify: `src/lib/meeting-engine.ts` (summarizeMeeting, around line 754)

**Step 1: Write failing test**

Create `src/lib/__tests__/meeting-outputs.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { extractMeetingOutputs } from '@/lib/meeting-outputs'

vi.mock('@/lib/llm', () => ({
  complete: vi.fn(),
}))

describe('extractMeetingOutputs', () => {
  it('extracts action items, decisions, and artifacts from transcript', async () => {
    const { complete } = await import('@/lib/llm')
    ;(complete as any).mockResolvedValueOnce(JSON.stringify({
      action_items: [{ title: 'Implement tokens', description: 'Create CSS vars', assignee_name: 'Maya' }],
      decisions: [{ title: 'Use CSS variables', description: 'Agreed on custom properties' }],
      artifacts: [{ title: 'Token Spec', content: '# Tokens\n...', type: 'spec' }],
    }))

    const result = await extractMeetingOutputs(
      [{ agent_name: 'Maya', content: 'We should use CSS vars', turn_number: 1 }],
      'Design tokens',
      1, // meeting_id
      5, // project_id
      1, // workspace_id
    )

    expect(result.action_items).toHaveLength(1)
    expect(result.decisions).toHaveLength(1)
    expect(result.artifacts).toHaveLength(1)
  })

  it('returns empty arrays on LLM failure', async () => {
    const { complete } = await import('@/lib/llm')
    ;(complete as any).mockRejectedValueOnce(new Error('timeout'))

    const result = await extractMeetingOutputs([], 'Test', 1, null, 1)
    expect(result.action_items).toEqual([])
    expect(result.decisions).toEqual([])
    expect(result.artifacts).toEqual([])
  })

  it('saves decisions to project_decisions table', async () => {
    // Test that decisions are INSERTed when project_id is set
  })

  it('saves artifacts to project_artifacts table', async () => {
    // Test that artifacts are INSERTed when project_id is set
  })
})
```

**Step 2: Implement meeting-outputs.ts**

Create `src/lib/meeting-outputs.ts`:

```typescript
import { getDatabase } from '@/lib/db'
import { complete } from '@/lib/llm'
import { logger } from '@/lib/logger'

type MeetingMessage = { agent_name: string; content: string; turn_number: number }
type ActionItem = { title: string; description: string; assignee_name: string }
type Decision = { title: string; description: string }
type Artifact = { title: string; content: string; type: string }

type MeetingOutputs = {
  action_items: ActionItem[]
  decisions: Decision[]
  artifacts: Artifact[]
}

export async function extractMeetingOutputs(
  messages: MeetingMessage[],
  topic: string | null,
  meetingId: number,
  projectId: number | null,
  workspaceId: number,
): Promise<MeetingOutputs> {
  const empty: MeetingOutputs = { action_items: [], decisions: [], artifacts: [] }

  if (messages.length < 2) return empty

  const transcript = messages.map(m => `${m.agent_name}: ${m.content}`).join('\n')

  try {
    const raw = await complete({
      system: 'You extract structured information from meeting transcripts. Return valid JSON only.',
      prompt: `Given this meeting transcript${topic ? ` about "${topic}"` : ''}:\n\n${transcript}\n\nExtract:\n1. action_items: 0-3 concrete tasks with {title, description, assignee_name}\n2. decisions: 0-2 key decisions made with {title, description}\n3. artifacts: 0-1 documents/specs/code proposed with {title, content, type}\n\ntype must be one of: document, spec, code, brief\n\nReturn JSON: { "action_items": [...], "decisions": [...], "artifacts": [...] }\nIf none found for a category, return empty array.`,
      workspaceId,
    })

    const parsed: MeetingOutputs = JSON.parse(raw)

    // Validate structure
    if (!Array.isArray(parsed.action_items)) parsed.action_items = []
    if (!Array.isArray(parsed.decisions)) parsed.decisions = []
    if (!Array.isArray(parsed.artifacts)) parsed.artifacts = []

    // Cap lengths
    parsed.action_items = parsed.action_items.slice(0, 3)
    parsed.decisions = parsed.decisions.slice(0, 2)
    parsed.artifacts = parsed.artifacts.slice(0, 1)

    // Save decisions + artifacts to DB if project_id exists
    if (projectId) {
      const db = getDatabase()
      for (const d of parsed.decisions) {
        try {
          db.prepare(`
            INSERT INTO project_decisions (project_id, meeting_id, title, description, decided_by, status)
            VALUES (?, ?, ?, ?, ?, 'active')
          `).run(projectId, meetingId, d.title, d.description, '[]')
        } catch (err) {
          logger.warn({ err, meetingId }, 'Failed to save decision')
        }
      }

      for (const a of parsed.artifacts) {
        try {
          db.prepare(`
            INSERT INTO project_artifacts (project_id, meeting_id, title, content, artifact_type)
            VALUES (?, ?, ?, ?, ?)
          `).run(projectId, meetingId, a.title, a.content, a.type || 'document')
        } catch (err) {
          logger.warn({ err, meetingId }, 'Failed to save artifact')
        }
      }
    }

    return parsed
  } catch (err) {
    logger.warn({ err, meetingId }, 'Failed to extract meeting outputs')
    return empty
  }
}
```

**Step 3: Wire into summarizeMeeting**

In `src/lib/meeting-engine.ts`, around line 754, replace the existing `extractMeetingActions` call:

```typescript
// Replace:
// const actions = await import('@/lib/meeting-actions').then(m => m.extractMeetingActions(...))

// With:
import { extractMeetingOutputs } from '@/lib/meeting-outputs'
// ...
const outputs = await extractMeetingOutputs(messages, meeting.topic, meeting.id, meeting.project_id, meeting.workspace_id)
// Use outputs.action_items for task creation (existing logic)
```

**Step 4: Run tests**

Run: `pnpm test src/lib/__tests__/meeting-outputs.test.ts && pnpm test src/lib/__tests__/meeting-engine.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/lib/meeting-outputs.ts src/lib/__tests__/meeting-outputs.test.ts src/lib/meeting-engine.ts
git commit -m "feat: extract decisions + artifacts from meeting transcripts"
```

**--- GATE 3 CHECKPOINT ---**
Run: `pnpm typecheck && pnpm test`
All engine changes verified. Meetings link to projects. Output extraction works.

---

## Gate 4: Teams Panel UI (Tasks 14-16)

### Task 14: Teams Panel Component

**Files:**
- Create: `src/components/panels/teams-panel.tsx`

**Step 1: Implement panel**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'

type Agent = { id: number; name: string; role: string; status: string }
type Team = {
  id: number; name: string; description: string | null; parent_id: number | null
  member_count: number; members?: Agent[]
}

export function TeamsPanel() {
  const t = useTranslations('teams')
  const { setActiveTab } = useMissionControl()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedDepts, setExpandedDepts] = useState<Set<number>>(new Set())
  const [showCreateForm, setShowCreateForm] = useState<number | null>(null) // null=hidden, 0=dept, N=team under dept N
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [agents, setAgents] = useState<Agent[]>([])
  const [addingToTeam, setAddingToTeam] = useState<number | null>(null)

  const fetchTeams = useCallback(async () => {
    try {
      setError(null)
      if (teams.length === 0) setLoading(true)
      const [teamsRes, agentsRes] = await Promise.all([
        fetch('/api/teams?include=members'),
        fetch('/api/agents'),
      ])
      if (!teamsRes.ok) throw new Error('Failed to fetch teams')
      const teamsData = await teamsRes.json()
      const agentsData = agentsRes.ok ? await agentsRes.json() : { agents: [] }
      setTeams(teamsData.teams || [])
      setAgents(agentsData.agents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [teams.length])

  useEffect(() => { fetchTeams() }, [fetchTeams])

  const departments = teams.filter(t => t.parent_id === null)
  const getChildTeams = (deptId: number) => teams.filter(t => t.parent_id === deptId)
  const assignedAgentIds = new Set(teams.flatMap(t => t.members?.map(m => m.id) ?? []))
  const unassignedAgents = agents.filter(a => !assignedAgentIds.has(a.id))

  const toggleDept = (id: number) => {
    setExpandedDepts(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleCreate = async (parentId: number | null) => {
    if (!formName.trim()) return
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, description: formDesc || undefined, parent_id: parentId || undefined }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create')
      setFormName('')
      setFormDesc('')
      setShowCreateForm(null)
      fetchTeams()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  const handleAddAgent = async (teamId: number, agentId: number) => {
    try {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      })
      if (!res.ok) throw new Error('Failed to add agent')
      setAddingToTeam(null)
      fetchTeams()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  const handleRemoveAgent = async (teamId: number, agentId: number) => {
    try {
      await fetch(`/api/teams/${teamId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      })
      fetchTeams()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  const statusColor: Record<string, string> = {
    idle: 'bg-green-400',
    busy: 'bg-amber-400',
    offline: 'bg-zinc-500',
    error: 'bg-red-400',
  }

  if (loading) return <div className="m-4"><Loader /></div>

  return (
    <div className="m-4">
      <div className="flex items-center justify-between gap-4 mb-4 pb-2 border-b border-border">
        <h2 className="text-lg font-semibold">Teams & Departments</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={fetchTeams}>Refresh</Button>
          <Button size="sm" onClick={() => { setShowCreateForm(0); setFormName(''); setFormDesc('') }}>+ Department</Button>
        </div>
      </div>

      {error && <div className="text-red-400 text-sm mb-3 p-2 bg-red-500/10 rounded">{error}</div>}

      {/* Create department form */}
      {showCreateForm === 0 && (
        <div className="mb-4 p-3 bg-surface-1 rounded-lg border border-border">
          <input className="w-full mb-2 px-3 py-1.5 bg-secondary border border-border rounded text-sm text-foreground" placeholder="Department name" value={formName} onChange={e => setFormName(e.target.value)} autoFocus />
          <input className="w-full mb-2 px-3 py-1.5 bg-secondary border border-border rounded text-sm text-foreground" placeholder="Description (optional)" value={formDesc} onChange={e => setFormDesc(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => handleCreate(null)}>Create</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreateForm(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Departments */}
      {departments.map(dept => (
        <div key={dept.id} className="mb-3">
          <div className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-surface-1" onClick={() => toggleDept(dept.id)}>
            <span className="text-muted-foreground text-xs">{expandedDepts.has(dept.id) ? '▼' : '▶'}</span>
            <span className="font-medium">{dept.name}</span>
            <span className="text-xs text-muted-foreground ml-auto">{getChildTeams(dept.id).reduce((s, t) => s + (t.member_count || 0), 0)} agents</span>
          </div>

          {expandedDepts.has(dept.id) && (
            <div className="ml-4 mt-1 space-y-2">
              {getChildTeams(dept.id).map(team => (
                <div key={team.id} className="p-3 bg-card rounded-lg border-l-2 border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{team.name}</span>
                    <div className="flex gap-1">
                      <span className="text-xs text-muted-foreground">{team.member_count} agents</span>
                      <button className="text-xs text-primary hover:underline ml-2" onClick={() => setAddingToTeam(addingToTeam === team.id ? null : team.id)}>+ Agent</button>
                    </div>
                  </div>

                  {/* Agent picker */}
                  {addingToTeam === team.id && (
                    <div className="mb-2 p-2 bg-surface-1 rounded border border-border">
                      <select className="w-full px-2 py-1 bg-secondary border border-border rounded text-sm text-foreground" onChange={e => { if (e.target.value) handleAddAgent(team.id, parseInt(e.target.value)) }}>
                        <option value="">Select agent...</option>
                        {unassignedAgents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
                      </select>
                    </div>
                  )}

                  {/* Team members */}
                  {team.members?.map(member => (
                    <div key={member.id} className="flex items-center gap-2 py-1 text-sm">
                      <span className={`w-2 h-2 rounded-full ${statusColor[member.status] || 'bg-zinc-500'}`} />
                      <button className="hover:underline text-foreground" onClick={() => { /* navigate to agent */ }}>{member.name}</button>
                      <span className="text-muted-foreground text-xs">({member.role})</span>
                      <button className="ml-auto text-xs text-red-400 hover:text-red-300" onClick={() => handleRemoveAgent(team.id, member.id)}>x</button>
                    </div>
                  ))}
                </div>
              ))}

              {/* Add team button */}
              {showCreateForm === dept.id ? (
                <div className="p-3 bg-surface-1 rounded-lg border border-border">
                  <input className="w-full mb-2 px-3 py-1.5 bg-secondary border border-border rounded text-sm text-foreground" placeholder="Team name" value={formName} onChange={e => setFormName(e.target.value)} autoFocus />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleCreate(dept.id)}>Create</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowCreateForm(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <button className="text-xs text-primary hover:underline p-2" onClick={() => { setShowCreateForm(dept.id); setFormName('') }}>+ Add Team</button>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Unassigned agents */}
      {unassignedAgents.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Unassigned Agents</h3>
          {unassignedAgents.map(a => (
            <div key={a.id} className="flex items-center gap-2 py-1 text-sm">
              <span className={`w-2 h-2 rounded-full ${statusColor[a.status] || 'bg-zinc-500'}`} />
              <span>{a.name}</span>
              <span className="text-muted-foreground text-xs">({a.role})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/panels/teams-panel.tsx
git commit -m "feat: add Teams panel component — departments, teams, agent management"
```

---

### Task 15: Register Teams Panel in Navigation

**Files:**
- Modify: `src/components/layout/nav-rail.tsx` (add to CORE group, around line 34)
- Modify: `src/app/[[...panel]]/page.tsx` (add import + case)

**Step 1: Add to nav-rail.tsx**

In the CORE group items array, add after the last item:

```typescript
{ id: 'teams', label: 'Teams', icon: <TeamsIcon />, priority: false },
```

Add the TeamsIcon function near the other icon functions:

```typescript
function TeamsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5" r="2" />
      <circle cx="4" cy="11" r="2" />
      <circle cx="12" cy="11" r="2" />
      <line x1="8" y1="7" x2="4" y2="9" />
      <line x1="8" y1="7" x2="12" y2="9" />
    </svg>
  )
}
```

**Step 2: Add to page.tsx**

Add import at top:
```typescript
import { TeamsPanel } from '@/components/panels/teams-panel'
```

Add case in ContentRouter switch:
```typescript
case 'teams':
  return <TeamsPanel />
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/layout/nav-rail.tsx src/app/[[...panel]]/page.tsx
git commit -m "feat: register Teams panel in sidebar navigation"
```

---

### Task 16: Teams API — Include Members in Response

**Files:**
- Modify: `src/app/api/teams/route.ts`

**Step 1: Add include=members support**

In the GET handler, check for `include` query param:

```typescript
const url = new URL(request.url)
const includeMembers = url.searchParams.get('include')?.includes('members')

// Base query stays the same
const teams = db.prepare(`...`).all(workspaceId)

if (includeMembers) {
  const members = db.prepare(`
    SELECT tm.team_id, a.id, a.name, a.role, a.status
    FROM team_members tm
    JOIN agents a ON a.id = tm.agent_id
    WHERE a.workspace_id = ?
  `).all(workspaceId) as Array<{ team_id: number; id: number; name: string; role: string; status: string }>

  const membersByTeam = new Map<number, typeof members>()
  for (const m of members) {
    const arr = membersByTeam.get(m.team_id) ?? []
    arr.push(m)
    membersByTeam.set(m.team_id, arr)
  }

  for (const team of teams as any[]) {
    team.members = membersByTeam.get(team.id) ?? []
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/teams/route.ts
git commit -m "feat: teams API include=members for batch loading"
```

**--- GATE 4 CHECKPOINT ---**
Run: `pnpm typecheck && pnpm test`
Visual: Navigate to /teams in browser, verify hierarchy renders.

---

## Gate 5: Projects Panel UI (Tasks 17-19)

### Task 17: Projects List Panel

**Files:**
- Create: `src/components/panels/projects-panel.tsx`

**Step 1: Implement projects list**

Follow exact same pattern as teams-panel. Shows project cards with name, team, counts. [+ New Project] button triggers a create form. Click project card navigates to project detail.

Key state:
```typescript
const [projects, setProjects] = useState<Project[]>([])
const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
```

When `selectedProjectId` is set, render `<ProjectDetailView projectId={selectedProjectId} onBack={() => setSelectedProjectId(null)} />` instead of the list.

**Step 2: Commit**

```bash
git add src/components/panels/projects-panel.tsx
git commit -m "feat: add Projects list panel with create form"
```

---

### Task 18: Project Detail View Component

**Files:**
- Create: `src/components/panels/project-detail-view.tsx`

**Step 1: Implement detail view with tabs**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'

type Tab = 'activity' | 'meetings' | 'decisions' | 'artifacts' | 'tasks'

export function ProjectDetailView({ projectId, onBack }: { projectId: number; onBack: () => void }) {
  const [project, setProject] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<Tab>('activity')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(data => { setProject(data.project || data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectId])

  if (loading) return <div className="m-4"><Loader /></div>
  if (!project) return <div className="m-4 text-red-400">Project not found</div>

  const tabs: { id: Tab; label: string }[] = [
    { id: 'activity', label: 'Activity' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'artifacts', label: 'Artifacts' },
    { id: 'tasks', label: 'Tasks' },
  ]

  return (
    <div className="m-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 pb-2 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-sm">← Back</button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{project.name}</h2>
          {project.team_name && <span className="text-xs text-muted-foreground">{project.team_name}</span>}
        </div>
      </div>

      {project.description && <p className="text-sm text-muted-foreground mb-4">{project.description}</p>}

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'activity' && <ActivityTab projectId={projectId} />}
      {activeTab === 'meetings' && <MeetingsTab projectId={projectId} />}
      {activeTab === 'decisions' && <DecisionsTab projectId={projectId} />}
      {activeTab === 'artifacts' && <ArtifactsTab projectId={projectId} />}
      {activeTab === 'tasks' && <TasksTab projectId={projectId} />}
    </div>
  )
}

// Each tab component fetches its own data lazily
function ActivityTab({ projectId }: { projectId: number }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/projects/${projectId}/activity`)
      .then(r => r.json())
      .then(data => { setItems(data.activity || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectId])

  if (loading) return <Loader />
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No activity yet. Start the office to see agents work on this project.</p>

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={`${item.type}-${item.id}-${i}`} className="p-3 bg-card rounded-lg border-l-2 border-border">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-muted-foreground uppercase">{item.type}</span>
            <span className="text-xs text-muted-foreground">{new Date(item.timestamp * 1000).toLocaleString()}</span>
          </div>
          <div className="text-sm font-medium">{item.title}</div>
          {item.detail && <div className="text-xs text-muted-foreground mt-1">{item.detail}</div>}
        </div>
      ))}
    </div>
  )
}

function DecisionsTab({ projectId }: { projectId: number }) {
  const [decisions, setDecisions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/projects/${projectId}/decisions`)
      .then(r => r.json())
      .then(data => { setDecisions(data.decisions || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectId])

  if (loading) return <Loader />
  if (decisions.length === 0) return <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>

  const statusColor: Record<string, string> = { active: 'text-green-400', superseded: 'text-amber-400', reversed: 'text-red-400' }

  return (
    <div className="space-y-3">
      {decisions.map(d => (
        <div key={d.id} className="p-3 bg-card rounded-lg border-l-2 border-green-500/30">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-medium ${statusColor[d.status] || ''}`}>{d.status}</span>
            <span className="text-xs text-muted-foreground">{new Date(d.created_at * 1000).toLocaleString()}</span>
          </div>
          <div className="text-sm font-medium">{d.title}</div>
          <div className="text-xs text-muted-foreground mt-1">{d.description}</div>
        </div>
      ))}
    </div>
  )
}

function ArtifactsTab({ projectId }: { projectId: number }) {
  const [artifacts, setArtifacts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    fetch(`/api/projects/${projectId}/artifacts`)
      .then(r => r.json())
      .then(data => { setArtifacts(data.artifacts || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectId])

  if (loading) return <Loader />
  if (artifacts.length === 0) return <p className="text-sm text-muted-foreground">No artifacts produced yet.</p>

  return (
    <div className="space-y-3">
      {artifacts.map(a => (
        <div key={a.id} className="p-3 bg-card rounded-lg border-l-2 border-blue-500/30">
          <div className="flex items-center gap-2 mb-1 cursor-pointer" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
            <span className="text-xs font-medium text-blue-400">{a.artifact_type}</span>
            <span className="text-sm font-medium flex-1">{a.title}</span>
            <span className="text-xs text-muted-foreground">{expanded === a.id ? '▼' : '▶'}</span>
          </div>
          {expanded === a.id && (
            <pre className="mt-2 p-3 bg-surface-1 rounded text-xs text-foreground whitespace-pre-wrap overflow-auto max-h-80">{a.content}</pre>
          )}
        </div>
      ))}
    </div>
  )
}

function MeetingsTab({ projectId }: { projectId: number }) {
  const [meetings, setMeetings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/meetings?project_id=${projectId}`)
      .then(r => r.json())
      .then(data => { setMeetings(data.meetings || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectId])

  if (loading) return <Loader />
  if (meetings.length === 0) return <p className="text-sm text-muted-foreground">No meetings for this project yet.</p>

  return (
    <div className="space-y-3">
      {meetings.map(m => (
        <div key={m.id} className="p-3 bg-card rounded-lg border-l-2 border-border">
          <div className="text-sm font-medium">{m.topic || 'Meeting'}</div>
          <div className="text-xs text-muted-foreground mt-1">{m.status} - {m.turn_count}/{m.max_turns} turns</div>
          {m.summary && <div className="text-xs mt-1">{m.summary}</div>}
        </div>
      ))}
    </div>
  )
}

function TasksTab({ projectId }: { projectId: number }) {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/projects/${projectId}/tasks`)
      .then(r => r.json())
      .then(data => { setTasks(data.tasks || data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectId])

  if (loading) return <Loader />
  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">No tasks for this project yet.</p>

  const priorityColor: Record<string, string> = { high: 'border-red-500/50', medium: 'border-amber-500/50', low: 'border-border' }

  return (
    <div className="space-y-2">
      {tasks.map(t => (
        <div key={t.id} className={`p-3 bg-card rounded-lg border-l-2 ${priorityColor[t.priority] || 'border-border'}`}>
          <div className="text-sm font-medium">{t.title}</div>
          <div className="text-xs text-muted-foreground mt-1">{t.status} - {t.priority}</div>
        </div>
      ))}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/panels/project-detail-view.tsx
git commit -m "feat: add Project detail view with activity/meetings/decisions/artifacts/tasks tabs"
```

---

### Task 19: Register Projects Panel in Navigation

**Files:**
- Modify: `src/components/layout/nav-rail.tsx`
- Modify: `src/app/[[...panel]]/page.tsx`

**Step 1: Add to nav-rail.tsx**

```typescript
{ id: 'projects', label: 'Projects', icon: <ProjectsIcon />, priority: true },
```

Add ProjectsIcon:
```typescript
function ProjectsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <line x1="6" y1="2" x2="6" y2="14" />
      <line x1="6" y1="6" x2="14" y2="6" />
    </svg>
  )
}
```

**Step 2: Add to page.tsx**

```typescript
import { ProjectsPanel } from '@/components/panels/projects-panel'
// ...
case 'projects':
  return <ProjectsPanel />
```

**Step 3: Commit**

```bash
git add src/components/layout/nav-rail.tsx src/app/[[...panel]]/page.tsx
git commit -m "feat: register Projects panel in sidebar navigation"
```

**--- GATE 5 CHECKPOINT ---**
Run: `pnpm typecheck && pnpm test`
Visual: Navigate to /projects and /teams in browser. Verify rendering.

---

## Gate 6: Persona Editor (Task 20)

### Task 20: Persona Editor Component

**Files:**
- Create: `src/components/panels/persona-editor.tsx`
- Modify: `src/components/panels/agent-squad-panel.tsx` (add persona tab to agent detail)

**Step 1: Implement persona editor**

Create `src/components/panels/persona-editor.tsx` with:
- Big Five sliders (range inputs, 0-1 step 0.05)
- Preset dropdown with Apply button
- SOUL content textarea (resizable)
- Communication style text input
- Traits text input (comma-separated)
- Save Changes button
- Load via GET /api/agents/:id/persona
- Save via PUT /api/agents/:id/persona

Key slider pattern:
```typescript
<div className="space-y-3">
  {(['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const).map(trait => (
    <div key={trait} className="flex items-center gap-3">
      <label className="text-sm w-40 capitalize">{trait}</label>
      <input
        type="range" min="0" max="1" step="0.05"
        value={bigFive[trait]}
        onChange={e => setBigFive(prev => ({ ...prev, [trait]: parseFloat(e.target.value) }))}
        className="flex-1 accent-primary"
      />
      <span className="text-xs text-muted-foreground w-10 text-right">{bigFive[trait].toFixed(2)}</span>
    </div>
  ))}
</div>
```

**Step 2: Wire into agent panel**

In agent-squad-panel.tsx, when an agent is selected, show a "Persona" tab that renders `<PersonaEditor agentId={selectedAgent.id} />`.

**Step 3: Commit**

```bash
git add src/components/panels/persona-editor.tsx src/components/panels/agent-squad-panel.tsx
git commit -m "feat: add Persona Editor — Big Five sliders, SOUL editor, presets"
```

**--- GATE 6 CHECKPOINT ---**
Run: `pnpm typecheck && pnpm test`
Visual: Click agent → Persona tab → sliders + SOUL editor visible.

---

## Gate 7: Simulation Controls (Task 21)

### Task 21: Start/Stop Office in Header

**Files:**
- Modify: `src/components/layout/header-bar.tsx` (around line 347, right section)

**Step 1: Add simulation state and controls**

Add state to HeaderBar:
```typescript
const [simRunning, setSimRunning] = useState(false)
const [simStats, setSimStats] = useState<{ agents: number; meetings: number } | null>(null)

const handleStart = async () => {
  try {
    const res = await fetch('/api/simulation/start', { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      setSimRunning(true)
      setSimStats({ agents: data.agents_woken || 0, meetings: 0 })
    }
  } catch { /* ignore */ }
}

const handleStop = async () => {
  try {
    const res = await fetch('/api/simulation/stop', { method: 'POST' })
    if (res.ok) {
      setSimRunning(false)
      setSimStats(null)
    }
  } catch { /* ignore */ }
}
```

**Step 2: Add to right section of header**

In the right section (around line 347):
```typescript
{/* Simulation Controls */}
{simRunning ? (
  <div className="flex items-center gap-2">
    <span className="flex items-center gap-1.5 text-xs">
      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
      LIVE
    </span>
    {simStats && (
      <span className="text-xs text-muted-foreground">{simStats.agents} agents</span>
    )}
    <Button size="xs" variant="ghost" onClick={handleStop}>Stop</Button>
  </div>
) : (
  <Button size="sm" onClick={handleStart}>Start Office</Button>
)}
```

**Step 3: Check simulation status on mount**

```typescript
useEffect(() => {
  fetch('/api/simulation/tick')
    .then(r => r.json())
    .then(data => { if (data.running) setSimRunning(true) })
    .catch(() => {})
}, [])
```

**Step 4: Commit**

```bash
git add src/components/layout/header-bar.tsx
git commit -m "feat: add Start/Stop Office simulation controls in header"
```

**--- GATE 7 CHECKPOINT ---**
Run: `pnpm typecheck && pnpm test`
Visual: Header shows "Start Office" button. Click → LIVE indicator.

---

## Gate 8: Integration Validation (Task 22)

### Task 22: End-to-End Walkthrough

**Step 1: Full flow test**

1. Navigate to Teams panel
2. Create department "Engineering"
3. Create team "Frontend" inside Engineering
4. Add Maya and Jordan to Frontend team
5. Navigate to Projects panel
6. Create project "UI Redesign" assigned to Frontend team
7. Click into project → verify empty activity
8. Click "Start Office" in header
9. Wait for autonomous meeting between Maya and Jordan
10. Verify meeting appears in project activity feed
11. After meeting concludes, verify:
    - Decisions appear in Decisions tab
    - Tasks appear in Tasks tab
    - Summary visible in activity feed
12. Click "Stop Office"
13. Verify agents go offline

**Step 2: Run full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: All 1314+ existing tests pass + new tests pass.

**Step 3: Commit**

```bash
git commit --allow-empty -m "checkpoint: Gate 8 passed — end-to-end integration verified"
```

---

## Gate 9: Regression & Final Validation (Task 23)

### Task 23: Final Validation

**Step 1: Full regression**

```bash
pnpm typecheck && pnpm test && pnpm lint
```

Expected: Zero errors across all checks.

**Step 2: E2E tests**

```bash
pnpm test:e2e:ci
```

Read `test-results/e2e-results.json` for any failures.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: Mission Control v3.0 — Living Office

Project-centric dashboard with departments, teams, persona editor,
simulation controls, and meeting-to-project wiring with decision
and artifact extraction.

- 3 database migrations (departments, decisions, artifacts)
- Teams panel with 2-level hierarchy
- Projects panel with detail view (5 tabs)
- Persona editor with Big Five sliders + SOUL
- Start/Stop Office simulation controls
- Meeting engine produces decisions + artifacts
- All 20 success criteria validated"
```
