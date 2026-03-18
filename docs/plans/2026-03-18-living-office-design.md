# Mission Control v3.0 — "Living Office" Design

**Date:** 2026-03-18
**Status:** Approved
**Approach:** Project-Centric Dashboard (Approach C)

## Overview

Close all gaps found in the v2.1 audit. Users can build teams of AI agents into departments, assign them projects, start the office simulation, and watch agents autonomously meet, discuss, and produce work (decisions, tasks, artifacts) — with the ability to intervene at any point.

**Mental model:**
```
Create Department -> Create Team -> Add Agents -> Create Project -> Assign Team
  -> Start Office -> Agents autonomously meet about the project
    -> Meetings produce decisions, tasks, artifacts
      -> Project page shows all activity, progress, outputs
```

The Project is the center of gravity. Everything else serves it.

## User Decisions

| Question | Answer |
|---|---|
| Primary use case | Hybrid — autonomous with overrides |
| Organizational depth | Teams + Departments (2 levels) |
| Meeting output | Tasks + decisions + artifacts |
| Agent activation | One-click "Start Office" |
| Architecture approach | Project-Centric Dashboard |

## Database Schema Changes

### Migration phase_062: departments_and_project_wiring

```sql
-- 2-level hierarchy: teams with parent_id=NULL are departments
-- teams with parent_id=<dept_id> are teams within that department
ALTER TABLE teams ADD COLUMN parent_id INTEGER
  REFERENCES teams(id) ON DELETE CASCADE;

-- Link projects to teams (organizational ownership)
ALTER TABLE projects ADD COLUMN team_id INTEGER
  REFERENCES teams(id) ON DELETE CASCADE;

-- Link meetings to projects (contextual association)
ALTER TABLE agent_meetings ADD COLUMN project_id INTEGER
  REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX idx_teams_parent ON teams(parent_id);
CREATE INDEX idx_projects_team ON projects(team_id);
CREATE INDEX idx_meetings_project ON agent_meetings(project_id);
```

### Migration phase_063: project_decisions

```sql
CREATE TABLE project_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id INTEGER REFERENCES agent_meetings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  decided_by TEXT,            -- JSON array of agent names
  status TEXT NOT NULL DEFAULT 'active',  -- active | superseded | reversed
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_decisions_project ON project_decisions(project_id);
CREATE INDEX idx_decisions_meeting ON project_decisions(meeting_id);
```

### Migration phase_064: project_artifacts

```sql
CREATE TABLE project_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id INTEGER REFERENCES agent_meetings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  artifact_type TEXT NOT NULL DEFAULT 'document', -- document | spec | code | brief
  created_by_agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_artifacts_project ON project_artifacts(project_id);
```

### Schema Design Rationale

- **No separate departments table.** Teams already exist (phase_048). Adding `parent_id` creates 2-level hierarchy without a new table. Department = team where parent_id IS NULL. Team = team where parent_id = department.id.
- **All FKs use ON DELETE CASCADE.** Matches existing convention (100% of FKs in codebase use CASCADE).
- **All new columns are nullable.** Existing rows get NULL — no data migration needed.
- **project_agent_assignments coexists with team_id.** team_id = organizational ownership. project_agent_assignments = individual task-level roles. Orthogonal concerns.
- **Migrations are idempotent.** Use pragma('table_info') checks before ALTER, CREATE IF NOT EXISTS for tables/indexes.

## UI Architecture

### Navigation Changes

| Current Sidebar | New Sidebar |
|---|---|
| Overview | Overview (+ Start/Stop Office in header) |
| Agents | **Projects** (new — list + detail views) |
| Tasks | **Teams** (new — departments + teams + agent assignment) |
| Chat | Agents (kept — now includes persona editor) |
| ... (observe/admin same) | Tasks, Chat (kept) |

### 1. Teams Panel

New sidebar item in CORE group. Shows 2-level hierarchy.

**Features:**
- Department list with collapsible teams
- Create department (name, description, color)
- Create team inside department
- Add/remove agents to teams (dropdown picker)
- Agent status dots (real-time via SSE)
- Click agent name -> navigate to agent persona editor
- Click project name -> navigate to project detail
- "Unassigned Agents" section at bottom

**Data flow:**
- GET /api/teams?include=members,projects (hierarchical response)
- POST /api/teams (create department or team)
- POST/DELETE /api/teams/:id/members (manage membership)

### 2. Projects Panel

Promoted from modal to sidebar item in CORE group.

**List View:**
- Project cards with: name, team, task count, meeting count, decision count
- Color-coded by project color
- [+ New Project] button
- Filter by team/department

**Detail View (tabs):**

**Activity tab (default):**
- Reverse-chronological feed of all project events
- Meeting started/concluded with live speech preview
- Decisions made with title/description
- Artifacts created with type badge
- Tasks created with assignee
- Real-time updates via SSE (no polling)
- Paginated (20 items per page)

**Meetings tab:**
- Active meetings for this project (live turn progress)
- Recent concluded meetings with transcripts
- [Schedule Meeting] button — pick 2 agents, set topic
- Quality scores per meeting

**Decisions tab:**
- Chronological decisions log
- Status badges: active | superseded | reversed
- Click to see source meeting
- [Add Decision] for manual entries

**Artifacts tab:**
- Grid of artifacts with type/title/date
- Click to expand content (markdown rendered)
- Type filter: document, spec, code, brief

**Tasks tab:**
- Filtered task board for this project only
- Reuses existing task board component with project_id filter

**Data flow:**
- GET /api/projects (list with stats)
- GET /api/projects/:id (detail with team info)
- GET /api/projects/:id/activity (paginated feed)
- GET /api/projects/:id/decisions
- GET /api/projects/:id/artifacts
- GET /api/projects/:id/tasks (existing, add project filter)

### 3. Agent Persona Editor

Added as tab within existing agent detail view (Agents panel).

**Persona tab:**
- Preset selector dropdown (analytical-engineer, creative-designer, cautious-reviewer, team-lead) + [Apply]
- Big Five sliders (0.00-1.00, step 0.05): Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism
- SOUL.md content: resizable textarea, max 50KB
- Communication style: text input
- Traits: tag input (comma-separated)
- [Save Changes] button (explicit save, no auto-save)

**Data flow:**
- GET /api/agents/:id/persona (existing endpoint)
- PUT /api/agents/:id/persona (existing endpoint)

### 4. Simulation Controls

In application header bar, not a panel.

**Stopped state:** `[> Start Office]` button
**Running state:** `LIVE` indicator + agent count + meeting count + `[Pause]` `[Stop]` buttons

**Start Office does:**
1. POST /api/simulation/start
2. Sets all non-error agents to `idle`
3. Starts simulation tick engine (P0-P4 priorities)
4. Enables autonomous meeting initiation
5. SSE events begin flowing

**Stop Office does:**
1. POST /api/simulation/stop
2. Gracefully concludes active meetings (summary + trust update)
3. Stops simulation tick
4. Sets all agents to `offline`

**Idempotency:** Start when already running = no-op. Stop when already stopped = no-op.

## Meeting Engine Changes

### Project-Aware Meetings

When `createMeeting()` runs:
1. Check if initiator has project assignment via `project_agent_assignments`
2. If both agents share the same project, set meeting.project_id = that project
3. If only initiator has a project, set meeting.project_id = initiator's project
4. If neither has a project, meeting.project_id = NULL (unstructured meeting)

### Project Context in Prompts

When meeting has project_id:
- Fetch project name + description
- Inject into system prompt: "This meeting is about the project '[name]': [description]"
- Topic auto-generation incorporates project context

### Enhanced Output Extraction

After meeting concludes, `extractMeetingOutputs()` replaces current `extractMeetingActions()`:

**LLM prompt:**
```
Given this meeting transcript between [initiator] and [participant] about [project]:

[transcript]

Extract:
1. action_items: 0-3 concrete tasks with {title, description, assignee_name}
2. decisions: 0-2 key decisions made with {title, description}
3. artifacts: 0-1 documents/specs/code proposed with {title, content, type}

Return as JSON. If none found for a category, return empty array.
```

**Processing:**
- Tasks: inserted into tasks table (existing behavior)
- Decisions: inserted into project_decisions table (new)
- Artifacts: inserted into project_artifacts table (new)
- All linked to meeting_id for traceability
- Fallback: if LLM fails, meeting still concludes normally (extraction is non-critical)

## Success Criteria

| # | Criterion | Validation |
|---|---|---|
| SC-1 | Create department (team with parent_id=null) | E2E: POST /api/teams returns 201 |
| SC-2 | Create team inside department | E2E: POST /api/teams with parent_id returns 201 |
| SC-3 | Add/remove agents to teams | E2E: POST/DELETE /api/teams/:id/members |
| SC-4 | Create project assigned to team | E2E: POST /api/projects with team_id |
| SC-5 | Teams panel renders hierarchy | Visual: departments, teams, agents, status |
| SC-6 | Project detail shows activity feed | Visual: tabs, real-time meeting updates |
| SC-7 | Meetings auto-link to project | Unit: createMeeting sets project_id |
| SC-8 | Meeting output includes decisions/artifacts | Unit: extractMeetingOutputs returns structured data |
| SC-9 | Decisions visible in project detail | E2E: GET /api/projects/:id/decisions |
| SC-10 | Artifacts visible in project detail | E2E: GET /api/projects/:id/artifacts |
| SC-11 | Persona editor saves Big Five + SOUL | E2E: PUT /api/agents/:id/persona round-trips |
| SC-12 | Persona sliders reflect current values | Visual: load, edit, save, reload — values match |
| SC-13 | Start Office wakes agents + starts sim | Integration: agents go idle, tick starts |
| SC-14 | Stop Office gracefully stops everything | Integration: meetings conclude, agents go offline |
| SC-15 | Live meetings in project activity via SSE | Integration: SSE event + project_id updates feed |
| SC-16 | TypeScript zero errors | pnpm typecheck passes |
| SC-17 | All existing tests pass | pnpm test — 1314+ tests pass |
| SC-18 | New features >= 80% test coverage | Unit tests for reducers, routes, engine |
| SC-19 | Migrations idempotent | Unit: run twice, no errors |
| SC-20 | UI renders on 1280px+ viewport | Visual verification |

## Validation Gates

| Gate | What | How | Must Pass Before |
|---|---|---|---|
| G1 | Schema | Migrations run, tables exist, indexes present | G2 |
| G2 | API | All new endpoints return correct data | G3 |
| G3 | Engine | Meeting-project wiring, decision/artifact extraction | G4 |
| G4 | Teams UI | Panel renders, CRUD works, hierarchy displays | G5 |
| G5 | Projects UI | List + detail views, all tabs functional | G6 |
| G6 | Persona UI | Sliders, SOUL editor, presets, save/load | G7 |
| G7 | Sim Controls | Start/Stop, agent lifecycle, header state | G8 |
| G8 | Integration | Full flow walkthrough end-to-end | G9 |
| G9 | Regression | All existing 1314+ tests pass | Ship |

## Risk Register

| Risk | P | Impact | Mitigation |
|---|---|---|---|
| LLM decision extraction unreliable | M | M | Structured JSON prompt + fallback to empty array |
| Meeting-project auto-linking wrong | L | H | Unit tests for all agent-project combinations |
| Simulation start/stop races | M | H | Mutex/flag in engine, idempotent operations |
| Schema migration breaks existing data | L | Critical | All nullable, IF NOT EXISTS, pragma checks |
| SSE overload with many panels | M | M | Single connection, client-side event routing |
| Persona save conflicts | L | L | Last-write-wins with updated_at |
| parent_id circular reference | L | M | Validation: reject if parent.parent_id is not null |

## Quality Metrics

**Performance:**
- Teams panel: render < 100ms for 50 agents / 10 teams
- Project list: load < 200ms
- Project detail tabs: lazy-load on click
- Activity feed: paginated (20 items), SSE for real-time

**Reliability:**
- Start/Stop Office: idempotent
- Meeting conclusion: always completes even if extraction fails
- SSE: auto-reconnect on disconnect

**Maintainability:**
- Follow existing panel pattern (useState + useCallback + useEffect)
- Follow existing Zustand slice pattern for new state
- Follow existing migration pattern (phase_NNN in phase-migrations.ts)
- No new dependencies
- i18n for all user-facing strings

## Estimated Scope

- 3 database migrations
- 6-8 new API routes
- 3-5 modified API routes
- 3 new panel components (Teams, Projects list, Projects detail)
- 1 new sub-component (Persona editor)
- 1 header modification (Simulation controls)
- Meeting engine modifications (project linking, output extraction)
- 40-60 new unit tests
- 10-15 new E2E tests
