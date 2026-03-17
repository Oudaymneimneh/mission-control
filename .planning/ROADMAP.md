# Roadmap: Mission Control Agent Orchestration Platform

## Overview

Mission Control development across two milestones. v1.0 (Phases 1-8) transformed MC from monitoring dashboard into orchestration platform with 6 major capabilities. v2.1 (Phases 9-15) completes the meeting system with production features, polishes office canvas visual quality, and achieves comprehensive meeting test coverage.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-8 (shipped 2026-03-15)
- ✅ **v2.0 Meeting Engine + Hardening** — (shipped 2026-03-16)
- 🚧 **v2.1 Meeting Engine Polish** — Phases 9-15 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-8) — SHIPPED 2026-03-15</summary>

- [x] **Phase 1: Foundation** — Zustand split, SQLite hardening, error boundaries, dagre, EventBus
- [x] **Phase 2: Spatial Visualization** — @xyflow/react canvas, dagre layout, SSE updates, message flow
- [x] **Phase 3: Workflow Engine** — SOP templates, phase execution, artifact validation, approval gates
- [x] **Phase 4: Team Chat** — @mention routing, @all, @team:name, loop prevention
- [x] **Phase 5: Debate/Consensus** — Structured rounds, voting, token budgets, argument trees
- [x] **Phase 6: Persona Simulation** — Big Five, PAD emotional model, cognitive biases, trust scores
- [x] **Phase 7: Auto-Scaling** — Lazy evaluation, cooldown, template spawning, global caps
- [x] **Phase 8: Integration & Polish** — Cross-system SSE, quality gate validation

</details>

### 🚧 v2.1 Meeting Engine Polish

- [ ] **Phase 9: Visual Foundation** — Performance + color identity system
- [ ] **Phase 10: Visual Polish** — Speech bubbles, tooltips, panel animations
- [ ] **Phase 11: Meeting Engine Core** — Task creation + meeting scheduling
- [ ] **Phase 12: Meeting Intelligence** — Collaborator suggestions + analytics dashboard
- [ ] **Phase 13: Meeting Quality Scoring** — LLM-evaluated conversation quality
- [ ] **Phase 14: Trust Network Graph** — Force-directed SVG visualization
- [ ] **Phase 15: Meeting Test Coverage** — Unit, integration, and E2E test layers

## Phase Details

<details>
<summary>✅ v1.0 Phase Details (Phases 1-8)</summary>

### Phase 1: Foundation
**Goal**: Clean architectural base — Zustand split, SQLite hardening, error boundaries
**Requirements**: FNDN-01 through FNDN-07 | **Status**: Complete

### Phase 2: Spatial Visualization
**Goal**: Interactive @xyflow/react canvas with agent nodes, dagre layout, SSE updates
**Requirements**: SPAT-01 through SPAT-10 | **Status**: Complete

### Phase 3: Workflow Engine
**Goal**: SOP templates, sequential phases, artifact validation, approval gates
**Requirements**: WKFL-01 through WKFL-10 | **Status**: Complete

### Phase 4: Team Chat
**Goal**: @mention routing, @all, @team:name, auto-response, loop prevention
**Requirements**: CHAT-01 through CHAT-09 | **Status**: Complete

### Phase 5: Debate/Consensus
**Goal**: Structured rounds, voting, token budgets, argument trees
**Requirements**: DEBT-01 through DEBT-10 | **Status**: Complete

### Phase 6: Persona Simulation
**Goal**: OCEAN traits, PAD emotional model, cognitive biases, trust scores
**Requirements**: PRSA-01 through PRSA-09 | **Status**: Complete

### Phase 7: Auto-Scaling
**Goal**: Lazy queue evaluation, template spawning, approval gates, global caps
**Requirements**: SCAL-01 through SCAL-10 | **Status**: Complete

### Phase 8: Integration & Polish
**Goal**: Cross-system SSE wiring, quality gate validation
**Requirements**: QUAL-01 through QUAL-06 | **Status**: Complete

</details>

### Phase 9: Visual Foundation
**Goal**: Establish rendering performance and per-agent color identity across the office canvas
**Depends on**: Nothing (first v2.1 phase)
**Requirements**: VIZQ-01, VIZQ-05, VIZQ-09, VIZQ-10
**Success Criteria** (what must be TRUE):
  1. Each agent renders with a unique, consistent color across desk marker, speech bubble, name label, and canvas indicator
  2. Agent movement on canvas uses CSS transitions with zero requestAnimationFrame calls
  3. Office canvas floor renders with a single CSS background-image repeat (not 384 individual DOM nodes)
  4. Idle agents display at reduced opacity compared to active/meeting agents, updating via SSE
**Research**: Unlikely (CSS transitions, internal patterns)
**Plans**: TBD

### Phase 10: Visual Polish
**Goal**: Add animation polish and interactive disclosure to the office canvas
**Depends on**: Phase 9 (uses color system)
**Requirements**: VIZQ-02, VIZQ-03, VIZQ-04, VIZQ-06
**Success Criteria** (what must be TRUE):
  1. Speech bubbles display with dark theme (dark background, light text) matching the application palette
  2. Speech bubbles fade/slide out smoothly when conversations end instead of instant removal
  3. Meeting detail panel opens/closes with spring-physics CSS transitions
  4. Hovering any agent on the office canvas reveals a tooltip with name, role, status, and active meeting
**Research**: Unlikely (CSS animations, internal UI work)
**Plans**: TBD

### Phase 11: Meeting Engine Core
**Goal**: Meetings produce actionable tasks and can be triggered on schedule
**Depends on**: Nothing (independent of visual work)
**Requirements**: MEET-01, MEET-02, MEET-05, MEET-06
**Success Criteria** (what must be TRUE):
  1. After a meeting concludes, a task appears in the task board with meeting topic as title and outcome summary as description
  2. Meeting-created tasks include a clickable reference back to the source meeting
  3. Meetings can be scheduled at configurable recurring intervals per agent
  4. Scheduled meetings skip agents that are currently busy or in another meeting
**Research**: Unlikely (extends existing meeting engine and task system)
**Plans**: TBD

### Phase 12: Meeting Intelligence
**Goal**: Surface who agents should meet with and visualize meeting patterns
**Depends on**: Phase 11 (needs meeting data for analytics)
**Requirements**: MEET-03, MEET-04, MEET-07, MEET-08
**Success Criteria** (what must be TRUE):
  1. Collaborator suggestions panel displays top-5 partners ranked by 5-factor selection with score breakdown
  2. Collaborator suggestion scores refresh after each meeting with latest trust data
  3. Meeting analytics page shows frequency trends over time via a recharts chart
  4. Per-agent meeting stats (count, average duration, trust delta) are visible on the analytics page
**Research**: Likely (recharts integration for time-series analytics)
**Research topics**: recharts API for time-series/bar charts, existing recharts usage in project, data aggregation queries
**Plans**: TBD

### Phase 13: Meeting Quality Scoring
**Goal**: Evaluate meeting conversations via LLM and surface quality metrics
**Depends on**: Phase 11 (needs meeting transcripts)
**Requirements**: MEET-09, MEET-10
**Success Criteria** (what must be TRUE):
  1. Each completed meeting has an LLM-generated quality score (0.0-1.0) stored in the database
  2. Quality scores are visible in both the meeting history list and individual meeting detail view
**Research**: Likely (LLM prompt engineering for evaluation)
**Research topics**: Quality scoring prompt design, evaluation rubric criteria, existing LLM router usage patterns
**Plans**: TBD

### Phase 14: Trust Network Graph
**Goal**: Visualize pairwise trust relationships as an interactive force-directed graph
**Depends on**: Phase 9 (uses agent color system)
**Requirements**: VIZQ-07, VIZQ-08
**Success Criteria** (what must be TRUE):
  1. Trust network renders as a pure SVG graph with agent nodes connected by trust-weighted edges (thickness/opacity proportional to score)
  2. Force-directed layout stabilizes within 2 seconds for 20 agents
**Research**: Likely (force-directed graph algorithm without D3)
**Research topics**: Force simulation algorithm (Verlet integration), SVG rendering for dynamic layouts, performance tuning for 20+ nodes
**Plans**: TBD

### Phase 15: Meeting Test Coverage
**Goal**: Comprehensive test coverage across all 3 layers for the meeting system
**Depends on**: Phases 9-14 (tests validate all features)
**Requirements**: MTST-01, MTST-02, MTST-03, MTST-04, MTST-05, MTST-06, MTST-07, MTST-08
**Success Criteria** (what must be TRUE):
  1. Unit tests cover meeting state machine transitions, 5-factor partner selection, and trust score update logic
  2. Integration tests verify conversation flow and quality scoring using recorded LLM responses (no live API calls)
  3. E2E tests verify SSE meeting events, panel rendering, and canvas marker position updates
  4. All new tests pass alongside existing 1191 unit + 760 E2E tests with zero regressions
**Research**: Unlikely (vitest + playwright patterns well-established)
**Plans**: TBD

## Progress

**v2.1 Execution Order:** 9 → 10 → 11 → 12 → 13 → 14 → 15
**Parallelizable:** Phases 12, 13, 14 can run in parallel (all depend on 9/11 but not each other)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 1. Foundation | v1.0 | 5/5 | Complete | 2026-03-15 |
| 2. Spatial Visualization | v1.0 | 5/5 | Complete | 2026-03-15 |
| 3. Workflow Engine | v1.0 | 4/4 | Complete | 2026-03-15 |
| 4. Team Chat | v1.0 | 4/4 | Complete | 2026-03-15 |
| 5. Debate/Consensus | v1.0 | 4/4 | Complete | 2026-03-15 |
| 6. Persona Simulation | v1.0 | 3/3 | Complete | 2026-03-15 |
| 7. Auto-Scaling | v1.0 | 3/3 | Complete | 2026-03-15 |
| 8. Integration & Polish | v1.0 | 2/2 | Complete | 2026-03-15 |
| 9. Visual Foundation | v2.1 | 0/TBD | Not started | — |
| 10. Visual Polish | v2.1 | 0/TBD | Not started | — |
| 11. Meeting Engine Core | v2.1 | 0/TBD | Not started | — |
| 12. Meeting Intelligence | v2.1 | 0/TBD | Not started | — |
| 13. Meeting Quality Scoring | v2.1 | 0/TBD | Not started | — |
| 14. Trust Network Graph | v2.1 | 0/TBD | Not started | — |
| 15. Meeting Test Coverage | v2.1 | 0/TBD | Not started | — |

---
*Roadmap created: 2026-03-15*
*Last updated: 2026-03-17 — v2.1 phases 9-15 added*
